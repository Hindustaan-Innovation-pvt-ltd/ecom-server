import type { Request, Response, NextFunction } from "express";
import passport from "passport";
import fs from "fs";
import { User } from "../models/user.js";
import type { IUser } from "../models/user.js";
import { Seller } from "../models/seller.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";
import { sendWelcomeEmail } from "../services/email.js";
import { redisClient, isRedisActive } from "../utils/redis.js";

/**
 * Handles signup of customers and admins.
 * Saves Mongoose records, then logs the user in with Passport session serialization.
 */
export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  const file = (req as any).file;
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
      try {
        // Attempt cloud Cloudinary upload
        const cloudUrl = await uploadToCloudinary(file.path);
        if (cloudUrl) {
          avatarUrl = cloudUrl;
          // Delete local file to free disk space since it is uploaded
          fs.unlinkSync(file.path);
        } else {
          // Serve locally if Cloudinary is disabled/fails
          avatarUrl = `/uploads/user_profile/${file.filename}`;
        }
      } catch (uploadErr) {
        console.error("Avatar cloud upload error, resorting to local fallback:", uploadErr);
        avatarUrl = `/uploads/user_profile/${file.filename}`;
      }
    }

    // 4. Check if we should use high-throughput write-back buffering via Redis
    if (isRedisActive && redisClient) {
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

      const responseUser = user.toObject();
      delete (responseUser as any).passwordHash;

      res.status(201).json({
        success: true,
        message: "User registered and logged in successfully.",
        user: responseUser,
      });
    });
  } catch (error: any) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    console.error("User registration error:", error);
    res.status(500).json({ success: false, message: error.message || "Internal server error during registration." });
  }
}

/**
 * Handles credentials verification via Passport.js local strategy.
 */
export function login(req: Request, res: Response, next: NextFunction): void {
  passport.authenticate("local", (err: any, user: any, info: any) => {
    if (err) {
      console.error("Passport authenticate local strategy error:", err);
      return next(err);
    }

    if (!user) {
      res.status(401).json({
        success: false,
        message: info?.message || "Invalid email/phone number or password.",
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

        const responseUser = user.toObject();
        delete (responseUser as any).passwordHash;

        res.status(200).json({
          success: true,
          message: "Logged in successfully.",
          user: responseUser,
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
    if ((req as any).session) {
      (req as any).session = null;
    }

    res.status(200).json({ success: true, message: "Logged out successfully." });
  });
}

/**
 * Retrieves details of the authenticated user and associated seller profile.
 */
export async function getMe(req: Request, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Not authenticated." });
      return;
    }

    const responseUser = (req.user as IUser).toObject();
    delete (responseUser as any).passwordHash;

    res.status(200).json({
      success: true,
      user: responseUser,
      seller: req.seller || undefined,
    });
  } catch (error) {
    console.error("Retrieve profile error:", error);
    res.status(500).json({ success: false, message: "Internal server error retrieving profile." });
  }
}

/**
 * [READ ALL] Retrieves a list of all users. (Admin Only)
 */
export async function getAllUsers(req: Request, res: Response): Promise<void> {
  try {
    const users = await User.find().select("-passwordHash");
    res.status(200).json({ success: true, users });
  } catch (error) {
    console.error("Get all users error:", error);
    res.status(500).json({ success: false, message: "Internal server error retrieving users list." });
  }
}

/**
 * [READ ONE] Retrieves a specific user by ID. (Self or Admin Only)
 */
export async function getUserById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const caller = req.user as IUser;

    // RBAC: Only admin or the user themselves can inspect details
    if (caller.role !== "admin" && caller._id.toString() !== id) {
      res.status(403).json({ success: false, message: "Forbidden. Access denied." });
      return;
    }

    const user = await User.findById(id).select("-passwordHash");
    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Get user by ID error:", error);
    res.status(500).json({ success: false, message: "Internal server error retrieving user profile." });
  }
}

/**
 * [UPDATE OWN] Updates own user profile information. (Self Only)
 */
export async function updateMe(req: Request, res: Response): Promise<void> {
  const file = (req as any).file;
  try {
    const caller = req.user as IUser;
    const { fullName, email, phone, password } = req.body;

    const user = await User.findById(caller._id);
    if (!user) {
      if (file) fs.unlinkSync(file.path);
      res.status(404).json({ success: false, message: "User account not found." });
      return;
    }

    // Apply text updates
    if (fullName) user.fullName = fullName;

    if (email && email.toLowerCase() !== user.email) {
      const duplicateEmail = await User.findOne({ email: email.toLowerCase() });
      if (duplicateEmail) {
        if (file) fs.unlinkSync(file.path);
        res.status(400).json({ success: false, message: "Email address is already in use by another account." });
        return;
      }
      user.email = email.toLowerCase();
    }

    if (phone && phone !== user.phone) {
      const duplicatePhone = await User.findOne({ phone });
      if (duplicatePhone) {
        if (file) fs.unlinkSync(file.path);
        res.status(400).json({ success: false, message: "Phone number is already in use by another account." });
        return;
      }
      user.phone = phone;
    }

    if (password) {
      user.passwordHash = password; // Hashed automatically by Save pre-hook
    }

    // Apply avatar file upload updates
    if (file) {
      try {
        const cloudUrl = await uploadToCloudinary(file.path);
        if (cloudUrl) {
          user.avatarUrl = cloudUrl;
          fs.unlinkSync(file.path);
        } else {
          user.avatarUrl = `/uploads/user_profile/${file.filename}`;
        }
      } catch (uploadErr) {
        console.error("Avatar cloud upload failed during update, using local path:", uploadErr);
        user.avatarUrl = `/uploads/user_profile/${file.filename}`;
      }
    }

    await user.save();

    const responseUser = user.toObject();
    delete (responseUser as any).passwordHash;

    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: responseUser,
    });
  } catch (error: any) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    console.error("Update profile error:", error);
    res.status(500).json({ success: false, message: error.message || "Internal server error during profile update." });
  }
}

/**
 * [UPDATE STATUS] Activates or suspends a user's account status. (Admin Only)
 */
export async function updateUserStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      res.status(400).json({ success: false, message: "isActive field must be a boolean." });
      return;
    }

    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    user.isActive = isActive;
    await user.save();

    res.status(200).json({
      success: true,
      message: `User account has been successfully ${isActive ? "activated" : "suspended"}.`,
    });
  } catch (error) {
    console.error("Update user status error:", error);
    res.status(500).json({ success: false, message: "Internal server error during status update." });
  }
}

/**
 * [DELETE OWN] Deletes own user account and linked profiles, clearing passport sessions. (Self Only)
 */
export async function deleteMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const caller = req.user as IUser;

    // Delete linked seller profile if caller is a seller
    if (caller.role === "seller") {
      await Seller.deleteOne({ userId: caller._id });
    }

    // Delete User
    await User.findByIdAndDelete(caller._id);

    // Logout session
    req.logout((err) => {
      if (err) return next(err);
      if ((req as any).session) {
        (req as any).session = null;
      }
      res.status(200).json({ success: true, message: "Your account has been deleted successfully." });
    });
  } catch (error) {
    console.error("Delete self account error:", error);
    res.status(500).json({ success: false, message: "Internal server error during account deletion." });
  }
}

/**
 * [DELETE ANY] Deletes any specific user by ID. (Admin Only)
 */
export async function deleteUserById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    // Rollback linked seller if deleted user was a seller
    if (user.role === "seller") {
      await Seller.deleteOne({ userId: user._id });
    }

    await User.findByIdAndDelete(id);
    res.status(200).json({ success: true, message: "User account and associated profiles deleted successfully." });
  } catch (error) {
    console.error("Delete user by ID error:", error);
    res.status(500).json({ success: false, message: "Internal server error during user account deletion." });
  }
}
