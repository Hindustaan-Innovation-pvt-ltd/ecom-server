import type { Request, Response, NextFunction } from "express";
import { parsePagination } from "../utils/pagination.js";
import fs from "node:fs";
import mongoose from "mongoose";
import { User, type IUser } from "../models/user.js";
import { Seller } from "../models/seller.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";
import { AuditLog } from "../models/auditLog.js";

/**
 * Retrieves details of the authenticated user and associated seller profile.
 */
export async function getMe(req: Request, res: Response): Promise<void> {
    try {
        if (!req.user) {
            res.status(401).json({ success: false, message: "Not authenticated." });
            return;
        }

        const responseUser = (req.user as IUser).toObject() as unknown as Record<string, unknown>;
        delete responseUser.passwordHash;

        res.status(200).json({
            success: true,
            user: responseUser,
            seller: req.seller || undefined,
        });
    } catch (error: unknown) {
        console.error("Retrieve profile error:", error);
        res.status(500).json({ success: false, message: "Internal server error retrieving profile." });
    }
}

/**
 * [READ ALL] Retrieves a list of all users. (Admin Only)
 */
export async function getAllUsers(req: Request, res: Response): Promise<void> {
    try {
        const { page, limit, skip } = parsePagination(req.query);

        const [users, total] = await Promise.all([
            User.find()
                .select("-passwordHash")
                .skip(skip)
                .limit(limit)
                .lean(),
            User.countDocuments(),
        ]);

        res.status(200).json({
            success: true,
            users,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    } catch (error: unknown) {
        console.error("Get all users error:", error);
        res.status(500).json({ success: false, message: "Internal server error retrieving users list." });
    }
}

/**
 * [READ ONE] Retrieves a specific user by ID. (Self or Admin Only)
 */
export async function getUserById(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id as string;
        const caller = req.user as IUser | undefined;

        if (!caller) {
            res.status(401).json({ success: false, message: "Not authenticated." });
            return;
        }

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
    } catch (error: unknown) {
        console.error("Get user by ID error:", error);
        res.status(500).json({ success: false, message: "Internal server error retrieving user profile." });
    }
}

/**
 * [UPDATE OWN] Updates own user profile information. (Self Only)
 */
export async function updateMe(req: Request, res: Response): Promise<void> {
    const file = (req as unknown as { file?: { path: string; filename: string } }).file;
    try {
        const caller = req.user as IUser | undefined;
        if (!caller) {
            if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
            res.status(401).json({ success: false, message: "Not authenticated." });
            return;
        }

        const { fullName, email, phone, password } = req.body;

        const user = await User.findById(caller._id);
        if (!user) {
            if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
            res.status(404).json({ success: false, message: "User account not found." });
            return;
        }

        // Apply text updates
        if (fullName) user.fullName = fullName;

        if (email && email.toLowerCase() !== user.email) {
            const duplicateEmail = await User.findOne({ email: email.toLowerCase() });
            if (duplicateEmail) {
                if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
                res.status(400).json({ success: false, message: "Email address is already in use by another account." });
                return;
            }
            user.email = email.toLowerCase();
        }

        if (phone && phone !== user.phone) {
            const duplicatePhone = await User.findOne({ phone });
            if (duplicatePhone) {
                if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
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

        const responseUser = user.toObject() as unknown as Record<string, unknown>;
        delete responseUser.passwordHash;

        res.status(200).json({
            success: true,
            message: "Profile updated successfully.",
            user: responseUser,
        });
    } catch (error: unknown) {
        if (file && fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
        }
        console.error("Update profile error:", error);
        const errorMessage = error instanceof Error ? error.message : "Internal server error during profile update.";
        res.status(500).json({ success: false, message: errorMessage });
    }
}

/**
 * [UPDATE STATUS] Activates or suspends a user's account status. (Admin Only)
 */
export async function updateUserStatus(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id as string;
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

        // Write to AuditLog
        const caller = req.user as IUser;
        const audit = new AuditLog({
            action: "USER_STATUS_UPDATE",
            performedBy: caller._id,
            targetId: user._id,
            details: `Admin ${caller.fullName} (${caller.email}) changed account status of user ${user.fullName} (${user.email}) to ${isActive ? "ACTIVE" : "SUSPENDED"}.`,
        });
        await audit.save();

        res.status(200).json({
            success: true,
            message: `User account has been successfully ${isActive ? "activated" : "suspended"}.`,
        });
    } catch (error: unknown) {
        console.error("Update user status error:", error);
        res.status(500).json({ success: false, message: "Internal server error during status update." });
    }
}

/**
 * [DELETE OWN] Deletes own user account and linked profiles, clearing passport sessions. (Self Only)
 */
export async function deleteMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const caller = req.user as IUser | undefined;
        if (!caller) {
            res.status(401).json({ success: false, message: "Not authenticated." });
            return;
        }

        // Delete linked seller profile if caller is a seller
        if (caller.role === "seller") {
            await Seller.deleteOne({ userId: caller._id });
        }

        // Delete User
        await User.findByIdAndDelete(caller._id);

        // Logout session
        req.logout((err) => {
            if (err) return next(err);
            if ((req as unknown as { session?: Record<string, unknown> | null }).session) {
                (req as unknown as { session?: Record<string, unknown> | null }).session = null;
            }
            res.status(200).json({ success: true, message: "Your account has been deleted successfully." });
        });
    } catch (error: unknown) {
        console.error("Delete self account error:", error);
        res.status(500).json({ success: false, message: "Internal server error during account deletion." });
    }
}

/**
 * [DELETE ANY] Deletes any specific user by ID. (Admin Only)
 */
export async function deleteUserById(req: Request, res: Response): Promise<void> {
    try {
        const id = req.params.id as string;

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

        // Write to AuditLog
        const caller = req.user as IUser;
        const audit = new AuditLog({
            action: "USER_DELETED",
            performedBy: caller._id,
            targetId: user._id,
            details: `Admin ${caller.fullName} (${caller.email}) permanently deleted user account: ${user.fullName} (${user.email}, Role: ${user.role}).`,
        });
        await audit.save();

        res.status(200).json({ success: true, message: "User account and associated profiles deleted successfully." });
    } catch (error: unknown) {
        console.error("Delete user by ID error:", error);
        res.status(500).json({ success: false, message: "Internal server error during user account deletion." });
    }
}