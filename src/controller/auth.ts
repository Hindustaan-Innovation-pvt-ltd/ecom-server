import type { Request, Response, NextFunction } from "express";
import passport from "passport";
import fs from "node:fs";
import jwt from "jsonwebtoken";
import { User, type IUser } from "../models/user.js";
import { redisClient, isRedisActive } from "../utils/redis.js";
import { sendWelcomeEmail } from "../services/email.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";

/**
 * Handles signup of customers and admins.
 * Saves Mongoose records, then logs the user in with Passport session serialization.
 */
export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  const file = (req as unknown as { file?: { path: string; filename: string } }).file;
  try {
    const {
      fullName,
      email,
      phone,
      password,
      role = "customer",
    } = req.body;

    // 1. Inputs validation
    if (!fullName || !email || !phone || !password) {
      if (file) fs.unlinkSync(file.path);
      res.status(400).json({ success: false, message: "Required fields: fullName, email, phone, and password." });
      return;
    }

    // Direct seller roles to the dedicated route
    if (role === "seller") {
      if (file) fs.unlinkSync(file.path);
      res.status(400).json({
        success: false,
        message: "Sellers must register through the dedicated seller onboarding endpoint (/api/seller/register).",
      });
      return;
    }

    // 2. Duplicate Check
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }],
    });

    if (existingUser) {
      if (file) fs.unlinkSync(file.path);
      res.status(400).json({
        success: false,
        message: "An account with this email address or phone number already exists.",
      });
      return;
    }

    // 3. File uploads (avatar profile picture)
    let avatarUrl = "";
    if (file) {
      const cloudUrl = await uploadToCloudinary(file.path);
      if (!cloudUrl) {
        res.status(500).json({ success: false, message: "Avatar upload to Cloudinary failed. Cloud uploads are mandatory." });
        return;
      }
      avatarUrl = cloudUrl;
    }

    // 4. Check if we should use high-throughput write-back buffering via Redis (Production only)
    if (process.env.NODE_ENV === "production" && isRedisActive && redisClient) {
      const payload = {
        fullName,
        email,
        phone,
        password, // Raw password, hashed during flush bulk insert
        role,
        avatarUrl,
      };
      await redisClient.sadd("buffered:users", JSON.stringify(payload));

      res.status(202).json({
        success: true,
        message: "Your registration onboarding request is queued and is being processed asynchronously.",
        buffered: true,
      });
      return;
    }

    const user = new User({
      fullName,
      email,
      phone,
      passwordHash: password, // Pre-save hooks handles encryptPassword automatically
      role,
      avatarUrl,
    });

    await user.save();

    // Send Welcome Email in background
    sendWelcomeEmail(user.email, user.fullName);
    
    // 5. Log user in to establish Passport session
    req.logIn(user, (err) => {
      if (err) {
        console.error("Passport login during signup failed:", err);
        return next(err);
      }

      const responseUser = user.toObject() as unknown as Record<string, unknown>;
      delete responseUser.passwordHash;

      const token = jwt.sign(
        { userId: user._id, role: user.role },
        process.env.JWT_SECRET || "super-secret-jwt-signing-key-for-hmarketplace-2026",
        { expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as any }
      );

      res.status(201).json({
        success: true,
        message: "User registered and logged in successfully.",
        user: responseUser,
        token,
      });
    });
  } catch (error: unknown) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    console.error("User registration error:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error during registration.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

/**
 * Handles credentials verification via Passport.js local strategy.
 */
export function login(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as Record<string, unknown> | undefined;
  const emailFromBody = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const emailFromLegacyField =
    typeof body?.emailOrPhone === "string" && body.emailOrPhone.trim().includes("@")
      ? body.emailOrPhone.trim().toLowerCase()
      : "";
  const email = emailFromBody || emailFromLegacyField;

  const password =
    (typeof body?.password === "string" && body.password) ||
    (typeof body?.pass === "string" && body.pass) ||
    (typeof body?.pwd === "string" && body.pwd) ||
    "";

  if (!email || !password) {
    res.status(400).json({
      success: false,
      message: "Missing credentials. Send email and password.",
    });
    return;
  }

  if (req.body) {
    req.body.email = email;
    req.body.password = password;
  }

  passport.authenticate("local", (err: Error | null, user: IUser | false, info: { message?: string } | undefined) => {
    if (err) {
      console.error("Passport authenticate local strategy error:", err);
      return next(err);
    }

    if (!user) {
      res.status(401).json({
        success: false,
        message: info?.message || "Invalid email or password.",
      });
      return;
    }

    // Establish Passport session
    req.logIn(user, async (loginErr) => {
      if (loginErr) {
        console.error("Passport req.logIn session establishment error:", loginErr);
        return next(loginErr);
      }

      try {
        // Update last login
        user.lastLoginAt = new Date();
        await user.save();
        const responseUser = user.toObject() as unknown as Record<string, unknown>;
        delete responseUser.passwordHash;

        const token = jwt.sign(
          { userId: user._id, role: user.role },
          process.env.JWT_SECRET || "super-secret-jwt-signing-key-for-hmarketplace-2026",
          { expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as any }
        );

        res.status(200).json({
          success: true,
          message: "Logged in successfully.",
          user: responseUser,
          token,
        });
      } catch (saveErr) {
        console.error("Error updating lastLoginAt on login:", saveErr);
        return next(saveErr);
      }
    });
  })(req, res, next);
}

/**
 * Destroys the Passport session.
 */
export function logout(req: Request, res: Response, next: NextFunction): void {
  req.logout((err) => {
    if (err) {
      console.error("Passport req.logout error:", err);
      return next(err);
    }

    // Force clear session cookies
    if ((req as unknown as { session?: Record<string, unknown> | null }).session) {
      (req as unknown as { session?: Record<string, unknown> | null }).session = null;
    }

    res.status(200).json({ success: true, message: "Logged out successfully." });
  });
}
