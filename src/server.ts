import dns from "node:dns";
// Solve Node.js v18+ Windows IPv6 name resolution lookup fetch failure bug
dns.setDefaultResultOrder("ipv4first");

import cluster from "node:cluster";
import os from "node:os";
import http from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import cookieSession from "cookie-session";
import passport from "passport";
import mongoose from "mongoose";
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
  private serverInstance?: http.Server;

  constructor() {
    this.app = express();

    // ── Core middlewares ───────────────────────────────────────────────────────
    this.app.use(cors());
    this.app.use(helmet({
      crossOriginResourcePolicy: false,
    }));
    
    // Enable response compression (gzip/deflate) to save bandwidth
    this.app.use(compression());

    // Switch morgan logging format depending on environment
    this.app.use(morgan(isProd ? "combined" : "dev"));

    // Enable trust proxy so rate limiters and logs resolve correct client IPs behind load balancers
    this.app.set("trust proxy", process.env.TRUST_PROXY || "loopback, linklocal, uniquelocal");

    // Body parsers with size limits to prevent memory exhaustion attacks
    this.app.use(express.json({ limit: "1mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "1mb" }));

    // ── Telemetry IPC Middleware ──────────────────────────────────────────────
    // Reports active connection statistics to primary process for load distribution reports
    this.app.use((req, res, next) => {
      if (process.send) {
        process.send({ type: "request_start", pid: process.pid, url: req.url, method: req.method });
      }
      res.on("finish", () => {
        if (process.send) {
          process.send({ type: "request_end", pid: process.pid });
        }
      });
      next();
    });

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

    const server = this.app.listen(port, () => {
      isProd
        ? console.log(`[HTTP Worker ${process.pid}] Listening on port ${port}`)
        : console.log(`Server is running on port ${port}`);
    });
    
    this.serverInstance = server;

    // Tune Keep-Alive timeouts for upstream reverse proxies (Nginx, AWS ALB)
    // keepAliveTimeout should be slightly longer than proxy's timeout to prevent race conditions (502s)
    server.keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT || "61000", 10);
    server.headersTimeout = parseInt(process.env.HEADERS_TIMEOUT || "62000", 10);
    server.maxConnections = parseInt(process.env.MAX_CONNECTIONS || "10000", 10);
  }

  /**
   * Shuts down the HTTP listener and database connections gracefully, draining active requests.
   */
  public async gracefulShutdown(signal: string) {
    console.log(`[HTTP Worker ${process.pid}] Received ${signal}. Starting graceful shutdown...`);

    if (this.serverInstance) {
      // Stop accepting new connections
      this.serverInstance.close(() => {
        console.log(`[HTTP Worker ${process.pid}] HTTP server closed. Drained all active connections.`);
      });

      // Safety timeout to force-exit if draining takes too long
      const forceExitTimeout = setTimeout(() => {
        console.warn(`[HTTP Worker ${process.pid}] Graceful shutdown timed out. Forcing exit.`);
        process.exit(1);
      }, 10000);

      try {
        await mongoose.connection.close();
        console.log(`[HTTP Worker ${process.pid}] MongoDB connection closed gracefully.`);

        clearTimeout(forceExitTimeout);
        process.exit(0);
      } catch (err) {
        console.error(`[HTTP Worker ${process.pid}] Error during shutdown:`, err);
        process.exit(1);
      }
    } else {
      process.exit(0);
    }
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

  const shutdown = async (signal: string) => {
    console.log(`[Email Worker ${process.pid}] Shutting down gracefully on ${signal}...`);
    try {
      await mongoose.connection.close();
      console.log(`[Email Worker ${process.pid}] MongoDB connection closed gracefully.`);
      process.exit(0);
    } catch (err) {
      console.error(`[Email Worker ${process.pid}] Error during email worker shutdown:`, err);
      process.exit(1);
    }
  };

  process.on("message", (msg) => {
    if (msg === "shutdown") {
      shutdown("IPC_SHUTDOWN");
    }
  });
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ─── Cluster Bootstrap ─────────────────────────────────────────────────────────

if (cluster.isPrimary) {
  // Explicitly set Round-Robin scheduling policy.
  // On Windows, the default is SCHED_NONE (OS-managed), which distributes requests extremely poorly.
  // SCHED_RR forces Node.js to distribute incoming connections evenly among all HTTP workers.
  cluster.schedulingPolicy = cluster.SCHED_RR;

  const desiredWorkers = parseInt(process.env.CLUSTER_WORKERS || String(os.cpus().length), 10);
  // Ensure at least 2 total: 1 dedicated email worker + 1 HTTP worker
  const totalWorkers = Math.max(2, desiredWorkers);
  const httpWorkers = totalWorkers - 1; // Reserve 1 cluster slot for email

  console.log(`[Primary ${process.pid}] Spawning ${totalWorkers} worker(s): ${httpWorkers} HTTP + 1 Email`);

  // Telemetry store
  interface WorkerStats {
    pid: number;
    role: "http" | "email";
    status: "online" | "exited";
    activeRequests: number;
    totalRequests: number;
    startedAt: number;
  }

  const workerTelemetry = new Map<number, WorkerStats>();

  const registerWorkerTelemetry = (worker: any, role: "http" | "email") => {
    const pid = worker.process.pid;
    if (!pid) return;

    workerTelemetry.set(pid, {
      pid,
      role,
      status: "online",
      activeRequests: 0,
      totalRequests: 0,
      startedAt: Date.now(),
    });

    worker.on("message", (msg: any) => {
      if (!msg || typeof msg !== "object") return;
      const stats = workerTelemetry.get(pid);
      if (!stats) return;

      if (msg.type === "request_start") {
        stats.activeRequests++;
        stats.totalRequests++;
      } else if (msg.type === "request_end") {
        stats.activeRequests = Math.max(0, stats.activeRequests - 1);
      }
    });
  };

  // Fork the dedicated email worker first (Worker ID 1)
  const emailWorkerProcess = cluster.fork({ WORKER_ROLE: "email" });
  console.log(`[Primary] Email worker forked (pid: ${emailWorkerProcess.process.pid})`);
  registerWorkerTelemetry(emailWorkerProcess, "email");

  // Fork HTTP workers
  for (let i = 0; i < httpWorkers; i++) {
    const w = cluster.fork({ WORKER_ROLE: "http" });
    console.log(`[Primary] HTTP worker ${i + 1}/${httpWorkers} forked (pid: ${w.process.pid})`);
    registerWorkerTelemetry(w, "http");
  }

  // Periodic Telemetry Logger Dashboard
  const telemetryInterval = setInterval(() => {
    console.log("\n┌────────────────────────────────────────────────────────────────────────┐");
    console.log("│  HMARKETPLACE CLUSTER REAL-TIME LOAD BALANCER TELEMETRY                │");
    console.log("├───────────┬─────────┬──────────────┬──────────────────┬────────────────┤");
    console.log("│ WORKER    │ ROLE    │ STATUS       │ ACTIVE REQUESTS  │ TOTAL REQUESTS │");
    console.log("├───────────┼─────────┼──────────────┼──────────────────┼────────────────┤");

    for (const stats of workerTelemetry.values()) {
      const pad = (val: string | number, length: number) => {
        const s = String(val);
        return s + " ".repeat(Math.max(0, length - s.length));
      };

      const pidStr = pad(`PID ${stats.pid}`, 9);
      const roleStr = pad(stats.role, 7);
      const statusStr = pad(stats.status, 12);
      const activeStr = stats.role === "email" ? pad("N/A (worker)", 16) : pad(stats.activeRequests, 16);
      const totalStr = stats.role === "email" ? pad("N/A (worker)", 14) : pad(stats.totalRequests, 14);

      console.log(`│ ${pidStr} │ ${roleStr} │ ${statusStr} │ ${activeStr} │ ${totalStr} │`);
    }
    console.log("└───────────┴─────────┴──────────────┴──────────────────┴────────────────┘\n");
  }, 15000);

  // Restart crashed workers in production, update telemetry
  cluster.on("exit", (worker, code, signal) => {
    const role = (worker.process as any).env?.WORKER_ROLE || "http";
    const pid = worker.process.pid;
    console.warn(`[Primary] Worker ${worker.id} (${role}, pid: ${pid}) exited (code: ${code}, signal: ${signal})`);

    if (pid) {
      const stats = workerTelemetry.get(pid);
      if (stats) {
        stats.status = "exited";
        stats.activeRequests = 0;
      }
    }

    if (isProd) {
      const env = role === "email" ? { WORKER_ROLE: "email" } : { WORKER_ROLE: "http" };
      const newWorker = cluster.fork(env);
      console.log(`[Primary] Re-forked ${role} worker (new pid: ${newWorker.process.pid})`);
      registerWorkerTelemetry(newWorker, role);
    }
  });

  // Coordinated Graceful Shutdown for Primary & Workers
  const primaryShutdown = async (signal: string) => {
    console.log(`\n[Primary ${process.pid}] Received ${signal}. Initiating cluster graceful shutdown...`);
    clearInterval(telemetryInterval);

    let activeWorkers = 0;
    for (const id in cluster.workers) {
      const worker = cluster.workers[id];
      if (worker && worker.isConnected()) {
        activeWorkers++;
        worker.send("shutdown");
      }
    }

    console.log(`[Primary] Sent shutdown signal to ${activeWorkers} active workers.`);

    const forceExit = setTimeout(() => {
      console.warn("[Primary] Force exiting primary process due to graceful shutdown timeout.");
      process.exit(1);
    }, 12000);

    let exitCount = 0;
    cluster.on("exit", () => {
      exitCount++;
      if (Object.keys(cluster.workers || {}).length === 0 || exitCount >= activeWorkers) {
        console.log("[Primary] All workers exited gracefully. Shutting down.");
        clearTimeout(forceExit);
        process.exit(0);
      }
    });

    if (activeWorkers === 0) {
      console.log("[Primary] No active workers to shut down.");
      clearTimeout(forceExit);
      process.exit(0);
    }
  };

  process.on("SIGINT", () => primaryShutdown("SIGINT"));
  process.on("SIGTERM", () => primaryShutdown("SIGTERM"));

} else if (cluster.worker) {
  const workerRole = process.env.WORKER_ROLE || "http";

  if (workerRole === "email") {
    runEmailWorker().catch(err => {
      console.error("[Email Worker] Fatal startup error:", err);
      process.exit(1);
    });
  } else {
    const app = new Server();
    app.listen(
      isProd ? parseInt(process.env.PORT || "3000", 10) : 3000,
    );

    // Dynamic graceful shutdown triggers
    process.on("message", (msg) => {
      if (msg === "shutdown") {
        app.gracefulShutdown("IPC_SHUTDOWN").catch(() => process.exit(1));
      }
    });

    process.on("SIGINT", () => {
      app.gracefulShutdown("SIGINT").catch(() => process.exit(1));
    });

    process.on("SIGTERM", () => {
      app.gracefulShutdown("SIGTERM").catch(() => process.exit(1));
    });
  }
}