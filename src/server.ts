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
import { userQueue } from "./workers/bullmq.js";
import { rateLimiter } from "./middleware/rateLimiter.js";

// Load Passport Configuration
import "./config/passport.js";

class Server {
  private app: express.Express;

  constructor() {
    this.app = express();

    // Core middlewares
    this.app.use(cors());
    this.app.use(helmet({
      crossOriginResourcePolicy: false, // Allows loading local static uploaded profile pictures in browser
    }));
    this.app.use(morgan("dev"));

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Cookie session middleware setup
    this.app.use(
      cookieSession({
        name: "session",
        keys: [process.env.SESSION_SECRET || "cookie-session-secret-key-for-hmarketplace"],
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
      })
    );

    // Compatibility layer for Passport 0.6+ and cookie-session (mocks regenerate and save)
    this.app.use((req, res, next) => {
      if (req.session) {
        if (!req.session.regenerate) {
          req.session.regenerate = (cb: () => void) => {
            if (cb) cb();
          };
        }
        if (!req.session.save) {
          req.session.save = (cb: () => void) => {
            if (cb) cb();
          };
        }
      }
      next();
    });

    // Initialize and mount Passport session middlewares
    this.app.use(passport.initialize());
    this.app.use(passport.session());

    // Static folders mapping
    this.app.use("/uploads", express.static("uploads"));

    // Rate Limiting Middlewares
    const apiLimiter = rateLimiter({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 500, // Limit each IP to 500 requests per 15 minutes
      message: "Too many requests from this IP, please try again in 15 minutes.",
    });

    const sensitiveLimiter = rateLimiter({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 10, // Limit each IP to 10 authentication or registration requests per minute
      message: "Too many authentication or registration attempts. Please try again after 60 seconds.",
    });

    // Apply strict rate limiting to sensitive authentication and onboarding endpoints
    this.app.use("/api/auth/register", sensitiveLimiter);
    this.app.use("/api/auth/login", sensitiveLimiter);
    this.app.use("/api/seller/register", sensitiveLimiter);

    // Apply general rate limiting to all standard API routes
    this.app.use("/api", apiLimiter);

    // Routes mounting
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

    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.status(200).json({ success: true, message: "Server is healthy." });
    });
  }

  public async listen(port: number) {
    // Wait for Database connection before starting server
    await connectDB();

    // Bootstrap repeatable write-back flush signup job in BullMQ
    userQueue.add(
      "flushBufferedUsers",
      {},
      {
        repeat: { every: 10000 }, // Every 10 seconds
        jobId: "flush-job-repeatable",
      }
    ).then(() => {
      console.log("Repeatable write-back flush signup job registered in BullMQ.");
    }).catch(err => {
      console.error("Failed to register repeatable flush job in BullMQ:", err);
    });

    this.app.listen(port, () => {
      process.env.NODE_ENV === "production"
        ? console.log(`Worker ${process.pid} is listening on port ${port}`)
        : console.log(`Server is running on port ${port}`);
    });
  }
}

if (process.env.NODE_ENV === "production") {
  if (cluster.isPrimary) {
    const numCPUs = os.cpus().length / 8;
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on("fork", (worker) => {
      console.log(`Worker ${worker.id} has been forked`);
    });

    cluster.on("exit", (worker) => {
      console.log(`Worker ${worker.id} has exited`);
    });
  } else if (cluster.worker) {
    const app = new Server();
    app.listen(
      process.env.NODE_ENV === "production"
        ? parseInt(process.env.PORT || "3000", 10)
        : 3000,
    );
  }
} else {
  // Direct execution for development mode
  const app = new Server();
  app.listen(
    process.env.NODE_ENV === "production"
      ? parseInt(process.env.PORT || "3000", 10)
      : 3000,
  );
}
