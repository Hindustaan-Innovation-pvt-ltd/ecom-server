# Change: Remove Redis Buffering from Customer Registration

**Date:** 2026-06-04  
**File:** `src/controller/auth.ts`  
**Type:** Bug Fix / Behaviour Change

---

## Problem

When Redis was active in production, `POST /api/v1/auth/register` for customers silently bypassed MongoDB and instead queued the user payload into a Redis set (`buffered:users`) for deferred bulk-write processing.

This caused two serious issues for the frontend:

1. **No JWT was issued** — the response was `202 Accepted` with `{ buffered: true }` and no `token` field, breaking any client that expected to be logged in after registration.
2. **User did not exist in the database immediately** — any subsequent API call (e.g. `GET /auth/me`) would fail until the background flush worker drained the Redis queue, which introduced an unpredictable delay.

---

## What Changed

Removed the Redis write-back buffering block from the `register` controller entirely.

Customer registration now **always writes directly to MongoDB**, establishes a Passport session, and returns `201` with the user object and JWT — in every environment, every time.

---

## Code Diff

```diff
// src/controller/auth.ts

-import { redisClient, isRedisActive } from "../utils/redis.js";

  // 3. File uploads (avatar profile picture)
  let avatarUrl = "";
  if (file) { ... }

- // 4. Check if we should use high-throughput write-back buffering via Redis (Production only)
- if (process.env.NODE_ENV === "production" && isRedisActive && redisClient) {
-   const payload = {
-     fullName,
-     email,
-     phone,
-     password, // Raw password, hashed during flush bulk insert
-     role,
-     avatarUrl,
-   };
-   await redisClient.sadd("buffered:users", JSON.stringify(payload));
-
-   res.status(202).json({
-     success: true,
-     message: "Your registration onboarding request is queued and is being processed asynchronously.",
-     buffered: true,
-   });
-   return;
- }

+ // 4. Save user directly to MongoDB
  const user = new User({
    fullName,
    email,
    phone,
    passwordHash: password,
    role,
    avatarUrl,
  });

  await user.save();
```

---

## Behaviour Before vs After

| | Before (with Redis active in prod) | After |
|---|---|---|
| **HTTP Status** | `202 Accepted` | `201 Created` |
| **Token issued** | ❌ No | ✅ Yes |
| **User in DB** | ⏳ Eventually (async flush) | ✅ Immediately |
| **Session established** | ❌ No | ✅ Yes (Passport) |
| **Welcome email sent** | ❌ During flush (delayed) | ✅ Immediately (background) |
| **`buffered` field** | `true` | Not present |

---

## Registration Response (Now Consistent Everywhere)

`POST /api/v1/auth/register` — `201 Created`

```json
{
  "success": true,
  "message": "User registered and logged in successfully.",
  "user": {
    "_id": "665b1234abc...",
    "fullName": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+91-9876543210",
    "avatarUrl": "https://res.cloudinary.com/...",
    "role": "customer",
    "isActive": true,
    "createdAt": "2026-06-04T12:00:00.000Z",
    "updatedAt": "2026-06-04T12:00:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

## What Was NOT Changed

| Component | Status | Notes |
|-----------|--------|-------|
| Redis import in `auth.ts` | ❌ Removed | No longer needed by this file |
| `buffered:users` Redis set | Preserved | Still used by the BullMQ email flush worker for other purposes |
| `isRedisActive` / `redisClient` in `redis.ts` | ✅ Untouched | Still used by rate limiter, seller analytics cache, and BullMQ |
| Seller registration (`/seller/register`) | ✅ Untouched | Was never buffered — writes directly to DB |
| Rate limiting on `/auth/register` | ✅ Untouched | Still enforced in production (10 req/min) |

---

## Notes

> [!NOTE]
> The Redis `ECONNREFUSED` errors visible in the dev console are **unrelated to this change**. They occur because Redis is not running locally. The app handles this gracefully — the rate limiter falls back to its in-memory store, and Redis-optional features (caching, BullMQ) degrade silently. The core registration flow is unaffected.
