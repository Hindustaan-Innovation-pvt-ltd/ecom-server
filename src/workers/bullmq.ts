// import { Queue, Worker, type Job } from "bullmq";
// import { Redis } from "ioredis";
// import { User } from "../models/user.js";
// import { Category } from "../models/category.js";
// import { redisClient } from "../utils/redis.js";
// import { encryptPassword } from "../utils/password.js";
// import { enqueueWelcomeEmail, flushEmailStack } from "../services/email.js";
// import { clearCachePattern } from "../utils/redis.js";
// import { saveProductToCatalog } from "../utils/productHelper.js";
// import { dispatchWebhookEvent } from "../services/webhookDispatcher.js";

// const isServerless = !!(
//   process.env.NETLIFY ||
//   process.env.SERVERLESS ||
//   process.env.LAMBDA_TASK_ROOT ||
//   process.env.AWS_EXECUTION_ENV
// );

// const REDIS_URL = process.env.REDIS_URL || (process.env.NODE_ENV === "development" ? "redis://127.0.0.1:6380" : "redis://127.0.0.1:6379");

// // Dedicated Redis connection for BullMQ Workers (must have maxRetriesPerRequest: null)
// // Only instantiated inside the dedicated background worker process
// const workerConnection = (!isServerless && process.env.WORKER_ROLE === "email") ? new Redis(REDIS_URL, {
//   maxRetriesPerRequest: null,
// }) : undefined;

// if (workerConnection) {
//   workerConnection.on("error", (err: unknown) => {
//     const message = err instanceof Error ? err.message : String(err);
//     console.warn(`[BullMQ Worker Connection] Redis warning: ${message}`);
//   });
// }

// ==========================================
// 1. USER BUFFER WRITE-BACK QUEUE
// ==========================================
export const userQueue: any = null;

/**
 * Atomic write-back flush job.
 * Pops all buffered signups from Redis set "buffered:users", validates and bulk-inserts them.
 * Emails are pushed to the email stack — NOT dispatched here — the EmailWorker handles them.
 */
export async function flushBufferedUsers(): Promise<void> {
  /*
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
  */
}

// User repeatable flush worker
export const userWorker: any = null;

// ==========================================
// 2. SEQUENTIAL PRODUCT STREAMING QUEUE
// ==========================================
export const productQueue: any = null;

export const productWorker: any = null;

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
export const emailQueue: any = null;

// Flush interval — default 30 seconds, configurable via env
// const EMAIL_FLUSH_INTERVAL_MS = parseInt(
//   process.env.EMAIL_FLUSH_INTERVAL_MS || "30000",
//   10
// );

/**
 * Dedicated email worker. Runs ONLY in the cluster worker designated as
 * WORKER_ROLE=email. Concurrency 1 ensures one flush runs at a time.
 */
export const emailWorker: any = null;

// ==========================================
// 4. TRANSLATION QUEUE (Background Workers)
// ==========================================
export const translationQueue: any = null;

export const translationWorker: any = null;

/**
 * Registers the repeatable email flush job.
 * Called once by the primary cluster process so it doesn't get re-registered
 * by every HTTP worker fork.
 */
export async function registerEmailFlushJob(): Promise<void> {
  /*
  await emailQueue.add(
    "flushEmailStack",
    {},
    {
      repeat: { every: EMAIL_FLUSH_INTERVAL_MS },
      jobId: "email-flush-repeatable",
    }
  );
  console.log(`[Email Queue] Repeatable flush job registered (every ${EMAIL_FLUSH_INTERVAL_MS}ms).`);
  */
}

export async function registerUserFlushJob(): Promise<void> {
  /*
  await userQueue.add(
    "flushBufferedUsers",
    {},
    {
      repeat: { every: 10000 },
      jobId: "flush-job-repeatable",
    }
  );
  console.log("[User Queue] Repeatable flush job registered (every 10000ms).");
  */
}

console.log("BullMQ Queues and Workers disabled (commented out).");
