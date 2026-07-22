import type { Request, Response, NextFunction } from "express";
import { parsePagination } from "../utils/pagination.js";
import mongoose from "mongoose";
import { Cart } from "../models/cart.js";
import { Coupon } from "../models/coupon.js";
import { CouponUsage } from "../models/couponUsage.js";
import { Order } from "../models/order.js";
import Razorpay from "razorpay";
import crypto from "crypto";
import { Address } from "../models/address.js";
import { ListingInventory } from "../models/listingInventory.js";
import { ListingPricingHistory } from "../models/listingPricingHistory.js";
import { SellerListing } from "../models/sellerListing.js";
import { Seller } from "../models/seller.js";
import type { IUser } from "../models/user.js";
import type { IOrderItem, IAddressSnapshot, IOrder } from "../models/order.js";
import { dispatchWebhookEvent } from "../services/webhookDispatcher.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PopulatedCartProduct {
  _id: mongoose.Types.ObjectId;
  title: string;
  sellerId: mongoose.Types.ObjectId;
  categoryId: mongoose.Types.ObjectId;
  defaultVariantId?: mongoose.Types.ObjectId | null;
}

interface PopulatedCartItem {
  productId: PopulatedCartProduct;
  variantId?: mongoose.Types.ObjectId | null;
  listingId?: mongoose.Types.ObjectId | null;
  quantity: number;
  titleSnapshot: string;
  imageSnapshot?: string;
  pricePaiseSnapshot: number;
}

// ─── Coupon Discount Engine ──────────────────────────────────────

interface CouponCheckResult {
  discountPaise: number;
  couponId?: mongoose.Types.ObjectId;
  eligibleItemIndexes: number[];
}

async function computeCouponDiscount(
  cartItems: PopulatedCartItem[],
  couponCode: string | null | undefined,
  userId: mongoose.Types.ObjectId
): Promise<CouponCheckResult> {
  if (!couponCode) return { discountPaise: 0, eligibleItemIndexes: [] };

  const coupon = await Coupon.findOne({ code: couponCode, isActive: true });
  if (!coupon) return { discountPaise: 0, eligibleItemIndexes: [] };

  const now = new Date();
  if (now < coupon.startsAt || now > coupon.endsAt) {
    return { discountPaise: 0, eligibleItemIndexes: [] };
  }
  if (coupon.usedCount >= coupon.usageLimit) {
    return { discountPaise: 0, eligibleItemIndexes: [] };
  }

  // Per-user usage check via CouponUsage ledger
  const usageCount = await CouponUsage.countDocuments({
    couponId: coupon._id,
    userId,
  });
  if (usageCount >= coupon.perUserLimit) {
    return { discountPaise: 0, eligibleItemIndexes: [] };
  }

  // Compute seller-scoped subtotal
  let sellerSubtotal = 0;
  const eligibleItemIndexes: number[] = [];

  for (let i = 0; i < cartItems.length; i++) {
    const item = cartItems[i];
    if (!item) continue;
    const product = item.productId;
    if (product?.sellerId?.toString() !== coupon.sellerId.toString()) continue;

    const matchesProduct =
      coupon.applicableProducts.length === 0 ||
      coupon.applicableProducts.some(
        (pId) => pId.toString() === product._id.toString()
      );
    const matchesCategory =
      coupon.applicableCategories.length === 0 ||
      coupon.applicableCategories.some(
        (cId) => cId.toString() === product.categoryId?.toString()
      );
    const itemVariantIdStr = item.variantId?.toString();
    const matchesListing =
      coupon.applicableListings.length === 0 ||
      (!!itemVariantIdStr &&
        coupon.applicableListings.some(
          (lId) => lId.toString() === itemVariantIdStr
        ));

    if (matchesProduct && matchesCategory && matchesListing) {
      sellerSubtotal += item.pricePaiseSnapshot * item.quantity;
      eligibleItemIndexes.push(i);
    }
  }

  if (sellerSubtotal === 0 || sellerSubtotal < coupon.minOrderValue) {
    return { discountPaise: 0, eligibleItemIndexes: [] };
  }

  let discountPaise = 0;
  if (coupon.discountType === "percent") {
    discountPaise = Math.floor((sellerSubtotal * coupon.discountValue) / 100);
    if (coupon.maxDiscountValue && discountPaise > coupon.maxDiscountValue) {
      discountPaise = coupon.maxDiscountValue;
    }
  } else {
    discountPaise = coupon.discountValue;
  }

  if (discountPaise > sellerSubtotal) discountPaise = sellerSubtotal;

  return {
    discountPaise,
    couponId: coupon._id as mongoose.Types.ObjectId,
    eligibleItemIndexes,
  };
}


// ─── [POST] /api/orders/razorpay-init — Initialize Razorpay Order ──────────────
export async function razorpayInit(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    
    // 1. Load cart with populated products (same as placeOrder)
    const cart = await Cart.findOne({ userId: caller._id }).populate<{
      items: any[];
    }>({
      path: "items.productId",
      select: "title sellerId categoryId defaultVariantId",
    });

    if (!cart || cart.items.length === 0) {
      res.status(400).json({ success: false, message: "Your cart is empty." });
      return;
    }

    const cartItems = cart.items;
    let sellingTotalPaise = 0;

    for (const item of cartItems) {
      const product = item.productId;
      if (!product) continue;
      let sellingPaise = item.pricePaiseSnapshot;
      let resolvedListingId = item.listingId;
      if (!resolvedListingId) {
        const targetVariantId = item.variantId || product.defaultVariantId;
        if (targetVariantId) {
          const listing = await SellerListing.findOne({ variantId: targetVariantId });
          if (listing) {
            resolvedListingId = listing._id;
          }
        }
      }
      if (resolvedListingId) {
        const pricing = await ListingPricingHistory.findOne({
          listingId: resolvedListingId,
          endAt: null,
        }).sort({ startAt: -1 });
        if (pricing) {
          sellingPaise = pricing.sellingPricePaise;
        }
      }
      item.pricePaiseSnapshot = sellingPaise;
      sellingTotalPaise += sellingPaise * item.quantity;
    }

    const couponResult = await computeCouponDiscount(
      cartItems as any,
      cart.couponCode,
      caller._id as any
    );
    const totalPaise = Math.max(0, sellingTotalPaise - couponResult.discountPaise);

    // Initialize Razorpay
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || "",
      key_secret: process.env.RAZORPAY_KEY_SECRET || "",
    });

    const options = {
      amount: totalPaise,
      currency: "INR",
      receipt: "receipt_" + Date.now(),
    };

    const order = await razorpay.orders.create(options);
    
    res.status(200).json({
      success: true,
      razorpayOrderId: order.id,
      amount: totalPaise,
      key_id: process.env.RAZORPAY_KEY_ID
    });
  } catch (error: any) {
    let message = "Failed to initialize Razorpay.";
    if (error instanceof Error) {
      message = error.message;
    } else if (error && error.error && error.error.description) {
      message = error.error.description;
    }
    res.status(500).json({ success: false, message });
  }
}


// ─── [POST] /api/orders — Place Order ─────────────────────────────────────────

export async function placeOrder(req: Request, res: Response): Promise<void> {
  const isReplicaSet = ["ReplicaSetNoPrimary", "ReplicaSetWithPrimary", "Sharded"].includes(
    (mongoose.connection as any).client?.topology?.description?.type || ""
  );
  const session = isReplicaSet ? await mongoose.startSession() : null;
  if (session) session.startTransaction();

  try {
    const caller = req.user as IUser;
    const { addressId, paymentMethod, notes, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body as {
      addressId: string;
      paymentMethod: "cod" | "online";
      notes?: string;
      razorpayOrderId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
    };

    // 1. Validate required fields
    if (!addressId || !paymentMethod) {
      if (session) await session.abortTransaction();
      res.status(400).json({
        success: false,
        message: "addressId and paymentMethod are required.",
      });
      return;
    }
    if (!["cod", "online"].includes(paymentMethod)) {
      if (session) await session.abortTransaction();
      res.status(400).json({
        success: false,
        message: "paymentMethod must be 'cod' or 'online'.",
      });
      return;
    }

    if (paymentMethod === "online") {
      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
        if (session) await session.abortTransaction();
        res.status(400).json({
          success: false,
          message: "Razorpay payment details are missing.",
        });
        return;
      }

      const generatedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
        .update(razorpayOrderId + "|" + razorpayPaymentId)
        .digest("hex");

      if (generatedSignature !== razorpaySignature) {
        if (session) await session.abortTransaction();
        res.status(400).json({
          success: false,
          message: "Invalid payment signature.",
        });
        return;
      }
    }

    // 2. Validate address ownership
    const address = await Address.findOne({
      _id: addressId,
      userId: caller._id,
    });
    if (!address) {
      if (session) await session.abortTransaction();
      res.status(404).json({
        success: false,
        message: "Address not found or does not belong to you.",
      });
      return;
    }

    // 3. Load cart with populated products
    const cart = await Cart.findOne({ userId: caller._id }).populate<{
      items: PopulatedCartItem[];
    }>({
      path: "items.productId",
      select: "title sellerId categoryId defaultVariantId",
    });

    if (!cart || cart.items.length === 0) {
      if (session) await session.abortTransaction();
      res.status(400).json({
        success: false,
        message: "Your cart is empty. Add items before placing an order.",
      });
      return;
    }

    const cartItems = cart.items as unknown as PopulatedCartItem[];

    // 4. Fetch MRP snapshot from ListingPricingHistory for each item
    //    Falls back to pricePaiseSnapshot if no pricing history record exists
    const orderItems: IOrderItem[] = [];
    let mrpTotalPaise = 0;
    let sellingTotalPaise = 0;

    for (const item of cartItems) {
      const product = item.productId;
      if (!product) {
        if (session) await session.abortTransaction();
        res.status(400).json({
          success: false,
          message: "A product in your cart is no longer available.",
        });
        return;
      }

      // Latest active pricing history for this listing/variant
      let mrpPaise = item.pricePaiseSnapshot;
      let sellingPaise = item.pricePaiseSnapshot;

      // Dynamically resolve listingId from variantId or defaultVariantId
      let resolvedListingId = item.listingId;
      if (!resolvedListingId) {
        const targetVariantId = item.variantId || product.defaultVariantId;
        if (targetVariantId) {
          const listing = await SellerListing.findOne({ variantId: targetVariantId });
          if (listing) {
            resolvedListingId = listing._id as mongoose.Types.ObjectId;
          }
        }
      }

      if (resolvedListingId) {
        const pricing = await ListingPricingHistory.findOne({
          listingId: resolvedListingId,
          endAt: null, // currently active price
        }).sort({ startAt: -1 });

        if (pricing) {
          mrpPaise = pricing.mrpPaise;
          sellingPaise = pricing.sellingPricePaise;
        }
      }

      // Update the snapshot in cartItems so the coupon engine uses the LATEST active selling price
      item.pricePaiseSnapshot = sellingPaise;

      orderItems.push({
        productId: product._id,
        variantId: item.variantId ?? null,
        listingId: (resolvedListingId as mongoose.Types.ObjectId) ?? null,
        sellerId: product.sellerId,
        titleSnapshot: item.titleSnapshot,
        imageSnapshot: item.imageSnapshot ?? "",
        quantity: item.quantity,
        mrpPaiseSnapshot: mrpPaise,
        sellingPricePaiseSnapshot: sellingPaise,
        couponDiscountPaiseForItem: 0, // will be filled after coupon computation
      });

      mrpTotalPaise += mrpPaise * item.quantity;
      sellingTotalPaise += sellingPaise * item.quantity;
    }

    // Ensure product discount is non-negative to avoid database schema validation errors
    const productDiscountPaise = Math.max(0, mrpTotalPaise - sellingTotalPaise);

    // 5. Compute coupon discount
    const couponResult = await computeCouponDiscount(
      cartItems,
      cart.couponCode,
      caller._id as mongoose.Types.ObjectId
    );
    const couponDiscountPaise = couponResult.discountPaise;

    // Pro-rate coupon discount across eligible items (best-effort, proportional)
    if (couponDiscountPaise > 0 && couponResult.eligibleItemIndexes.length > 0) {
      const eligibleTotal = couponResult.eligibleItemIndexes.reduce(
        (sum, idx) => {
          const item = cartItems[idx];
          if (!item) return sum;
          return sum + item.pricePaiseSnapshot * item.quantity;
        },
        0
      );

      for (let i = 0; i < orderItems.length; i++) {
        if (couponResult.eligibleItemIndexes.includes(i)) {
          const orderItem = orderItems[i];
          if (!orderItem) continue;
          const itemTotal = orderItem.sellingPricePaiseSnapshot * orderItem.quantity;
          const ratio = eligibleTotal > 0 ? itemTotal / eligibleTotal : 0;
          orderItem.couponDiscountPaiseForItem = Math.floor(
            couponDiscountPaise * ratio
          );
        }
      }
    }

    const totalPaise = Math.max(0, sellingTotalPaise - couponDiscountPaise);

    // 6. Snapshot the address
    const addressSnapshot: IAddressSnapshot = {
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2,
      landmark: address.landmark,
      city: address.city,
      state: address.state,
      country: address.country,
      pincode: address.pincode,
    };

    // 7. Atomically decrement inventory for each item
    for (const item of orderItems) {
      if (item.listingId) {
        const inventoryUpdate = await (ListingInventory as any).findOneAndUpdate(
          {
            listingId: item.listingId,
            availableQuantity: { $gte: item.quantity },
          },
          { $inc: { availableQuantity: -item.quantity } },
          { new: true, session } as any
        );

        if (!inventoryUpdate) {
          if (session) await session.abortTransaction();
          res.status(409).json({
            success: false,
            message: `Insufficient stock for: ${item.titleSnapshot}. Please update your cart.`,
          });
          return;
        }
      }
    }

    // 8. Create the Order document
    const createdOrders = await Order.create(
      [
        {
          userId: caller._id,
          addressId: address._id,
          addressSnapshot,
          items: orderItems,
          couponCode: cart.couponCode ?? null,
          couponDiscountPaise,
          mrpTotalPaise,
          sellingTotalPaise,
          productDiscountPaise,
          totalPaise,
          paymentMethod,
          paymentStatus: paymentMethod === "online" ? "paid" : "pending",
          status: "confirmed",
          notes: notes ?? null,
          ...(paymentMethod === "online" ? {
            razorpayOrderId,
            razorpayPaymentId,
            razorpaySignature,
          } : {})
        },
      ],
      { session } as any
    );
    const order = createdOrders[0];
    if (!order || order instanceof Error) {
      if (session) await session.abortTransaction();
      res.status(500).json({
        success: false,
        message: "Failed to create order record.",
      });
      return;
    }

    // 9. Record coupon usage atomically if a coupon was applied
    if (couponResult.couponId && couponDiscountPaise > 0) {
      await CouponUsage.create(
        [
          {
            couponId: couponResult.couponId,
            userId: caller._id,
            orderId: order._id,
            discountPaise: couponDiscountPaise,
          },
        ],
        { session } as any
      );

      // Increment global usage counter
      await Coupon.findByIdAndUpdate(
        couponResult.couponId,
        { $inc: { usedCount: 1 } },
        { session } as any
      );
    }

    // 10. Clear the cart
    await Cart.findOneAndUpdate(
      { userId: caller._id },
      { $set: { items: [], couponCode: null } },
      { session } as any
    );

    // COD — already confirmed
    if (session) await session.commitTransaction();

    dispatchWebhookEvent("order.created", order.toObject(), caller._id);

    res.status(201).json({
      success: true,
      message: `Order placed successfully (${paymentMethod === 'online' ? 'Paid Online' : 'Cash on Delivery'}).`,
      order,
    });
  } catch (error: unknown) {
    if (session) await session.abortTransaction();
    const message = error instanceof Error ? error.message : "Failed to place order.";
    console.error("Place order error:", error);
    res.status(500).json({ success: false, message });
  } finally {
    if (session) session.endSession();
  }
}

// ─── [GET] /api/orders — My Orders (paginated) ────────────────────────────────

export async function getMyOrders(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const { page, limit, skip } = parsePagination(req.query);

    const [orders, total] = await Promise.all([
      Order.find({ userId: caller._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments({ userId: caller._id }),
    ]);

    res.status(200).json({
      success: true,
      orders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch orders.";
    console.error("Get my orders error:", error);
    res.status(500).json({ success: false, message });
  }
}

// ─── [GET] /api/orders/:orderId — Order Detail ────────────────────────────────

export async function getOrderById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const caller = req.user as IUser;
    const { orderId } = req.params;

    // Guard against Express route parameter capture collision
    if (orderId === "all" || orderId === "seller") {
      next();
      return;
    }

    if (typeof orderId !== "string" || !mongoose.Types.ObjectId.isValid(orderId)) {
      res.status(400).json({ success: false, message: "Invalid order ID." });
      return;
    }

    const query =
      caller.role === "admin"
        ? { _id: orderId }
        : { _id: orderId, userId: caller._id };

    const order = await Order.findOne(query).lean();
    if (!order) {
      res.status(404).json({ success: false, message: "Order not found." });
      return;
    }

    res.status(200).json({ success: true, order });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch order.";
    console.error("Get order by ID error:", error);
    res.status(500).json({ success: false, message });
  }
}

// ─── [POST] /api/orders/:orderId/cancel — Cancel Order ────────────────────────

export async function cancelOrder(req: Request, res: Response): Promise<void> {
  const isReplicaSet = ["ReplicaSetNoPrimary", "ReplicaSetWithPrimary", "Sharded"].includes(
    (mongoose.connection as any).client?.topology?.description?.type || ""
  );
  const session = isReplicaSet ? await mongoose.startSession() : null;
  if (session) session.startTransaction();

  try {
    const caller = req.user as IUser;
    const { orderId } = req.params;
    const { reason } = req.body as { reason?: string };

    if (typeof orderId !== "string" || !mongoose.Types.ObjectId.isValid(orderId)) {
      if (session) await session.abortTransaction();
      res.status(400).json({ success: false, message: "Invalid order ID." });
      return;
    }

    const query =
      caller.role === "admin"
        ? { _id: orderId }
        : { _id: orderId, userId: caller._id };

    const order = await Order.findOne(query).session(session);

    if (!order) {
      if (session) await session.abortTransaction();
      res.status(404).json({ success: false, message: "Order not found." });
      return;
    }

    if (!["pending", "confirmed"].includes(order.status)) {
      if (session) await session.abortTransaction();
      res.status(409).json({
        success: false,
        message: `Cannot cancel an order with status '${order.status}'.`,
      });
      return;
    }

    // Restore inventory for each item that had a listingId
    for (const item of order.items) {
      if (item.listingId) {
        await (ListingInventory as any).findOneAndUpdate(
          { listingId: item.listingId },
          { $inc: { availableQuantity: item.quantity } },
          { session } as any
        );
      }
    }

    // Reverse coupon usage if it was applied
    if (order.couponCode) {
      const usage = await CouponUsage.findOneAndDelete(
        { orderId: order._id },
        { session } as any
      );
      if (usage) {
        await Coupon.findOneAndUpdate(
          { code: order.couponCode },
          { $inc: { usedCount: -1 } },
          { session } as any
        );
      }
    }

    order.status = "cancelled";
    order.cancellationReason = reason ?? (caller.role === "admin" ? "Cancelled by admin" : "Cancelled by customer");

    await order.save({ session });
    if (session) await session.commitTransaction();

    dispatchWebhookEvent("order.cancelled", order.toObject(), order.userId);

    res.status(200).json({
      success: true,
      message: "Order cancelled successfully.",
      order,
    });
  } catch (error: unknown) {
    if (session) await session.abortTransaction();
    const message = error instanceof Error ? error.message : "Failed to cancel order.";
    console.error("Cancel order error:", error);
    res.status(500).json({ success: false, message });
  } finally {
    if (session) session.endSession();
  }
}

// ─── [GET] /api/orders/seller — Seller's Orders ───────────────────────────────

export async function getSellerOrders(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const { page, limit, skip } = parsePagination(req.query);

    const seller = await Seller.findOne({ userId: caller._id });
    if (!seller) {
      res.status(403).json({
        success: false,
        message: "No seller profile found for this account.",
      });
      return;
    }

    const filter = { "items.sellerId": seller._id };
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      orders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch seller orders.";
    console.error("Get seller orders error:", error);
    res.status(500).json({ success: false, message });
  }
}

// ─── [PATCH] /api/orders/:orderId/status — Update Order Status ───────────────

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  confirmed: ["processing"],
  processing: ["shipped"],
  shipped: ["delivered"],
  delivered: ["return_requested"],
  return_requested: ["returned"],
};

export async function updateOrderStatus(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const caller = req.user as IUser;
    const { orderId } = req.params;
    const { status } = req.body as { status: string };

    if (typeof orderId !== "string" || !mongoose.Types.ObjectId.isValid(orderId)) {
      res.status(400).json({ success: false, message: "Invalid order ID." });
      return;
    }

    const order = await Order.findById(orderId);
    if (!order) {
      res.status(404).json({ success: false, message: "Order not found." });
      return;
    }

    // Sellers may only update orders containing their items
    if (caller.role === "seller") {
      const seller = await Seller.findOne({ userId: caller._id });
      if (!seller) {
        res.status(403).json({
          success: false,
          message: "Seller profile not found.",
        });
        return;
      }

      const hasItem = order.items.some(
        (item) => item.sellerId.toString() === seller._id.toString()
      );
      if (!hasItem) {
        res.status(403).json({
          success: false,
          message: "You are not authorized to update this order.",
        });
        return;
      }
    }

    const allowed = VALID_STATUS_TRANSITIONS[order.status];
    if (!allowed || !allowed.includes(status)) {
      res.status(409).json({
        success: false,
        message: `Invalid status transition from '${order.status}' to '${status}'.`,
      });
      return;
    }

    order.status = status as IOrder["status"];
    await order.save();

    dispatchWebhookEvent("order.status_updated", order.toObject(), order.userId);

    res.status(200).json({
      success: true,
      message: `Order status updated to '${status}'.`,
      order,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update order status.";
    console.error("Update order status error:", error);
    res.status(500).json({ success: false, message });
  }
}

// ─── Re-export IOrder type for use in other modules ──────────────────────────
export type { IOrder };

// ─── [GET] /api/orders/all — Admin: All Orders with Filters ──────────────────

/**
 * [ADMIN] Returns all platform orders with optional filters.
 * Supports: ?status=, ?userId=, ?startDate=, ?endDate=, ?page=, ?limit=
 */
export async function getAllOrdersAdmin(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status, userId, startDate, endDate } = req.query;

    const filter: Record<string, unknown> = {};

    if (status) filter.status = status;
    if (userId && typeof userId === "string" && mongoose.Types.ObjectId.isValid(userId)) {
      filter.userId = new mongoose.Types.ObjectId(userId);
    }
    if (startDate || endDate) {
      const dateFilter: Record<string, Date> = {};
      if (startDate) dateFilter.$gte = new Date(startDate as string);
      if (endDate) dateFilter.$lte = new Date(endDate as string);
      filter.createdAt = dateFilter;
    }

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      orders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch all orders.";
    console.error("Get all orders (admin) error:", error);
    res.status(500).json({ success: false, message });
  }
}
