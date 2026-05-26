import type { Request, Response, NextFunction } from "express";
import { redisClient, isRedisActive } from "../utils/redis.js";

// In-memory fallback map if Redis is not active or offline
interface MemoryRecord {
  count: number;
  resetTime: number;
}

const memoryStore = new Map<string, MemoryRecord>();

interface RateLimiterOptions {
  windowMs?: number;
  max?: number;
  message?: string;
}

/**
 * Enterprise-grade rate limiting middleware leveraging Redis.
 * Automatically falls back to a secure in-memory store if Redis is unavailable.
 */
export function rateLimiter({
  windowMs = 60 * 1000, // 1 minute window
  max = 100, // Limit each IP to 100 requests per windowMs by default
  message = "Too many requests from this IP, please try again later.",
}: RateLimiterOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Proactively resolve remote IP address
    const ip =
      req.ip ||
      (req.headers["x-forwarded-for"] as string) ||
      req.socket.remoteAddress ||
      "unknown-ip";

    const key = `ratelimit:${req.baseUrl || req.path}:${ip}`;

    if (isRedisActive && redisClient) {
      try {
        const current = await redisClient.get(key);
        if (current !== null) {
          const count = parseInt(current, 10);
          if (count >= max) {
            res.status(429).json({
              success: false,
              message,
            });
            return;
          }
          await redisClient.incr(key);
        } else {
          // Set key with TTL in seconds
          const ttlSeconds = Math.ceil(windowMs / 1000);
          await redisClient.set(key, "1", "EX", ttlSeconds);
        }
        next();
        return;
      } catch (err) {
        console.warn("Rate limiter Redis failure, falling back to memory store:", err);
        handleMemoryLimit(key, max, windowMs, res, next, message);
        return;
      }
    }

    // Direct fallback to in-memory rate limiting if Redis connection is not established
    handleMemoryLimit(key, max, windowMs, res, next, message);
  };
}

/**
 * Helper to process in-memory rate limiting when Redis is unavailable.
 */
function handleMemoryLimit(
  key: string,
  max: number,
  windowMs: number,
  res: Response,
  next: NextFunction,
  message: string
): void {
  const now = Date.now();
  const record = memoryStore.get(key);

  if (!record || now > record.resetTime) {
    memoryStore.set(key, {
      count: 1,
      resetTime: now + windowMs,
    });
    next();
  } else {
    record.count += 1;
    if (record.count > max) {
      res.status(429).json({
        success: false,
        message,
      });
    } else {
      next();
    }
  }
}
