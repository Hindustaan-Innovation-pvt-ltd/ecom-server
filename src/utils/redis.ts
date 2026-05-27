import { Redis } from "ioredis";

let REDIS_URL: string;
if (process.env.NODE_ENV != "development") {
  REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
} else {
  REDIS_URL = "redis://127.0.0.1:6380";
}

let redisClient: Redis | null = null;
let isRedisActive = false;

try {
  console.log(`Connecting to Redis at: ${REDIS_URL}`);
  
  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1, // Fail quickly if Redis is offline so we can trigger the fallback
    retryStrategy(times: number) {
      // Allow up to 3 attempts during initialization, then disable caching gracefully
      if (times > 3) {
        console.warn("Redis connection timed out permanently. Continuing in graceful DB fallback mode.");
        isRedisActive = false;
        return null; // Stops retrying
      }
      return Math.min(times * 200, 1000);
    },
  });

  redisClient.on("connect", () => {
    console.log("Redis client is connecting...");
  });

  redisClient.on("ready", () => {
    console.log("Redis connection established successfully. Caching is active.");
    isRedisActive = true;
  });

  redisClient.on("error", (err: unknown) => {
    // Gracefully catch connection errors (e.g., ECONNREFUSED) without crashing
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Redis client warning: ${message}`);
    isRedisActive = false;
  });

  redisClient.on("end", () => {
    console.log("Redis client connection closed. Caching is disabled.");
    isRedisActive = false;
  });

} catch (error) {
  console.error("Failed to initialize Redis client:", error);
  isRedisActive = false;
}

/**
 * Retrieves a parsed value from the Redis cache.
 */
export async function getCache<T>(key: string): Promise<T | null> {
  if (!isRedisActive || !redisClient) {
    return null;
  }
  try {
    const cachedData = await redisClient.get(key);
    if (!cachedData) return null;
    return JSON.parse(cachedData) as T;
  } catch (err) {
    console.error(`Error reading from Redis cache for key "${key}":`, err);
    return null;
  }
}

/**
 * Saves any JSON-serializable data to the Redis cache with an optional TTL (seconds).
 */
export async function setCache(key: string, data: unknown, ttlSeconds?: number): Promise<void> {
  if (!isRedisActive || !redisClient) {
    return;
  }
  try {
    const serializedData = JSON.stringify(data);
    if (ttlSeconds && ttlSeconds > 0) {
      await redisClient.set(key, serializedData, "EX", ttlSeconds);
    } else {
      await redisClient.set(key, serializedData);
    }
  } catch (err) {
    console.error(`Error writing to Redis cache for key "${key}":`, err);
  }
}

/**
 * Deletes a single key or array of keys from the Redis cache.
 */
export async function deleteCache(key: string | string[]): Promise<void> {
  if (!isRedisActive || !redisClient) {
    return;
  }
  try {
    const keysToDelete = Array.isArray(key) ? key : [key];
    if (keysToDelete.length > 0) {
      await redisClient.del(...keysToDelete);
    }
  } catch (err) {
    console.error(`Error deleting Redis cache key(s) "${key}":`, err);
  }
}

/**
 * Clears keys matching a specific glob pattern from the Redis cache.
 * Uses SCAN cursor iteration instead of KEYS to avoid blocking Redis.
 * KEYS is O(N) and blocks the entire server; SCAN yields between batches.
 */
export async function clearCachePattern(pattern: string): Promise<void> {
  if (!isRedisActive || !redisClient) {
    return;
  }
  try {
    let cursor = "0";
    const keysToDelete: string[] = [];

    do {
      // SCAN returns [nextCursor, [keys]] — each call processes a small batch
      const [nextCursor, batchKeys] = await redisClient.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100  // Process up to 100 keys per iteration (non-blocking)
      );
      cursor = nextCursor;
      keysToDelete.push(...batchKeys);
    } while (cursor !== "0"); // cursor === "0" signals the full iteration is complete

    if (keysToDelete.length > 0) {
      // Delete in one round-trip using pipeline
      await redisClient.del(...keysToDelete);
      console.log(`Cleared ${keysToDelete.length} cached keys matching pattern: ${pattern}`);
    }
  } catch (err) {
    console.error(`Error clearing Redis cache pattern "${pattern}":`, err);
  }
}

export { redisClient, isRedisActive };
