import type { Request, Response } from "express";
import { Coupon } from "../models/coupon.js";
import type { IUser } from "../models/user.js";
import mongoose from "mongoose";

/**
 * [CREATE] Creates a new coupon for the authenticated seller's store.
 */
export async function createCoupon(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const seller = req.seller;

    if (caller.role !== "seller" || !seller) {
      res.status(403).json({
        success: false,
        message: "Forbidden. Only registered and active sellers can create coupons.",
      });
      return;
    }

    const {
      code,
      discountType,
      discountValue,
      minOrderValue = 0,
      maxDiscountValue,
      usageLimit,
      perUserLimit = 1,
      startsAt,
      endsAt,
      applicableProducts = [],
      applicableCategories = [],
      applicableListings = [],
    } = req.body;

    if (!code || !discountType || discountValue === undefined || !usageLimit || !startsAt || !endsAt) {
      res.status(400).json({
        success: false,
        message: "Required fields: code, discountType, discountValue, usageLimit, startsAt, and endsAt.",
      });
      return;
    }

    const start = new Date(startsAt);
    const end = new Date(endsAt);

    if (start >= end) {
      res.status(400).json({
        success: false,
        message: "Start date must be strictly before end date.",
      });
      return;
    }

    const normalizedCode = code.trim().toUpperCase();

    // Enforce global uniqueness of coupon codes
    const existing = await Coupon.findOne({ code: normalizedCode });
    if (existing) {
      res.status(400).json({
        success: false,
        message: "This coupon code is already registered by a seller.",
      });
      return;
    }

    const coupon = new Coupon({
      sellerId: seller._id,
      code: normalizedCode,
      discountType,
      discountValue,
      minOrderValue,
      maxDiscountValue,
      usageLimit,
      perUserLimit,
      startsAt: start,
      endsAt: end,
      applicableProducts,
      applicableCategories,
      applicableListings,
    });

    await coupon.save();

    res.status(201).json({
      success: true,
      message: "Coupon created successfully.",
      coupon,
    });
  } catch (error: unknown) {
    console.error("Create coupon error:", error);
    const message = error instanceof Error ? error.message : "Failed to create coupon.";
    res.status(400).json({
      success: false,
      message,
    });
  }
}

/**
 * [READ] List all coupons created by the active seller.
 */
export async function getMyCoupons(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const seller = req.seller;

    if (caller.role !== "seller" || !seller) {
      res.status(403).json({
        success: false,
        message: "Forbidden. Seller access required.",
      });
      return;
    }

    const coupons = await Coupon.find({ sellerId: seller._id }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      coupons,
    });
  } catch (error: unknown) {
    console.error("Get my coupons error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve coupons.",
    });
  }
}

/**
 * [DELETE] Deletes a coupon owned by the seller.
 */
export async function deleteCoupon(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const caller = req.user as IUser;
    const seller = req.seller;

    if (caller.role !== "seller" || !seller) {
      res.status(403).json({
        success: false,
        message: "Forbidden. Seller access required.",
      });
      return;
    }

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      res.status(404).json({
        success: false,
        message: "Coupon not found.",
      });
      return;
    }

    // Verify ownership
    if (coupon.sellerId.toString() !== seller._id.toString()) {
      res.status(403).json({
        success: false,
        message: "Forbidden. You do not own this coupon.",
      });
      return;
    }

    await Coupon.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Coupon deleted successfully.",
    });
  } catch (error: unknown) {
    console.error("Delete coupon error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete coupon.",
    });
  }
}

/**
 * [VALIDATE] Checks coupon validity against subtotal value and seller boundaries.
 */
export async function validateCoupon(req: Request, res: Response): Promise<void> {
  try {
    const { code, orderValuePaise, sellerId } = req.body;

    if (!code || orderValuePaise === undefined || !sellerId) {
      res.status(400).json({
        success: false,
        message: "Required fields: code, orderValuePaise, and sellerId.",
      });
      return;
    }

    const normalizedCode = code.trim().toUpperCase();

    // Query active coupon
    const coupon = await Coupon.findOne({ code: normalizedCode, isActive: true });
    if (!coupon) {
      res.status(400).json({
        success: false,
        message: "Invalid or inactive coupon code.",
      });
      return;
    }

    // Date range validation
    const now = new Date();
    if (now < coupon.startsAt || now > coupon.endsAt) {
      res.status(400).json({
        success: false,
        message: "This coupon is either not active yet or has expired.",
      });
      return;
    }

    // General usage capacity validation
    if (coupon.usedCount >= coupon.usageLimit) {
      res.status(400).json({
        success: false,
        message: "This coupon has reached its maximum global usage capacity.",
      });
      return;
    }

    // Seller boundary validation (Sellers can only discount their own items)
    if (coupon.sellerId.toString() !== sellerId.toString()) {
      res.status(400).json({
        success: false,
        message: "This coupon is not valid for this seller's products.",
      });
      return;
    }

    // Minimum order value validation
    if (orderValuePaise < coupon.minOrderValue) {
      res.status(400).json({
        success: false,
        message: `This coupon requires a minimum subtotal of INR ${(coupon.minOrderValue / 100).toFixed(2)}.`,
      });
      return;
    }

    // Per-user usage validation check (best effort using active orders if authenticated)
    if (req.user) {
      const user = req.user as IUser;
      // Fetch orders count matching user, coupon code, and active confirmed status
      const OrderModel = mongoose.models.Order;
      if (OrderModel) {
        const pastOrdersCount = await OrderModel.countDocuments({
          userId: user._id,
          couponCode: normalizedCode,
          status: { $ne: "cancelled" },
        });
        if (pastOrdersCount >= coupon.perUserLimit) {
          res.status(400).json({
            success: false,
            message: "You have reached the maximum allowed usage limit for this coupon.",
          });
          return;
        }
      }
    }

    // Calculate discount amount
    let discountPaise = 0;
    if (coupon.discountType === "percent") {
      discountPaise = Math.floor((orderValuePaise * coupon.discountValue) / 100);
      if (coupon.maxDiscountValue && discountPaise > coupon.maxDiscountValue) {
        discountPaise = coupon.maxDiscountValue;
      }
    } else if (coupon.discountType === "flat") {
      discountPaise = coupon.discountValue;
    }

    // Cap the discount at total order value
    if (discountPaise > orderValuePaise) {
      discountPaise = orderValuePaise;
    }

    res.status(200).json({
      success: true,
      message: "Coupon validated successfully.",
      coupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minOrderValue: coupon.minOrderValue,
      },
      discountPaise,
    });
  } catch (error: unknown) {
    console.error("Validate coupon error:", error);
    const message = error instanceof Error ? error.message : "Failed to validate coupon.";
    res.status(500).json({
      success: false,
      message,
    });
  }
}

/**
 * [UPDATE] Updates a coupon owned by the authenticated seller.
 * Fields: discountType, discountValue, minOrderValue, maxDiscountValue, usageLimit,
 *         perUserLimit, startsAt, endsAt, isActive, applicableProducts,
 *         applicableCategories, applicableListings.
 */
export async function updateCoupon(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params as Record<string, string>;
    const caller = req.user as IUser;
    const seller = req.seller;

    if (caller.role !== "seller" || !seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller access required." });
      return;
    }

    const coupon = await Coupon.findById(id);
    if (!coupon) {
      res.status(404).json({ success: false, message: "Coupon not found." });
      return;
    }

    // Ownership enforcement
    if (coupon.sellerId.toString() !== seller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this coupon." });
      return;
    }

    const {
      discountType, discountValue, minOrderValue, maxDiscountValue,
      usageLimit, perUserLimit, startsAt, endsAt, isActive,
      applicableProducts, applicableCategories, applicableListings,
    } = req.body;

    if (discountType !== undefined) coupon.discountType = discountType;
    if (discountValue !== undefined) coupon.discountValue = discountValue;
    if (minOrderValue !== undefined) coupon.minOrderValue = minOrderValue;
    if (maxDiscountValue !== undefined) coupon.maxDiscountValue = maxDiscountValue;
    if (usageLimit !== undefined) coupon.usageLimit = usageLimit;
    if (perUserLimit !== undefined) coupon.perUserLimit = perUserLimit;
    if (typeof isActive === "boolean") coupon.isActive = isActive;
    if (startsAt !== undefined) coupon.startsAt = new Date(startsAt as string);
    if (endsAt !== undefined) coupon.endsAt = new Date(endsAt as string);
    if (Array.isArray(applicableProducts)) coupon.applicableProducts = applicableProducts;
    if (Array.isArray(applicableCategories)) coupon.applicableCategories = applicableCategories;
    if (Array.isArray(applicableListings)) coupon.applicableListings = applicableListings;

    if (coupon.startsAt >= coupon.endsAt) {
      res.status(400).json({ success: false, message: "Start date must be strictly before end date." });
      return;
    }

    await coupon.save();

    res.status(200).json({ success: true, message: "Coupon updated successfully.", coupon });
  } catch (error: unknown) {
    console.error("Update coupon error:", error);
    const message = error instanceof Error ? error.message : "Failed to update coupon.";
    res.status(500).json({ success: false, message });
  }
}
