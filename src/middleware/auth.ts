import type { Request, Response, NextFunction } from "express";
import { Seller } from "../models/seller.js";
import type { IUser } from "../models/user.js";
import type { ISeller } from "../models/seller.js";

/**
 * Middleware to authenticate requests using Passport.js sessions.
 */
export async function authenticateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // 1. Check if Passport session is authenticated
    if (!req.isAuthenticated()) {
      res.status(401).json({ success: false, message: "Authentication required. Please log in." });
      return;
    }

    const user = req.user as IUser;

    // 2. Verify account status
    if (!user.isActive) {
      // Force log out of session if account is deactivated
      req.logout((err) => {
        if (err) console.error("Force logout error for inactive user:", err);
      });
      res.status(403).json({ success: false, message: "This user account is suspended." });
      return;
    }

    // 3. Populate Seller context if user is a seller
    if (user.role === "seller") {
      const seller = await Seller.findOne({ userId: user._id });
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
      res.status(403).json({
        success: false,
        message: `Forbidden. This action requires one of the following roles: ${roles.join(", ")}`,
      });
      return;
    }

    next();
  };
}
