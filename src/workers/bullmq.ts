import { Queue, Worker, Job } from "bullmq";
import { Redis } from "ioredis";
import { User } from "../models/user.js";
import { Product } from "../models/product.js";
import { Category } from "../models/category.js";
import { redisClient } from "../utils/redis.js";
import { encryptPassword } from "../utils/password.js";
import { sendWelcomeEmail } from "../services/email.js";
import { clearCachePattern } from "../utils/redis.js";
import { saveProductToCatalog } from "../utils/productHelper.js";


const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

// Separate Redis connection for BullMQ (maxRetriesPerRequest MUST be null)
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
 */
export async function flushBufferedUsers(): Promise<void> {
  if (!redisClient) return;

  const tempKey = `buffered:users:flushing:${Date.now()}`;
  try {
    // Atomically rename the set to isolate the batch and avoid race conditions with incoming signups
    const exists = await redisClient.exists("buffered:users");
    if (!exists) {
      return;
    }

    await redisClient.rename("buffered:users", tempKey);
    const rawUsers = await redisClient.smembers(tempKey);
    await redisClient.del(tempKey);

    if (!rawUsers || rawUsers.length === 0) return;

    console.log(`[Write-Back Queue] Processing batch of ${rawUsers.length} buffered signups...`);

    const usersToInsert: any[] = [];
    const emailsToDispatch: { email: string; name: string }[] = [];

    for (const rawUser of rawUsers) {
      try {
        const payload = JSON.parse(rawUser);

        // Check for email/phone duplicate against Mongoose database
        const existing = await User.findOne({
          $or: [{ email: payload.email.toLowerCase() }, { phone: payload.phone }],
        });

        if (existing) {
          console.warn(`[Write-Back Queue] Signup skipped. Email/phone already registered: ${payload.email}`);
          continue;
        }

        // Encrypt the password manually since insertMany bypasses document save hooks
        const passwordHash = encryptPassword(payload.password);

        usersToInsert.push({
          fullName: payload.fullName,
          email: payload.email.toLowerCase(),
          phone: payload.phone,
          passwordHash,
          role: payload.role || "customer",
          avatarUrl: payload.avatarUrl || "",
        });

        emailsToDispatch.push({
          email: payload.email,
          name: payload.fullName,
        });
      } catch (err: any) {
        console.error("[Write-Back Queue] Parsing single user payload failed:", err.message || err);
      }
    }

    if (usersToInsert.length > 0) {
      // Bulk insert into MongoDB in unordered fashion (allows other valid docs to proceed on failures)
      const inserted = await User.insertMany(usersToInsert, { ordered: false });
      console.log(`[Write-Back Queue] Successfully bulk-inserted ${inserted.length} users into MongoDB!`);

      // Dispatch welcome emails asynchronously
      for (const dispatch of emailsToDispatch) {
        sendWelcomeEmail(dispatch.email, dispatch.name);
      }
    }
  } catch (error: any) {
    console.error("[Write-Back Queue] Flush buffered signups failed:", error.message || error);
    // Cleanup temp key if rename succeeded but execution crashed
    if (redisClient) {
      await redisClient.del(tempKey).catch(() => {});
    }
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
  {
    connection: queueConnection,
  }
);

// ==========================================
// 2. SEQUENTIAL PRODUCT STREAMING QUEUE
// ==========================================
export const productQueue = new Queue("ProductQueue", {
  connection: queueConnection,
});

// Product streaming queue worker (Throttled processing with concurrency: 1)
export const productWorker = new Worker(
  "ProductQueue",
  async (job: Job) => {
    console.log(`[Product Stream Queue] Streaming product job started: ${job.id}`);
    const { sellerId, categoryId, title, description, brand, sku, pricePaise, comparePricePaise, inventory, tags } = job.data;

    try {
      // 1. Verify category exists
      const category = await Category.findById(categoryId);
      if (!category) {
        throw new Error(`Category not found with ID: ${categoryId}`);
      }

      // 2. Create and Save Product via the Catalog Helper
      const result = await saveProductToCatalog({
        sellerId,
        categoryId,
        title,
        description,
        brand,
        sku,
        pricePaise,
        comparePricePaise,
        inventory,
        tags,
        isActive: true,
        moderationStatus: "approved", // auto approved for stream tests
      });
      console.log(`[Product Stream Queue] Product saved successfully! ID: ${result.product._id}, SKU: ${sku}`);

      // 3. Clear Redis products list caches
      await clearCachePattern("products:list:*");
    } catch (err: any) {
      console.error(`[Product Stream Queue] Failed to stream product SKU ${sku}:`, err.message || err);
      throw err; // Fail the job so BullMQ registers it as failed
    }
  },
  {
    connection: queueConnection,
    concurrency: 1, // Enforce strict sequential streaming one-by-one
  }
);

console.log("BullMQ Queues and Workers initialized successfully.");
