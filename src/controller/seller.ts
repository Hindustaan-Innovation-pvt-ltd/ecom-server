import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import { User } from "../models/user.js";
import type { IUser } from "../models/user.js";
import { Seller } from "../models/seller.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";

/**
 * [CREATE] Decoupled registration controller for Sellers.
 * Step 1: Creates the User document with role "seller".
 * Step 2: Extracts the generated userId and creates the Seller document.
 * Step 3: Logs the seller in via Passport and returns combined profiles.
 */
export async function registerSeller(req: Request, res: Response, next: NextFunction): Promise<void> {
  const file = (req as any).file;
  try {
    const {
      fullName,
      email,
      phone,
      password,
      businessName,
      gstNumber,
      businessPhone,
      businessEmail,
    } = req.body;

    // 1. Inputs validation
    if (!fullName || !email || !phone || !password || !businessName || !gstNumber || !businessPhone || !businessEmail) {
      if (file) fs.unlinkSync(file.path);
      res.status(400).json({
        success: false,
        message: "Required fields: fullName, email, phone, password, businessName, gstNumber, businessPhone, and businessEmail.",
      });
      return;
    }

    // 2. Check for duplicate User (email/phone)
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { phone }],
    });

    if (existingUser) {
      if (file) fs.unlinkSync(file.path);
      res.status(400).json({ success: false, message: "A user account with this email address or phone number already exists." });
      return;
    }

    // 3. Check for duplicate Seller (GST)
    const existingGst = await Seller.findOne({ gstNumber });
    if (existingGst) {
      if (file) fs.unlinkSync(file.path);
      res.status(400).json({ success: false, message: "A business with this GST number is already registered." });
      return;
    }

    // 4. Handle avatar file upload
    let avatarUrl = "";
    if (file) {
      try {
        const cloudUrl = await uploadToCloudinary(file.path);
        if (cloudUrl) {
          avatarUrl = cloudUrl;
          fs.unlinkSync(file.path);
        } else {
          avatarUrl = `/uploads/user_profile/${file.filename}`;
        }
      } catch (uploadErr) {
        console.error("Avatar cloud upload failed, using local path fallback:", uploadErr);
        avatarUrl = `/uploads/user_profile/${file.filename}`;
      }
    }

    // 5. Step 1: Create the User account first
    const user = new User({
      fullName,
      email,
      phone,
      passwordHash: password, // Auto-encrypted by Mongoose pre-save hook
      role: "seller",
      avatarUrl,
    });

    await user.save();

    // 6. Step 2: Create the Seller record using the newly created userId
    let seller;
    try {
      seller = new Seller({
        userId: user._id,
        businessName,
        gstNumber,
        businessPhone,
        businessEmail,
        approvalStatus: "pending",
      });
      await seller.save();
    } catch (sellerErr: any) {
      // Rollback Step 1: Delete newly created User to guarantee database consistency
      await User.findByIdAndDelete(user._id);
      res.status(400).json({
        success: false,
        message: sellerErr.message || "Failed to create business profile. Signup cancelled.",
      });
      return;
    }

    // 7. Step 3: Establish Passport session
    req.logIn(user, (err) => {
      if (err) {
        console.error("Passport login during seller registration failed:", err);
        return next(err);
      }

      const responseUser = user.toObject();
      delete (responseUser as any).passwordHash;

      res.status(201).json({
        success: true,
        message: "Seller registered and logged in successfully.",
        user: responseUser,
        seller: seller.toObject(),
      });
    });
  } catch (error: any) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    console.error("Seller registration controller error:", error);
    res.status(500).json({ success: false, message: error.message || "Internal server error during registration." });
  }
}

/**
 * [READ OWN] Retrieves profile details of the active authenticated Seller.
 */
export async function getSellerProfile(req: Request, res: Response): Promise<void> {
  try {
    if (!req.user || (req.user as IUser).role !== "seller") {
      res.status(403).json({ success: false, message: "Forbidden. Not registered as a seller." });
      return;
    }

    if (!req.seller) {
      res.status(404).json({ success: false, message: "Seller profile not found." });
      return;
    }

    res.status(200).json({ success: true, seller: req.seller });
  } catch (error) {
    console.error("Get own seller profile error:", error);
    res.status(500).json({ success: false, message: "Internal server error retrieving seller profile." });
  }
}

/**
 * [READ LIST] Retrieves list of all sellers with status query filters. (Admin Only)
 */
export async function getAllSellers(req: Request, res: Response): Promise<void> {
  try {
    const { status } = req.query;
    const query: any = {};
    
    if (status && ["pending", "approved", "rejected"].includes(status as string)) {
      query.approvalStatus = status;
    }

    const sellers = await Seller.find(query).populate("userId", "-passwordHash");
    res.status(200).json({ success: true, sellers });
  } catch (error) {
    console.error("Get all sellers error:", error);
    res.status(500).json({ success: false, message: "Internal server error retrieving sellers." });
  }
}

/**
 * [READ ONE] Retrieves a specific seller profile by ID. (Public/Admin)
 */
export async function getSellerById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const seller = await Seller.findById(id).populate("userId", "-passwordHash");
    
    if (!seller) {
      res.status(404).json({ success: false, message: "Seller profile not found." });
      return;
    }

    res.status(200).json({ success: true, seller });
  } catch (error) {
    console.error("Get seller by ID error:", error);
    res.status(500).json({ success: false, message: "Internal server error retrieving seller." });
  }
}

/**
 * [UPDATE OWN] Updates own seller business profile details. (Seller Only)
 */
export async function updateSellerProfile(req: Request, res: Response): Promise<void> {
  try {
    const { businessName, businessPhone, businessEmail, gstNumber } = req.body;
    const caller = req.user as IUser;

    if (caller.role !== "seller" || !req.seller) {
      res.status(403).json({ success: false, message: "Forbidden. Not registered as a seller." });
      return;
    }

    const seller = await Seller.findById(req.seller._id);
    if (!seller) {
      res.status(404).json({ success: false, message: "Seller profile not found." });
      return;
    }

    if (businessName) seller.businessName = businessName;
    if (businessPhone) seller.businessPhone = businessPhone;
    
    if (businessEmail && businessEmail.toLowerCase() !== seller.businessEmail) {
      seller.businessEmail = businessEmail.toLowerCase();
    }

    if (gstNumber && gstNumber !== seller.gstNumber) {
      const duplicateGst = await Seller.findOne({ gstNumber });
      if (duplicateGst) {
        res.status(400).json({ success: false, message: "This GST number is already registered by another seller." });
        return;
      }
      seller.gstNumber = gstNumber;
    }

    await seller.save();

    res.status(200).json({
      success: true,
      message: "Seller business profile updated successfully.",
      seller,
    });
  } catch (error: any) {
    console.error("Update seller profile error:", error);
    res.status(500).json({ success: false, message: error.message || "Internal server error during profile update." });
  }
}

/**
 * [UPDATE STATUS] Approves or rejects a seller onboarding application. (Admin Only)
 */
export async function updateSellerStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { approvalStatus, rejectionReason } = req.body;
    const adminUser = req.user as IUser;

    if (!["approved", "rejected", "pending"].includes(approvalStatus)) {
      res.status(400).json({ success: false, message: "Invalid status values. Permitted: approved | rejected | pending" });
      return;
    }

    const seller = await Seller.findById(id);
    if (!seller) {
      res.status(404).json({ success: false, message: "Seller profile not found." });
      return;
    }

    seller.approvalStatus = approvalStatus;
    if (approvalStatus === "rejected") {
      seller.rejectionReason = rejectionReason || "No rejection reason provided.";
    } else {
      seller.rejectionReason = "";
    }

    seller.approvedBy = adminUser._id;
    seller.approvedAt = new Date();

    await seller.save();

    res.status(200).json({
      success: true,
      message: `Seller application status has been updated to: ${approvalStatus}.`,
      seller,
    });
  } catch (error) {
    console.error("Update seller status error:", error);
    res.status(500).json({ success: false, message: "Internal server error during status update." });
  }
}

/**
 * [DELETE OWN] Deletes own seller profile, reverting the user account role to customer. (Seller Only)
 */
export async function deleteSellerProfile(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;

    if (caller.role !== "seller" || !req.seller) {
      res.status(403).json({ success: false, message: "Forbidden. Not registered as a seller." });
      return;
    }

    // Delete Seller
    await Seller.findByIdAndDelete(req.seller._id);

    // Revert user role back to customer
    caller.role = "customer";
    await caller.save();

    res.status(200).json({
      success: true,
      message: "Seller profile deleted successfully. Your user account role has reverted to customer.",
    });
  } catch (error) {
    console.error("Delete seller profile error:", error);
    res.status(500).json({ success: false, message: "Internal server error during seller profile deletion." });
  }
}

/**
 * [DELETE ANY] Force deletes any seller profile and associated user account. (Admin Only)
 */
export async function deleteSellerById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const seller = await Seller.findById(id);
    if (!seller) {
      res.status(404).json({ success: false, message: "Seller profile not found." });
      return;
    }

    // Delete linked User account
    await User.findByIdAndDelete(seller.userId);

    // Delete Seller profile
    await Seller.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Seller profile and associated user account deleted successfully.",
    });
  } catch (error) {
    console.error("Delete seller by ID error:", error);
    res.status(500).json({ success: false, message: "Internal server error during seller deletion." });
  }
}
