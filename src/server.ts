import dns from "node:dns";
import "./config/sentry.js"
// Solve Node.js v18+ Windows IPv6 name resolution lookup fetch failure bug
dns.setDefaultResultOrder("ipv4first");

import cluster from "node:cluster";
import http from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
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
import wishlistRouter from "./routes/wishlist.js";
import couponRouter from "./routes/coupon.js";
import orderRouter from "./routes/order.js";
import webhookRouter from "./routes/webhook.js";
import reviewAndQARouter from "./routes/reviewAndQA.js";
import shippingAndStoreRouter from "./routes/shippingAndStore.js";
import adminRouter from "./routes/admin.js";
import { registerEmailFlushJob, registerUserFlushJob } from "./workers/bullmq.js";
import { rateLimiter } from "./middleware/rateLimiter.js";
import * as Sentry from "@sentry/node"

// Load Passport Configuration
import "./config/passport.js";

const isNetlifyDeployment = Boolean(process.env.NETLIFY && process.env.NETLIFY !== "false");
const isProd = process.env.NODE_ENV === "production" || isNetlifyDeployment;

const cookieSameSite = (process.env.COOKIE_SAME_SITE as "lax" | "strict" | "none" | undefined) ?? (isNetlifyDeployment ? "none" : "lax");
const cookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === "true"
  : isNetlifyDeployment;

// ─── HTTP Server ───────────────────────────────────────────────────────────────

export class Server {
  public app: express.Express;
  private serverInstance?: http.Server;

  constructor() {
    this.app = express();

    // ── Core middlewares ───────────────────────────────────────────────────────
    this.app.use(cors({
      origin: "*",
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      optionsSuccessStatus: 200,
    }));
    this.app.use(helmet({
      crossOriginResourcePolicy: false,
    }));

    // Enable response compression (gzip/deflate) to save bandwidth
    this.app.use(compression());

    // Switch morgan logging format depending on environment
    this.app.use(morgan(isProd ? "combined" : "dev"));

    // Enable trust proxy so rate limiters and logs resolve correct client IPs behind load balancers
    this.app.set("trust proxy", process.env.TRUST_PROXY || (isProd ? 1 : "loopback, linklocal, uniquelocal"));

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
        sameSite: cookieSameSite,
        secure: cookieSecure,
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

    const currentPrefix = process.env.NODE_API_PREFIX || "/api/v1";
    const apiPrefixes = [currentPrefix];
    if (currentPrefix !== "/api") {
      apiPrefixes.push("/api");
    }

    if (isProd) {
      this.app.use(apiPrefixes.map(p => `${p}/auth/register`), sensitiveLimiter);
      this.app.use(apiPrefixes.map(p => `${p}/auth/login`), sensitiveLimiter);
      this.app.use(apiPrefixes.map(p => `${p}/seller/register`), sensitiveLimiter);
      this.app.use(apiPrefixes, apiLimiter);
    } else {
      console.log("Rate limiting is disabled in development mode.");
    }

    // ── Routes ─────────────────────────────────────────────────────────────────
    this.app.use(apiPrefixes.map(p => `${p}/auth`), authRouter);
    this.app.use(apiPrefixes.map(p => `${p}/seller`), sellerRouter);
    this.app.use(apiPrefixes.map(p => `${p}/address`), addressRouter);
    this.app.use(apiPrefixes.map(p => `${p}/product`), productRouter);
    this.app.use(apiPrefixes.map(p => `${p}/cart`), cartRouter);
    this.app.use(apiPrefixes.map(p => `${p}/wishlist`), wishlistRouter);
    this.app.use(apiPrefixes.map(p => `${p}/coupons`), couponRouter);
    this.app.use(apiPrefixes.map(p => `${p}/orders`), orderRouter);
    this.app.use(apiPrefixes.map(p => `${p}/webhooks`), webhookRouter);
    this.app.use(apiPrefixes.map(p => `${p}/admin`), adminRouter);
    this.app.use(apiPrefixes, reviewAndQARouter);
    this.app.use(apiPrefixes, shippingAndStoreRouter);

    this.app.get("/health", (_req, res) => {
      res.status(200).json({ success: true, message: "Server is healthy." });
    });

    // Test endpoint to trigger a simple error (legacy compatibility)
    this.app.get("/debug-sentry", function mainHandler(req: Request, res: Response) {
      throw new Error("My first Sentry error!");
    });

    // ── Sentry Debug Endpoints ───────────────────────────────────────────────

    // 1. Synchronous error throwing
    this.app.get("/debug-sentry/sync-error", (req: Request, res: Response) => {
      throw new Error("Sentry Debug: Synchronous error occurred");
    });

    // 2. Asynchronous error throwing
    this.app.get("/debug-sentry/async-error", async (req: Request, res: Response) => {
      throw new Error("Sentry Debug: Asynchronous error occurred");
    });

    // 3. Manually captured exception using Sentry SDK
    this.app.get("/debug-sentry/captured-error", (req: Request, res: Response) => {
      try {
        throw new Error("Sentry Debug: Manually captured exception");
      } catch (err) {
        const eventId = Sentry.captureException(err);
        res.status(200).json({
          success: true,
          message: "Exception successfully captured manually.",
          eventId,
        });
      }
    });

    // 4. Performance tracing test (simulating a slow operational latency)
    this.app.get("/debug-sentry/performance", async (req: Request, res: Response) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      res.status(200).json({
        success: true,
        message: "Performance tracing / APM transaction test completed.",
      });
    });

    // The Sentry error handler must be registered before any other error middleware and after all controllers
    Sentry.setupExpressErrorHandler(this.app);

    this.app.use(function onError(err: Error, req: Request, res: Response, next: NextFunction) {
      // The error id is attached to `res.sentry` to be returned
      // and optionally displayed to the user for support.
      res.statusCode = 500;
      res.end((res as any).sentry + "\n");
    });
  }

  public async listen(port: number) {
    await connectDB();

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

  // Register the repeatable user write-back flush job (only once, from this worker)
  await registerUserFlushJob();

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

const isServerless = !!(
  process.env.NETLIFY ||
  process.env.SERVERLESS ||
  process.env.LAMBDA_TASK_ROOT ||
  process.env.AWS_EXECUTION_ENV
);

if (!isServerless) {
  if (cluster.isPrimary) {
    // Explicitly set Round-Robin scheduling policy.
    // On Windows, the default is SCHED_NONE (OS-managed), which distributes requests extremely poorly.
    // SCHED_RR forces Node.js to distribute incoming connections evenly among all HTTP workers.
    cluster.schedulingPolicy = cluster.SCHED_RR;

    // In production, start with exactly 2 HTTP workers (auto-scale up to 4 if needed).
    // In development, start with exactly 1 HTTP worker.
    const initialHttpWorkers = isProd ? 2 : 1;
    const totalWorkers = initialHttpWorkers + 1; // HTTP workers + 1 dedicated Email worker

    console.log(`[Primary ${process.pid}] Spawning ${totalWorkers} worker(s): ${initialHttpWorkers} HTTP + 1 Email`);

    // Telemetry store
    interface WorkerStats {
      pid: number;
      role: "http" | "email";
      status: "online" | "exited" | "scaling_down";
      activeRequests: number;
      totalRequests: number;
      startedAt: number;
    }

    const workerTelemetry = new Map<number, WorkerStats>();

    let isScaling = false;

    const checkScale = () => {
      if (!isProd) return;
      if (isScaling) return;

      const currentHttpWorkers: any[] = [];
      let totalActiveRequests = 0;

      for (const id in cluster.workers) {
        const worker = cluster.workers[id];
        if (!worker || !worker.isConnected()) continue;

        const pid = worker.process.pid;
        if (!pid) continue;

        const stats = workerTelemetry.get(pid);
        if (stats && stats.role === "http" && stats.status === "online") {
          currentHttpWorkers.push(worker);
          totalActiveRequests += stats.activeRequests;
        }
      }

      const activeCount = currentHttpWorkers.length;

      // Scaling thresholds:
      // - Scale up limit: if total concurrent requests > 20 and we are at 2 HTTP workers, scale up to 4.
      // - Scale down limit: if total concurrent requests < 5 and we are at 4 HTTP workers, scale down to 2.
      const SCALE_UP_LIMIT = parseInt(process.env.SCALE_UP_REQUEST_LIMIT || "20", 10);
      const SCALE_DOWN_LIMIT = parseInt(process.env.SCALE_DOWN_REQUEST_LIMIT || "5", 10);

      if (activeCount === 2 && totalActiveRequests > SCALE_UP_LIMIT) {
        isScaling = true;
        console.log(`[Auto-Scale] 📈 Active requests (${totalActiveRequests}) exceeded limit of ${SCALE_UP_LIMIT}. Scaling up: Spawning 2 more HTTP workers...`);
        for (let i = 0; i < 2; i++) {
          const w = cluster.fork({ WORKER_ROLE: "http" });
          console.log(`[Primary] Auto-Scale: Forked HTTP worker (pid: ${w.process.pid})`);
          registerWorkerTelemetry(w, "http");
        }
        // Cooldown period (15 seconds) to let new workers spin up and prevent rapid scale oscillations
        setTimeout(() => { isScaling = false; }, 15000);
      } else if (activeCount > 2 && totalActiveRequests < SCALE_DOWN_LIMIT) {
        isScaling = true;
        console.log(`[Auto-Scale] 📉 Active requests (${totalActiveRequests}) dropped below ${SCALE_DOWN_LIMIT}. Scaling down: Terminating 2 HTTP workers...`);

        let terminated = 0;
        for (const worker of currentHttpWorkers) {
          if (terminated >= 2) break;
          const pid = worker.process.pid;
          if (pid) {
            const stats = workerTelemetry.get(pid);
            if (stats) stats.status = "scaling_down";
          }
          worker.send("shutdown");
          terminated++;
        }
        // Cooldown period (15 seconds) after scale down
        setTimeout(() => { isScaling = false; }, 15000);
      }
    };

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
          checkScale();
        } else if (msg.type === "request_end") {
          stats.activeRequests = Math.max(0, stats.activeRequests - 1);
          checkScale();
        }
      });
    };

    // Fork the dedicated email worker first (Worker ID 1)
    const emailWorkerProcess = cluster.fork({ WORKER_ROLE: "email" });
    console.log(`[Primary] Email worker forked (pid: ${emailWorkerProcess.process.pid})`);
    registerWorkerTelemetry(emailWorkerProcess, "email");

    // Fork HTTP workers
    for (let i = 0; i < initialHttpWorkers; i++) {
      const w = cluster.fork({ WORKER_ROLE: "http" });
      console.log(`[Primary] HTTP worker ${i + 1}/${initialHttpWorkers} forked (pid: ${w.process.pid})`);
      registerWorkerTelemetry(w, "http");
    }

    // Restart crashed workers in production, update telemetry
    cluster.on("exit", (worker, code, signal) => {
      const role = (worker.process as any).env?.WORKER_ROLE || "http";
      const pid = worker.process.pid;
      console.warn(`[Primary] Worker ${worker.id} (${role}, pid: ${pid}) exited (code: ${code}, signal: ${signal})`);

      let isScalingDown = false;
      if (pid) {
        const stats = workerTelemetry.get(pid);
        if (stats) {
          if (stats.status === "scaling_down") {
            isScalingDown = true;
          }
          stats.status = "exited";
          stats.activeRequests = 0;
        }
      }

      if (isProd && !isScalingDown) {
        const env = role === "email" ? { WORKER_ROLE: "email" } : { WORKER_ROLE: "http" };
        const newWorker = cluster.fork(env);
        console.log(`[Primary] Re-forked ${role} worker (new pid: ${newWorker.process.pid})`);
        registerWorkerTelemetry(newWorker, role);
      }
    });

    // Coordinated Graceful Shutdown for Primary & Workers
    const primaryShutdown = async (signal: string) => {
      console.log(`\n[Primary ${process.pid}] Received ${signal}. Initiating cluster graceful shutdown...`);

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
}