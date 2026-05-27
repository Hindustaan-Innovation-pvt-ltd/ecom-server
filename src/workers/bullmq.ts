import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { User } from "../models/user.js";
import { Category } from "../models/category.js";
import { redisClient } from "../utils/redis.js";
import { encryptPassword } from "../utils/password.js";
import { enqueueWelcomeEmail, flushEmailStack } from "../services/email.js";
import { clearCachePattern } from "../utils/redis.js";
import { saveProductToCatalog } from "../utils/productHelper.js";
import { dispatchWebhookEvent } from "../services/webhookDispatcher.js";

let REDIS_URL: string;
if (process.env.NODE_ENV !== "development") {
  REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
} else {
  REDIS_URL = "redis://127.0.0.1:6380";
}

// Separate Redis connection for BullMQ (maxRetriesPerRequest MUST be null for BullMQ)
export const queueConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// ==========================================
// 1. USER BUFFER WRITE-BACK QUEUE
// ==========================================
export const userQueue = new Queue("UserQueue", {
  connection: queueConnection,
});

/**
 * Atomic write-back flush job.
 * Pops all buffered signups from Redis set "buffered:users", validates and bulk-inserts them.
 * Emails are pushed to the email stack — NOT dispatched here — the EmailWorker handles them.
 */
export async function flushBufferedUsers(): Promise<void> {
  if (!redisClient) return;

  const tempKey = `buffered:users:flushing:${Date.now()}`;
  try {
    const exists = await redisClient.exists("buffered:users");
    if (!exists) return;

    // Atomically rename the set to isolate the batch and avoid race conditions
    await redisClient.rename("buffered:users", tempKey);
    const rawUsers = await redisClient.smembers(tempKey);
    await redisClient.del(tempKey);

    if (!rawUsers || rawUsers.length === 0) return;

    console.log(`[Write-Back Queue] Processing batch of ${rawUsers.length} buffered signups...`);

    const usersToInsert: Record<string, unknown>[] = [];
    const emailsToEnqueue: { email: string; name: string }[] = [];

    for (const rawUser of rawUsers) {
      try {
        const payload = JSON.parse(rawUser);

        const existing = await User.findOne({
          $or: [{ email: payload.email.toLowerCase() }, { phone: payload.phone }],
        });

        if (existing) {
          console.warn(`[Write-Back Queue] Skipped duplicate: ${payload.email}`);
          continue;
        }

        const passwordHash = encryptPassword(payload.password);

        usersToInsert.push({
          fullName: payload.fullName,
          email: payload.email.toLowerCase(),
          phone: payload.phone,
          passwordHash,
          role: payload.role || "customer",
          avatarUrl: payload.avatarUrl || "",
        });

        emailsToEnqueue.push({ email: payload.email, name: payload.fullName });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[Write-Back Queue] Parsing user payload failed:", message);
      }
    }

    if (usersToInsert.length > 0) {
      const inserted = await User.insertMany(usersToInsert, { ordered: false });
      console.log(`[Write-Back Queue] Bulk-inserted ${inserted.length} users.`);

      // Push all welcome emails to the Redis stack — EmailWorker will BCC-batch them
      for (const e of emailsToEnqueue) {
        enqueueWelcomeEmail(e.email, e.name);
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Write-Back Queue] Flush failed:", message);
    if (redisClient) await redisClient.del(tempKey).catch(() => { });
  }
}

// User repeatable flush worker
export const userWorker = new Worker(
  "UserQueue",
  async (job: Job) => {
    if (job.name === "flushBufferedUsers") {
      await flushBufferedUsers();
    }
  },
  { connection: queueConnection }
);

// ==========================================
// 2. SEQUENTIAL PRODUCT STREAMING QUEUE
// ==========================================
export const productQueue = new Queue("ProductQueue", {
  connection: queueConnection,
});

export const productWorker = new Worker(
  "ProductQueue",
  async (job: Job) => {
    console.log(`[Product Queue] Job started: ${job.id}`);
    const {
      sellerId, categoryId, title, description, brand, sku,
      pricePaise, comparePricePaise, inventory, tags,
      descriptionObj, specifications, attributeValues,
      richDescription, seo, dimensions, variantAttributes, barcode, weight,
    } = job.data;

    try {
      const category = await Category.findById(categoryId);
      if (!category) throw new Error(`Category not found: ${categoryId}`);

      const result = await saveProductToCatalog({
        sellerId, categoryId, title, description, brand, sku,
        pricePaise, comparePricePaise, inventory, tags,
        isActive: true, moderationStatus: "approved",
        descriptionObj, specifications, attributeValues,
        richDescription, seo, dimensions, variantAttributes, barcode, weight,
      });

      console.log(`[Product Queue] Saved: ${result.product._id} (SKU: ${sku})`);
      await clearCachePattern("products:list:*");
      dispatchWebhookEvent("product.created", result.product.toObject(), result.product.sellerId ?? undefined);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Product Queue] Failed SKU ${sku}:`, message);
      throw err;
    }
  },
  {
    connection: queueConnection,
    concurrency: 1, // Strict sequential streaming
  }
);

// ==========================================
// 3. EMAIL BATCH QUEUE (Dedicated Worker)
// ==========================================

/**
 * EmailQueue — accepts "flushEmailStack" jobs on a recurring schedule.
 * The primary cluster process registers the repeatable job; the dedicated
 * email worker cluster (WORKER_ROLE=email) processes it exclusively.
 *
 * Flow:
 *   Any code path → enqueueWelcomeEmail() / enqueueSellerPendingEmail() etc.
 *     → pushes JSON entry to Redis list "email:stack"
 *   EmailWorker (every EMAIL_FLUSH_INTERVAL_MS) → flushEmailStack()
 *     → pops the entire stack
 *     → groups by email type
 *     → sends 1 BCC-batched SMTP call per group
 */
export const emailQueue = new Queue("EmailQueue", {
  connection: queueConnection,
});

// Flush interval — default 30 seconds, configurable via env
const EMAIL_FLUSH_INTERVAL_MS = parseInt(
  process.env.EMAIL_FLUSH_INTERVAL_MS || "30000",
  10
);

/**
 * Dedicated email worker. Runs ONLY in the cluster worker designated as
 * WORKER_ROLE=email. Concurrency 1 ensures one flush runs at a time.
 */
export const emailWorker = new Worker(
  "EmailQueue",
  async (job: Job) => {
    if (job.name === "flushEmailStack") {
      console.log(`[Email Worker] Flush job triggered (job: ${job.id})`);
      await flushEmailStack();
    }
  },
  {
    connection: queueConnection,
    concurrency: 1,
  }
);

emailWorker.on("completed", (job) => {
  console.log(`[Email Worker] Job ${job.id} completed.`);
});

emailWorker.on("failed", (job, err) => {
  console.error(`[Email Worker] Job ${job?.id} failed:`, err.message);
});

/**
 * Registers the repeatable email flush job.
 * Called once by the primary cluster process so it doesn't get re-registered
 * by every HTTP worker fork.
 */
export async function registerEmailFlushJob(): Promise<void> {
  await emailQueue.add(
    "flushEmailStack",
    {},
    {
      repeat: { every: EMAIL_FLUSH_INTERVAL_MS },
      jobId: "email-flush-repeatable",
    }
  );
  console.log(`[Email Queue] Repeatable flush job registered (every ${EMAIL_FLUSH_INTERVAL_MS}ms).`);
}

console.log("BullMQ Queues and Workers initialized.");
