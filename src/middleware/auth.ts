import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/user.js";
import { Seller } from "../models/seller.js";
import type { IUser } from "../models/user.js";

/**
 * Middleware to authenticate requests using Passport.js sessions.
 */
export async function authenticateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let isAuthed = false;
    if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) {
      isAuthed = true;
    } else if (req.user) {
      isAuthed = true;
    }

    // 1. Check for Authorization Bearer Token
    const authHeader = req.headers.authorization;
    if (authHeader) {
      let token: string | undefined;
      if (authHeader.toLowerCase().startsWith("bearer ")) {
        token = authHeader.substring(7).trim();
      } else if (!authHeader.includes(" ")) {
        token = authHeader.trim();
      }

      if (token) {
        try {
          const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET || "super-secret-jwt-signing-key-for-hmarketplace-2026"
          ) as { userId: string };

          const user = await User.findById(decoded.userId);
          if (user) {
            req.user = user;
            isAuthed = true;
          }
        } catch (jwtErr) {
          // Only return 401 if they are not already authenticated via another method
          if (!isAuthed) {
            res.status(401).json({ success: false, message: "Invalid or expired authorization token." });
            return;
          }
        }
      }
    }

    // 2. Check if Passport session or Bearer token is authenticated
    if (!isAuthed) {
      res.status(401).json({ success: false, message: "Authentication required. Please log in." });
      return;
    }

    const user = req.user as IUser;

    // 3. Verify account status
    if (!user.isActive) {
      // Force log out of session if account is deactivated
      req.logout((err) => {
        if (err) console.error("Force logout error for inactive user:", err);
      });
      res.status(403).json({ success: false, message: "This user account is suspended." });
      return;
    }

    // 4. Populate Seller context if user is a seller
    if (user.role === "seller") {
      const seller = await Seller.findOne({ userId: user._id });
      if (!seller) {
        console.warn(
          `[DATA INCONSISTENCY] User ${user.email} (${user._id}) has role "seller" but no Seller profile document was found. ` +
          `Run "npm run seed" to restore database integrity, or call DELETE /api/seller/profile followed by re-registration.`
        );
      }
      req.seller = seller;
    } else {
      req.seller = null;
    }

    next();
  } catch (error) {
    console.error("Authentication middleware error:", error);
    res.status(500).json({ success: false, message: "Internal server error during authentication." });
  }
}

/**
 * Middleware to enforce role-based access control (RBAC).
 */
export function requireRoles(...roles: ("customer" | "seller" | "admin")[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required." });
      return;
    }

    const user = req.user as IUser;

    if (!roles.includes(user.role)) {
      console.warn(`[RBAC Block] User: ${user.email} (Role: ${user.role}) tried to access route requiring: ${roles.join(", ")}`);
      res.status(403).json({
        success: false,
        message: `Forbidden. This action requires one of the following roles: ${roles.join(", ")}`,
      });
      return;
    }

    next();
  };
}

/**
 * Middleware to ensure the authenticated seller is approved by the admin.
 */
export async function requireApprovedSeller(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ success: false, message: "Authentication required." });
    return;
  }

  const user = req.user as IUser;

  // Bypass if the user is an admin
  if (user.role === "admin") {
    next();
    return;
  }

  if (user.role !== "seller") {
    res.status(403).json({ success: false, message: "Forbidden. Not registered as a seller." });
    return;
  }

  if (!req.seller) {
    res.status(404).json({ success: false, message: "Seller profile not found." });
    return;
  }

  if (!req.seller.isKycCompleted || req.seller.approvalStatus !== "approved") {
    res.status(403).json({
      success: false,
      message: "Access denied. You must complete your KYC verification (approved by an admin) before you are eligible to perform this seller action.",
    });
    return;
  }

  next();
}

