import type { Request, Response, NextFunction } from "express";
import { parsePagination } from "../utils/pagination.js";
import fs from "node:fs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { User } from "../models/user.js";
import type { IUser } from "../models/user.js";
import { Seller } from "../models/seller.js";
import { Order } from "../models/order.js";
import { SellerListing } from "../models/sellerListing.js";
import { ListingInventory } from "../models/listingInventory.js";
import { ListingPricingHistory } from "../models/listingPricingHistory.js";
import { Review } from "../models/review.js";
import { Brand } from "../models/brand.js";
import { ProductVariant } from "../models/productVariant.js";
import { Product } from "../models/product.js";
import { slugify } from "../utils/slugify.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";
import { sendSellerPendingEmail, sendSellerStatusEmail } from "../services/email.js";
import { getCache, setCache, clearCachePattern } from "../utils/redis.js";
import { AuditLog } from "../models/auditLog.js";

/**
 * [CREATE] Decoupled registration controller for Sellers.
 * Step 1: Creates the User document with role "seller".
 * Step 2: Extracts the generated userId and creates the Seller document.
 * Step 3: Logs the seller in via Passport and returns combined profiles.
 */
export async function registerSeller(req: Request, res: Response, next: NextFunction): Promise<void> {
  const file = (req as unknown as { file?: { path: string; filename: string } }).file;
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

      // Send seller registration pending review email in background
      sendSellerPendingEmail(user.email, user.fullName, businessName);
    } catch (sellerErr: unknown) {
      // Rollback Step 1: Delete newly created User to guarantee database consistency
      await User.findByIdAndDelete(user._id);
      const message = sellerErr instanceof Error ? sellerErr.message : "Failed to create business profile. Signup cancelled.";
      res.status(400).json({
        success: false,
        message,
      });
      return;
    }

    // 7. Step 3: Establish Passport session
    req.logIn(user, (err) => {
      if (err) {
        console.error("Passport login during seller registration failed:", err);
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
        message: "Seller registered and logged in successfully.",
        user: responseUser,
        seller: seller.toObject(),
        token,
      });
    });
  } catch (error: unknown) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    console.error("Seller registration controller error:", error);
    const message = error instanceof Error ? error.message : "Internal server error during registration.";
    res.status(500).json({ success: false, message });
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
    const { page, limit, skip } = parsePagination(req.query);
    const query: Record<string, unknown> = {};

    if (status && ["pending", "approved", "rejected"].includes(status as string)) {
      query.approvalStatus = status;
    }

    const [sellers, total] = await Promise.all([
      Seller.find(query)
        .populate("userId", "-passwordHash")
        .skip(skip)
        .limit(limit)
        .lean(),
      Seller.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      sellers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
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
  } catch (error: unknown) {
    console.error("Update seller profile error:", error);
    const message = error instanceof Error ? error.message : "Internal server error during profile update.";
    res.status(500).json({ success: false, message });
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
    seller.isKycCompleted = approvalStatus === "approved";
    if (approvalStatus === "rejected") {
      seller.rejectionReason = rejectionReason || "No rejection reason provided.";
    } else {
      seller.rejectionReason = "";
    }

    seller.approvedBy = adminUser._id;
    seller.approvedAt = new Date();

    await seller.save();

    // Write to AuditLog
    const audit = new AuditLog({
      action: "SELLER_STATUS_UPDATE",
      performedBy: adminUser._id,
      targetId: seller._id,
      details: `Admin ${adminUser.fullName} (${adminUser.email}) updated status of seller business "${seller.businessName}" (GST: ${seller.gstNumber}) to: ${approvalStatus.toUpperCase()}.`,
    });
    await audit.save();

    // Send decision email to the seller asynchronously
    if (approvalStatus === "approved" || approvalStatus === "rejected") {
      User.findById(seller.userId)
        .then((user) => {
          const sellerName = user ? user.fullName : "Seller Partner";
          sendSellerStatusEmail(
            seller.businessEmail,
            sellerName,
            seller.businessName,
            approvalStatus as "approved" | "rejected",
            seller.rejectionReason
          );
        })
        .catch((err) => console.error("Error looking up user for status email:", err));
    }

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

    // Write to AuditLog
    const adminUser = req.user as IUser;
    const audit = new AuditLog({
      action: "SELLER_DELETED",
      performedBy: adminUser._id,
      targetId: seller._id,
      details: `Admin ${adminUser.fullName} (${adminUser.email}) permanently force-deleted seller business "${seller.businessName}" (GST: ${seller.gstNumber}) and its linked user account (ID: ${seller.userId}).`,
    });
    await audit.save();

    res.status(200).json({
      success: true,
      message: "Seller profile and associated user account deleted successfully.",
    });
  } catch (error) {
    console.error("Delete seller by ID error:", error);
    res.status(500).json({ success: false, message: "Internal server error during seller deletion." });
  }
}

// ==============================================================================
// 1. SELLER PERFORMANCE ANALYTICS DASHBOARD
// ==============================================================================

/**
 * [READ ANALYTICS] Scopes revenue, order counts, status breakdowns,
 * low stock alerts, and reviews specifically to the authenticated seller.
 */
export async function getSellerDashboardAnalytics(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    if (caller.role !== "seller" || !req.seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller onboarding required." });
      return;
    }

    const sellerId = req.seller._id;
    const lowStockThreshold = Number(req.query.threshold) || 5;

    const cacheKey = `seller:analytics:${sellerId.toString()}:${lowStockThreshold}`;
    const cachedAnalytics = await getCache<Record<string, any>>(cacheKey);
    if (cachedAnalytics) {
      res.status(200).json({ success: true, fromCache: true, ...cachedAnalytics });
      return;
    }

    // 1. Fetch all orders containing items from this seller
    const orders = await Order.find({ "items.sellerId": sellerId }).lean();

    let totalRevenuePaise = 0;
    let totalItemsSold = 0;
    const orderStatuses: Record<string, number> = {
      confirmed: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
    };

    const sellerOrdersCount = orders.length;

    for (const order of orders) {
      const currentCount = orderStatuses[order.status];
      if (currentCount !== undefined) {
        orderStatuses[order.status] = currentCount + 1;
      } else {
        orderStatuses[order.status] = 1;
      }

      // Pro-rate financial metrics (skip cancelled orders for revenue/sales calculations)
      if (order.status !== "cancelled") {
        for (const item of order.items) {
          if (item.sellerId.toString() === sellerId.toString()) {
            totalItemsSold += item.quantity;

            // Subtract pro-rated coupon discounts securely from selling price
            const itemNetRevenue = (item.sellingPricePaiseSnapshot * item.quantity) - (item.couponDiscountPaiseForItem || 0);
            totalRevenuePaise += Math.max(0, itemNetRevenue);
          }
        }
      }
    }

    // 2. Fetch low-stock warnings linked to seller listings
    const myListings = await SellerListing.find({ sellerId }).lean();
    const listingIds = myListings.map((l) => l._id);

    const lowStockAlerts = await ListingInventory.find({
      listingId: { $in: listingIds },
      availableQuantity: { $lte: lowStockThreshold },
    })
      .populate({
        path: "listingId",
        populate: {
          path: "variantId",
          populate: { path: "catalogProductId", select: "title slug" },
        },
      })
      .lean();

    const formattedAlerts = lowStockAlerts.map((inv: any) => {
      const listing = inv.listingId;
      const variant = listing?.variantId;
      const product = variant?.catalogProductId;
      return {
        listingId: listing?._id,
        sku: listing?.sellerSku,
        productTitle: product?.title || "Unknown Product",
        productSlug: product?.slug || "",
        variantAttributes: variant?.variantAttributes || {},
        availableQuantity: inv.availableQuantity,
        lowStockThreshold: inv.lowStockThreshold,
      };
    });

    // 3. Fetch latest reviews on products created by this seller
    const myProducts = await Product.find({ createdBy: caller._id }).select("_id").lean();
    const productIds = myProducts.map((p) => p._id);

    const latestReviews = await Review.find({
      catalogProductId: { $in: productIds },
      status: "approved",
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("userId", "fullName avatarUrl")
      .populate("catalogProductId", "title slug")
      .lean();

    const responsePayload = {
      analytics: {
        totalRevenueRupees: parseFloat((totalRevenuePaise / 100).toFixed(2)),
        totalItemsSold,
        totalOrdersCount: sellerOrdersCount,
        orderStatusBreakdown: orderStatuses,
        lowStockAlerts: formattedAlerts,
        latestReviews,
      },
    };

    // Cache the analytics results (TTL: 2 minutes = 120 seconds)
    await setCache(cacheKey, responsePayload, 120);

    res.status(200).json({
      success: true,
      ...responsePayload,
    });
  } catch (error: unknown) {
    console.error("Seller dashboard analytics error:", error);
    res.status(500).json({ success: false, message: "Failed to load seller analytics dashboard." });
  }
}

// ==============================================================================
// 2. SELLER LISTINGS & INVENTORIES CRUD MANAGEMENT
// ==============================================================================

/**
 * [CREATE LISTING] Adds an active seller listing offer for an existing catalog variant.
 * Automatically initializes both inventory logs and initial pricing profiles securely.
 */
export async function createSellerListing(req: Request, res: Response): Promise<void> {
  const isReplicaSet = ["ReplicaSetNoPrimary", "ReplicaSetWithPrimary", "Sharded"].includes(
    (mongoose.connection as any).client?.topology?.description?.type || ""
  );
  const session = isReplicaSet ? await mongoose.startSession() : null;
  if (session) session.startTransaction();

  try {
    const caller = req.user as IUser;
    if (caller.role !== "seller" || !req.seller) {
      if (session) await session.abortTransaction();
      res.status(403).json({ success: false, message: "Forbidden. Active seller profile required." });
      return;
    }

    const {
      variantId,
      sellerSku,
      condition = "new",
      procurementType = "stock",
      fulfillmentType = "seller",
      shippingProfileId = null,
      availableQuantity = 0,
      pricePaise,
      comparePricePaise,
    } = req.body;

    if (!variantId || !sellerSku || pricePaise === undefined) {
      if (session) await session.abortTransaction();
      res.status(400).json({ success: false, message: "Required fields: variantId, sellerSku, and pricePaise." });
      return;
    }

    // 1. Verify target Variant exists
    const variant = await ProductVariant.findById(variantId).session(session);
    if (!variant) {
      if (session) await session.abortTransaction();
      res.status(404).json({ success: false, message: "Product Variant not found." });
      return;
    }

    // 2. Prevent duplicate listings of the same variant by the same seller
    const duplicateListing = await SellerListing.findOne({
      sellerId: req.seller._id,
      variantId,
    }).session(session);

    if (duplicateListing) {
      if (session) await session.abortTransaction();
      res.status(409).json({
        success: false,
        message: "You have already registered an offer listing for this variant. Please update that listing instead.",
      });
      return;
    }

    // 3. Create the Seller Listing
    const listing = new SellerListing({
      sellerId: req.seller._id,
      variantId,
      sellerSku: sellerSku.trim(),
      condition,
      procurementType,
      fulfillmentType,
      shippingProfileId,
      status: "active",
    });
    await listing.save({ session });

    // 4. Initialize Inventory Logs
    const inventory = new ListingInventory({
      listingId: listing._id,
      availableQuantity: Math.max(0, availableQuantity),
      reservedQuantity: 0,
      damagedQuantity: 0,
      lowStockThreshold: 5,
    });
    await inventory.save({ session });

    // 5. Establish Initial Pricing History Entry
    const pricing = new ListingPricingHistory({
      listingId: listing._id,
      mrpPaise: comparePricePaise || pricePaise,
      sellingPricePaise: pricePaise,
      startAt: new Date(),
    });
    await pricing.save({ session });

    if (session) await session.commitTransaction();

    // Invalidate dashboard analytics caches for this seller
    await clearCachePattern(`seller:analytics:${req.seller._id.toString()}:*`);

    res.status(201).json({
      success: true,
      message: "Seller offer listing successfully registered.",
      listing,
      inventory,
      pricing,
    });
  } catch (error: unknown) {
    if (session) await session.abortTransaction();
    console.error("Create seller listing error:", error);
    const msg = error instanceof Error ? error.message : "Failed to register seller listing.";
    res.status(500).json({ success: false, message: msg });
  } finally {
    if (session) session.endSession();
  }
}

/**
 * [READ LISTINGS] Returns all listings created by the authenticated seller,
 * fully populating details of the variant configuration and master products.
 */
export async function getMySellerListings(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    if (caller.role !== "seller" || !req.seller) {
      res.status(403).json({ success: false, message: "Forbidden. Active seller profile required." });
      return;
    }

    const { page, limit, skip } = parsePagination(req.query);

    const [listings, total] = await Promise.all([
      SellerListing.find({ sellerId: req.seller._id })
        .populate({
          path: "variantId",
          populate: { path: "catalogProductId", select: "title slug" },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SellerListing.countDocuments({ sellerId: req.seller._id }),
    ]);

    const listingsWithInventories = [];

    // Collect inventories and latest pricing logs in parallel for response completeness
    for (const listing of listings) {
      const [inv, priceLog] = await Promise.all([
        ListingInventory.findOne({ listingId: listing._id }).lean(),
        ListingPricingHistory.findOne({ listingId: listing._id, endAt: null }).sort({ startAt: -1 }).lean(),
      ]);

      listingsWithInventories.push({
        ...listing,
        availableQuantity: inv ? inv.availableQuantity : 0,
        pricePaise: priceLog ? priceLog.sellingPricePaise : 0,
        comparePricePaise: priceLog ? priceLog.mrpPaise : 0,
      });
    }

    res.status(200).json({
      success: true,
      listings: listingsWithInventories,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    console.error("Get my seller listings error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch listings." });
  }
}

/**
 * [UPDATE LISTING] Updates pricing profile history, stock levels, or status configurations
 * within a secure unified transactional session.
 */
export async function updateSellerListing(req: Request, res: Response): Promise<void> {
  const isReplicaSet = ["ReplicaSetNoPrimary", "ReplicaSetWithPrimary", "Sharded"].includes(
    (mongoose.connection as any).client?.topology?.description?.type || ""
  );
  const session = isReplicaSet ? await mongoose.startSession() : null;
  if (session) session.startTransaction();

  try {
    const { id } = req.params;
    const caller = req.user as IUser;
    if (caller.role !== "seller" || !req.seller) {
      if (session) await session.abortTransaction();
      res.status(403).json({ success: false, message: "Forbidden. Active seller profile required." });
      return;
    }

    const {
      status,
      procurementType,
      fulfillmentType,
      shippingProfileId,
      availableQuantity,
      pricePaise,
      comparePricePaise,
    } = req.body;

    const listing = await SellerListing.findById(id).session(session);
    if (!listing) {
      if (session) await session.abortTransaction();
      res.status(404).json({ success: false, message: "Listing not found." });
      return;
    }

    // Enforce strict ownership
    if (listing.sellerId.toString() !== req.seller._id.toString()) {
      if (session) await session.abortTransaction();
      res.status(403).json({ success: false, message: "Forbidden. You do not own this listing." });
      return;
    }

    // Update listing parameters
    if (status && ["active", "paused", "blocked"].includes(status)) {
      listing.status = status;
    }
    if (procurementType) listing.procurementType = procurementType;
    if (fulfillmentType) listing.fulfillmentType = fulfillmentType;
    if (shippingProfileId !== undefined) listing.shippingProfileId = shippingProfileId;
    await listing.save({ session });

    // Update inventory quantity if requested
    if (availableQuantity !== undefined) {
      const inv = await (ListingInventory as any).findOne({ listingId: listing._id }).session(session);
      if (inv) {
        inv.availableQuantity = Math.max(0, availableQuantity);
        await inv.save({ session });
      }
    }

    // Securely update pricing and write to historical logs
    if (pricePaise !== undefined) {
      // 1. Close out currently active pricing profile
      await (ListingPricingHistory as any).updateMany(
        { listingId: listing._id, endAt: null },
        { $set: { endAt: new Date() } },
        { session } as any
      );

      // 2. Register new pricing snapshot entry
      const newPricing = new ListingPricingHistory({
        listingId: listing._id,
        mrpPaise: comparePricePaise || pricePaise,
        sellingPricePaise: pricePaise,
        startAt: new Date(),
      });
      await newPricing.save({ session });
    }

    if (session) await session.commitTransaction();

    // Invalidate dashboard analytics caches for this seller
    await clearCachePattern(`seller:analytics:${req.seller._id.toString()}:*`);

    res.status(200).json({
      success: true,
      message: "Listing offer updated successfully.",
      listing,
    });
  } catch (error: unknown) {
    if (session) await session.abortTransaction();
    console.error("Update seller listing error:", error);
    const msg = error instanceof Error ? error.message : "Failed to update seller listing.";
    res.status(500).json({ success: false, message: msg });
  } finally {
    if (session) session.endSession();
  }
}

/**
 * [DELETE LISTING] Force-clears listing allocations, pricing histories, and stock inventories.
 */
export async function deleteSellerListing(req: Request, res: Response): Promise<void> {
  const isReplicaSet = ["ReplicaSetNoPrimary", "ReplicaSetWithPrimary", "Sharded"].includes(
    (mongoose.connection as any).client?.topology?.description?.type || ""
  );
  const session = isReplicaSet ? await mongoose.startSession() : null;
  if (session) session.startTransaction();

  try {
    const { id } = req.params;
    if (!id || typeof id !== "string") {
      if (session) await session.abortTransaction();
      res.status(400).json({ success: false, message: "Invalid listing ID parameter." });
      return;
    }

    const caller = req.user as IUser;
    if (caller.role !== "seller" || !req.seller) {
      if (session) await session.abortTransaction();
      res.status(403).json({ success: false, message: "Forbidden. Active seller profile required." });
      return;
    }

    const listing = await SellerListing.findById(id).session(session);
    if (!listing) {
      if (session) await session.abortTransaction();
      res.status(404).json({ success: false, message: "Listing not found." });
      return;
    }

    // Ownership validation
    if (listing.sellerId.toString() !== req.seller._id.toString()) {
      if (session) await session.abortTransaction();
      res.status(403).json({ success: false, message: "Forbidden. You do not own this listing." });
      return;
    }

    // Cascade deletes
    await Promise.all([
      SellerListing.findByIdAndDelete(id, { session } as any),
      (ListingInventory as any).deleteOne({ listingId: id }, { session } as any),
      (ListingPricingHistory as any).deleteMany({ listingId: id }, { session } as any),
    ]);

    if (session) await session.commitTransaction();

    // Invalidate dashboard analytics caches for this seller
    await clearCachePattern(`seller:analytics:${req.seller._id.toString()}:*`);

    res.status(200).json({
      success: true,
      message: "Listing offer and associated logs deleted successfully.",
    });
  } catch (error: unknown) {
    if (session) await session.abortTransaction();
    console.error("Delete seller listing error:", error);
    res.status(500).json({ success: false, message: "Failed to delete seller listing." });
  } finally {
    if (session) session.endSession();
  }
}

// ==============================================================================
// 3. SELLER BRAND REGISTRY SUITE
// ==============================================================================

/**
 * [REGISTER BRAND] Submits a custom brand onboarding request.
 * Brand automatically registers as unverified pending admin verification.
 */
export async function registerBrand(req: Request, res: Response): Promise<void> {
  const file = (req as unknown as { file?: { path: string; filename: string } }).file;
  try {
    const caller = req.user as IUser;
    if (caller.role !== "seller" || !req.seller) {
      if (file) fs.unlinkSync(file.path);
      res.status(403).json({ success: false, message: "Forbidden. Only registered sellers can register brands." });
      return;
    }

    const { name } = req.body;
    if (!name) {
      if (file) fs.unlinkSync(file.path);
      res.status(400).json({ success: false, message: "Brand name is required." });
      return;
    }

    const brandSlug = slugify(name);

    // Uniqueness validation check
    const existing = await Brand.findOne({ slug: brandSlug });
    if (existing) {
      if (file) fs.unlinkSync(file.path);
      res.status(409).json({ success: false, message: "A brand with this name or slug is already registered." });
      return;
    }

    // Handle logo image uploads
    let logoUrl = "";
    if (file) {
      try {
        const cloudUrl = await uploadToCloudinary(file.path);
        if (cloudUrl) {
          logoUrl = cloudUrl;
          fs.unlinkSync(file.path);
        } else {
          logoUrl = `/uploads/brand_logo/${file.filename}`;
        }
      } catch (uploadErr) {
        console.error("Brand logo Cloudinary upload failed, reverting to local path:", uploadErr);
        logoUrl = `/uploads/brand_logo/${file.filename}`;
      }
    }

    const brand = new Brand({
      name: name.trim(),
      slug: brandSlug,
      logoUrl,
      isVerified: false,
      createdBy: caller._id,
    });
    await brand.save();

    res.status(201).json({
      success: true,
      message: "Brand registry request submitted successfully. Awaiting administrator review.",
      brand,
    });
  } catch (error: unknown) {
    if (file && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    console.error("Register brand error:", error);
    const msg = error instanceof Error ? error.message : "Failed to register brand.";
    res.status(500).json({ success: false, message: msg });
  }
}

/**
 * [GET MY BRANDS] Returns custom brands created by this seller.
 */
export async function getMyBrands(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    if (caller.role !== "seller" || !req.seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller role required." });
      return;
    }

    const brands = await Brand.find({ createdBy: caller._id }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      brands,
    });
  } catch (error) {
    console.error("Get my brands error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch registered brands." });
  }
}

/**
 * [VERIFY BRAND] Admin endpoint to approve or revoke verification of a custom brand.
 */
export async function updateBrandVerificationStatus(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { isVerified } = req.body;

    if (typeof isVerified !== "boolean") {
      res.status(400).json({ success: false, message: "isVerified field must be a boolean." });
      return;
    }

    const brand = await Brand.findById(id);
    if (!brand) {
      res.status(404).json({ success: false, message: "Brand not found." });
      return;
    }

    brand.isVerified = isVerified;
    await brand.save();

    res.status(200).json({
      success: true,
      message: `Brand verification status has been successfully ${isVerified ? "approved" : "revoked"}.`,
      brand,
    });
  } catch (error) {
    console.error("Verify brand error:", error);
    res.status(500).json({ success: false, message: "Internal server error during brand verification." });
  }
}
