import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { User } from "../models/user.js";
import { sendOTP, verifyOTP, verifyIdToken } from "../services/firebase.js";

/**
 * Reusable helper to either log in an existing user or request registration details.
 */
async function handleUserLoginOrRegister(
  req: Request,
  res: Response,
  next: NextFunction,
  verifiedPhone: string,
  registrationData?: {
    fullName?: string;
    email?: string;
    role?: "customer" | "seller" | "admin";
  }
): Promise<void> {
  try {
    // 1. Find user by verified phone number
    const user = await User.findOne({ phone: verifiedPhone });

    if (user) {
      // User exists, verify status
      if (!user.isActive) {
        res.status(403).json({
          success: false,
          message: "This user account is suspended.",
        });
        return;
      }

      // Log the user in to establish Passport session
      req.logIn(user, async (err) => {
        if (err) {
          console.error("Passport login during OTP verification failed:", err);
          return next(err);
        }

        user.lastLoginAt = new Date();
        await user.save();

        const responseUser = user.toObject() as Record<string, any>;
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
      });
      return;
    }

    // 2. User does not exist. Check if registration details are provided.
    const { fullName, email, role = "customer" } = registrationData || {};

    if (!fullName || !email) {
      // Registration info is missing. Inform the client that registration is required.
      res.status(200).json({
        success: true,
        registrationRequired: true,
        phone: verifiedPhone,
        message: "No account linked to this phone number. Please provide fullName and email to register.",
      });
      return;
    }

    // Role safety guard
    if (role === "seller") {
      res.status(400).json({
        success: false,
        message: "Sellers must register through the dedicated seller onboarding endpoint.",
      });
      return;
    }

    // Duplicate email check
    const existingEmailUser = await User.findOne({ email: email.toLowerCase() });
    if (existingEmailUser) {
      res.status(400).json({
        success: false,
        message: "An account with this email address already exists.",
      });
      return;
    }

    // Generate a secure random password since OTP replaces password verification
    const randomPassword = crypto.randomBytes(16).toString("hex");

    // Save new user directly to MongoDB
    const newUser = new User({
      fullName,
      email: email.toLowerCase(),
      phone: verifiedPhone,
      passwordHash: randomPassword, // Pre-save hook will encrypt this
      role,
    });

    await newUser.save();

    // Log the user in to establish Passport session
    req.logIn(newUser, (err) => {
      if (err) {
        console.error("Passport login during OTP registration failed:", err);
        return next(err);
      }

      const responseUser = newUser.toObject() as Record<string, any>;
      delete responseUser.passwordHash;

      const token = jwt.sign(
        { userId: newUser._id, role: newUser.role },
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
  } catch (error) {
    console.error("Error in handleUserLoginOrRegister:", error);
    next(error);
  }
}

/**
 * Controller to trigger sending an OTP SMS verification code.
 */
export async function sendOTPController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { phone } = req.body;

    if (!phone) {
      res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
      return;
    }

    // Simple phone format validation
    const phoneRegex = /^\+?[0-9\s-]{7,15}$/;
    if (!phoneRegex.test(phone)) {
      res.status(400).json({
        success: false,
        message: "Please provide a valid phone number.",
      });
      return;
    }

    const sessionInfo = await sendOTP(phone);

    res.status(200).json({
      success: true,
      message: "OTP verification code sent successfully.",
      sessionInfo,
    });
  } catch (error: any) {
    console.error("Error sending OTP:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to send OTP verification code.",
    });
  }
}

/**
 * Controller to verify the OTP code and log the user in (or initiate registration).
 */
export async function verifyOTPController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { sessionInfo, code, fullName, email, role } = req.body;

    if (!sessionInfo || !code) {
      res.status(400).json({
        success: false,
        message: "sessionInfo and code are required.",
      });
      return;
    }

    // Verify OTP using Firebase Identity REST API
    const verifiedPhone = await verifyOTP(sessionInfo, code);

    // Delegate login / registration
    await handleUserLoginOrRegister(req, res, next, verifiedPhone, {
      fullName,
      email,
      role,
    });
  } catch (error: any) {
    console.error("Error verifying OTP:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to verify OTP code.",
    });
  }
}

/**
 * Controller to handle logins via client-side Firebase Auth ID Tokens.
 */
export async function firebaseLoginController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { idToken, fullName, email, role } = req.body;

    if (!idToken) {
      res.status(400).json({
        success: false,
        message: "idToken is required.",
      });
      return;
    }

    // Verify the Firebase ID Token
    const verifiedPhone = await verifyIdToken(idToken);

    // Delegate login / registration
    await handleUserLoginOrRegister(req, res, next, verifiedPhone, {
      fullName,
      email,
      role,
    });
  } catch (error: any) {
    console.error("Error in Firebase ID Token login:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Invalid or expired Firebase ID Token.",
    });
  }
}
