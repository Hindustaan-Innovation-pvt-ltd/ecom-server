import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
console.log(`Connecting to Redis at: ${REDIS_URL}`);

const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 1,
});

redis.on("ready", async () => {
  console.log("Connected to Redis. Sending FLUSHALL command...");
  try {
    const result = await redis.flushall();
    console.log(`Redis flush status: ${result}`);
  } catch (err) {
    console.error("Failed to flush Redis:", err);
  } finally {
    redis.disconnect();
    process.exit(0);
  }
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err);
  process.exit(1);
});
