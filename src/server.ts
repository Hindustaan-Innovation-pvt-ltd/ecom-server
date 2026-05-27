import dns from "node:dns";
// Solve Node.js v18+ Windows IPv6 name resolution lookup fetch failure bug
dns.setDefaultResultOrder("ipv4first");

import cluster from "node:cluster";
import os from "node:os";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieSession from "cookie-session";
import passport from "passport";
import { connectDB } from "./utils/db.js";
import authRouter from "./routes/auth.js";
import sellerRouter from "./routes/seller.js";
import addressRouter from "./routes/address.js";
import productRouter from "./routes/product.js";
import cartRouter from "./routes/cart.js";
import couponRouter from "./routes/coupon.js";
import orderRouter from "./routes/order.js";
import webhookRouter from "./routes/webhook.js";
import reviewAndQARouter from "./routes/reviewAndQA.js";
import shippingAndStoreRouter from "./routes/shippingAndStore.js";
import { userQueue, emailQueue, registerEmailFlushJob } from "./workers/bullmq.js";
import { rateLimiter } from "./middleware/rateLimiter.js";

// Load Passport Configuration
import "./config/passport.js";

const isProd = process.env.NODE_ENV === "production";

// ─── HTTP Server ───────────────────────────────────────────────────────────────

class Server {
  private app: express.Express;

  constructor() {
    this.app = express();

    // ── Core middlewares ───────────────────────────────────────────────────────
    this.app.use(cors());
    this.app.use(helmet({
      crossOriginResourcePolicy: false,
    }));

    this.app.use(morgan(isProd ? "combined" : "dev"));

    // Body parsers with size limits to prevent memory exhaustion attacks
    this.app.use(express.json({ limit: "1mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "1mb" }));

    // ── Cookie session ─────────────────────────────────────────────────────────
    this.app.use(
      cookieSession({
        name: "session",
        keys: [process.env.SESSION_SECRET || "cookie-session-secret-key-for-hmarketplace"],
        maxAge: 7 * 24 * 60 * 60 * 1000,
        secure: isProd && process.env.COOKIE_SECURE === "true",
        httpOnly: true,
      })
    );

    // Compatibility layer for Passport 0.6+ and cookie-session
    this.app.use((req, _res, next) => {
      if (req.session) {
        if (!req.session.regenerate) {
          req.session.regenerate = (cb: () => void) => { if (cb) cb(); };
        }
        if (!req.session.save) {
          req.session.save = (cb: () => void) => { if (cb) cb(); };
        }
      }
      next();
    });

    this.app.use(passport.initialize());
    this.app.use(passport.session());

    // Static files
    this.app.use("/uploads", express.static("uploads"));

    // ── Rate Limiting ──────────────────────────────────────────────────────────
    const apiLimiter = rateLimiter({
      windowMs: 15 * 60 * 1000,
      max: 500,
      message: "Too many requests from this IP, please try again in 15 minutes.",
    });

    const sensitiveLimiter = rateLimiter({
      windowMs: 1 * 60 * 1000,
      max: 10,
      message: "Too many authentication or registration attempts. Please try again after 60 seconds.",
    });

    if (isProd) {
      this.app.use("/api/auth/register", sensitiveLimiter);
      this.app.use("/api/auth/login", sensitiveLimiter);
      this.app.use("/api/seller/register", sensitiveLimiter);
      this.app.use("/api", apiLimiter);
    } else {
      console.log("Rate limiting is disabled in development mode.");
    }

    // ── Routes ─────────────────────────────────────────────────────────────────
    this.app.use("/api/auth", authRouter);
    this.app.use("/api/seller", sellerRouter);
    this.app.use("/api/address", addressRouter);
    this.app.use("/api/product", productRouter);
    this.app.use("/api/cart", cartRouter);
    this.app.use("/api/coupons", couponRouter);
    this.app.use("/api/orders", orderRouter);
    this.app.use("/api/webhooks", webhookRouter);
    this.app.use("/api", reviewAndQARouter);
    this.app.use("/api", shippingAndStoreRouter);

    this.app.get("/health", (_req, res) => {
      res.status(200).json({ success: true, message: "Server is healthy." });
    });
  }

  public async listen(port: number) {
    await connectDB();

    // Register the repeatable user write-back flush job
    userQueue.add(
      "flushBufferedUsers",
      {},
      {
        repeat: { every: 10000 },
        jobId: "flush-job-repeatable",
      }
    ).then(() => {
      console.log("[UserQueue] Repeatable flush job registered.");
    }).catch(err => {
      console.error("[UserQueue] Failed to register flush job:", err);
    });

    this.app.listen(port, () => {
      isProd
        ? console.log(`[HTTP Worker ${process.pid}] Listening on port ${port}`)
        : console.log(`Server is running on port ${port}`);
    });
  }
}

// ─── Email Worker Process ──────────────────────────────────────────────────────

/**
 * Runs in the cluster worker designated WORKER_ROLE=email.
 * This process does NOT start an HTTP server — it only:
 *   1. Connects to MongoDB (needed by some email logic)
 *   2. Processes EmailQueue jobs (BCC-batched email flushes)
 *   3. Processes UserQueue jobs (write-back signup flushes)
 */
async function runEmailWorker(): Promise<void> {
  console.log(`[Email Worker ${process.pid}] Starting dedicated email worker...`);
  await connectDB();

  // Register the repeatable email flush job (only once, from this worker)
  await registerEmailFlushJob();

  console.log(`[Email Worker ${process.pid}] Ready. Listening for email queue jobs.`);

  // Keep the process alive — BullMQ workers are event-driven
  process.on("SIGINT", () => {
    console.log(`[Email Worker ${process.pid}] Shutting down gracefully...`);
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    console.log(`[Email Worker ${process.pid}] Shutting down gracefully...`);
    process.exit(0);
  });
}

// ─── Cluster Bootstrap ─────────────────────────────────────────────────────────

if (cluster.isPrimary) {
  const desiredWorkers = parseInt(process.env.CLUSTER_WORKERS || String(os.cpus().length), 10);
  // Ensure at least 2 total: 1 dedicated email worker + 1 HTTP worker
  const totalWorkers = Math.max(2, desiredWorkers);
  const httpWorkers = totalWorkers - 1; // Reserve 1 cluster slot for email

  console.log(`[Primary ${process.pid}] Spawning ${totalWorkers} worker(s): ${httpWorkers} HTTP + 1 Email`);

  // Fork the dedicated email worker first (Worker ID 1)
  const emailWorkerProcess = cluster.fork({ WORKER_ROLE: "email" });
  console.log(`[Primary] Email worker forked (pid: ${emailWorkerProcess.process.pid})`);

  // Fork HTTP workers
  for (let i = 0; i < httpWorkers; i++) {
    const w = cluster.fork({ WORKER_ROLE: "http" });
    console.log(`[Primary] HTTP worker ${i + 1}/${httpWorkers} forked (pid: ${w.process.pid})`);
  }

  cluster.on("exit", (worker, code, signal) => {
    const role = (worker.process as any).env?.WORKER_ROLE || "http";
    console.warn(`[Primary] Worker ${worker.id} (${role}, pid: ${worker.process.pid}) exited (code: ${code}, signal: ${signal})`);

    if (isProd) {
      // Re-fork with the same role so the cluster stays balanced
      const env = role === "email" ? { WORKER_ROLE: "email" } : { WORKER_ROLE: "http" };
      const newWorker = cluster.fork(env);
      console.log(`[Primary] Re-forked ${role} worker (new pid: ${newWorker.process.pid})`);
    }
  });

} else if (cluster.worker) {
  // ── Determine this worker's role from the env var injected by primary ──────
  const workerRole = process.env.WORKER_ROLE || "http";

  if (workerRole === "email") {
    // This cluster worker is the dedicated email dispatcher
    runEmailWorker().catch(err => {
      console.error("[Email Worker] Fatal startup error:", err);
      process.exit(1);
    });
  } else {
    // All other workers run the HTTP server
    const app = new Server();
    app.listen(
      isProd ? parseInt(process.env.PORT || "3000", 10) : 3000,
    );
  }
}