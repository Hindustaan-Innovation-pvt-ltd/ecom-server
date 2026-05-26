import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Cart, type ICart } from "../models/cart.js";
import { Coupon } from "../models/coupon.js";
import type { IUser } from "../models/user.js";
import type { IProduct } from "../models/product.js";

/**
 * Helper to compute coupon discounts dynamically for a populated cart document.
 * Automatically validates expiration dates, global usage capacities, seller bounds,
 * minimum subtotals, and per-user limits.
 *
 * If a coupon is globally invalid (expired/depleted), it is automatically detached from the cart.
 */
async function computeCartCouponDiscount(
  cart: ICart,
  user: IUser
): Promise<{ discountPaise: number; appliedCoupon: Record<string, unknown> | null; warning?: string }> {
  if (!cart.couponCode) {
    return { discountPaise: 0, appliedCoupon: null };
  }

  const coupon = await Coupon.findOne({ code: cart.couponCode, isActive: true });
  if (!coupon) {
    // Automatically detach coupon since it is invalid or deleted
    cart.couponCode = null;
    await cart.save();
    return {
      discountPaise: 0,
      appliedCoupon: null,
      warning: "The applied coupon is invalid or has been deactivated.",
    };
  }

  const now = new Date();
  if (now < coupon.startsAt || now > coupon.endsAt) {
    cart.couponCode = null;
    await cart.save();
    return {
      discountPaise: 0,
      appliedCoupon: null,
      warning: "The applied coupon has expired or is not active yet.",
    };
  }

  if (coupon.usedCount >= coupon.usageLimit) {
    cart.couponCode = null;
    await cart.save();
    return {
      discountPaise: 0,
      appliedCoupon: null,
      warning: "The applied coupon has reached its maximum global usage capacity.",
    };
  }

  // Calculate cart subtotal specifically for this seller's products, scoped by targeted boundaries
  let sellerSubtotal = 0;
  for (const item of cart.items) {
    const product = item.productId as unknown as IProduct;
    if (product?.sellerId?.toString() === coupon.sellerId.toString()) {
      // 1. Product specific scoping check
      const matchesProduct = coupon.applicableProducts.length === 0 ||
        coupon.applicableProducts.some((pId: unknown) => String(pId) === String(product._id));

      // 2. Category specific scoping check
      const matchesCategory = coupon.applicableCategories.length === 0 ||
        coupon.applicableCategories.some((cId: unknown) => String(cId) === String(product.categoryId));

      // 3. Variant/Listing specific scoping check
      const itemVariantIdStr = item.variantId?.toString();
      const matchesListing = coupon.applicableListings.length === 0 ||
        (!!itemVariantIdStr && coupon.applicableListings.some((lId: unknown) => String(lId) === itemVariantIdStr));

      if (matchesProduct && matchesCategory && matchesListing) {
        sellerSubtotal += item.pricePaiseSnapshot * item.quantity;
      }
    }
  }

  if (sellerSubtotal === 0) {
    return {
      discountPaise: 0,
      appliedCoupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minOrderValue: coupon.minOrderValue,
        sellerId: coupon.sellerId,
      },
      warning: "This coupon is not valid for any products currently in your cart.",
    };
  }

  if (sellerSubtotal < coupon.minOrderValue) {
    return {
      discountPaise: 0,
      appliedCoupon: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minOrderValue: coupon.minOrderValue,
        sellerId: coupon.sellerId,
      },
      warning: `This coupon requires a minimum subtotal of INR ${(coupon.minOrderValue / 100).toFixed(2)} from this seller's products.`,
    };
  }

  // Enforce per-user usage limits check (best effort using orders if Order model exists)
  const OrderModel = mongoose.models.Order;
  if (OrderModel) {
    const count = await OrderModel.countDocuments({
      userId: user._id,
      couponCode: coupon.code,
      status: { $ne: "cancelled" },
    });
    if (count >= coupon.perUserLimit) {
      cart.couponCode = null;
      await cart.save();
      return {
        discountPaise: 0,
        appliedCoupon: null,
        warning: "You have already reached your allowed limit for this coupon.",
      };
    }
  }

  // Calculate discount
  let discountPaise = 0;
  if (coupon.discountType === "percent") {
    discountPaise = Math.floor((sellerSubtotal * coupon.discountValue) / 100);
    if (coupon.maxDiscountValue && discountPaise > coupon.maxDiscountValue) {
      discountPaise = coupon.maxDiscountValue;
    }
  } else if (coupon.discountType === "flat") {
    discountPaise = coupon.discountValue;
  }

  if (discountPaise > sellerSubtotal) {
    discountPaise = sellerSubtotal;
  }

  return {
    discountPaise,
    appliedCoupon: {
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      minOrderValue: coupon.minOrderValue,
      sellerId: coupon.sellerId,
    },
  };
}

/**
 * [READ] Fetch the active user's persisted shopping cart.
 * Automatically performs real-time coupon evaluation and discount calculations.
 */
export async function getCart(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;

    const cart = await Cart.findOne({ userId: caller._id }).populate({
      path: "items.productId",
      select: "title slug pricePaise comparePricePaise brand categoryId status moderationStatus sellerId",
    });

    if (!cart) {
      res.status(200).json({
        success: true,
        message: "No cart found. Returning empty cart.",
        cart: {
          userId: caller._id,
          items: [],
          couponCode: null,
        },
        discountPaise: 0,
        appliedCoupon: null,
      });
      return;
    }

    const check = await computeCartCouponDiscount(cart, caller);

    res.status(200).json({
      success: true,
      cart,
      discountPaise: check.discountPaise,
      appliedCoupon: check.appliedCoupon,
      warning: check.warning,
    });
  } catch (error: unknown) {
    console.error("Get cart error:", error);
    const message = error instanceof Error ? error.message : "Failed to retrieve cart details.";
    res.status(500).json({
      success: false,
      message,
    });
  }
}

/**
 * [SYNC] Replaces the database cart items with the frontend shopping cart state.
 * Triggers active coupon checks if one was previously applied.
 */
export async function syncCart(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      res.status(400).json({
        success: false,
        message: "Invalid payload. 'items' must be an array.",
      });
      return;
    }

    // Structure validation
    for (const item of items) {
      if (!item.productId || !item.quantity || !item.titleSnapshot || item.pricePaiseSnapshot === undefined) {
        res.status(400).json({
          success: false,
          message: "Each item must specify: productId, quantity, titleSnapshot, and pricePaiseSnapshot.",
        });
        return;
      }
      if (item.quantity < 1) {
        res.status(400).json({
          success: false,
          message: "Quantity for all items must be at least 1.",
        });
        return;
      }
    }

    // Update cart items
    const cart = await Cart.findOneAndUpdate(
      { userId: caller._id },
      { $set: { items } },
      { new: true, upsert: true, runValidators: true }
    ).populate({
      path: "items.productId",
      select: "title slug pricePaise comparePricePaise brand categoryId status moderationStatus sellerId",
    });

    const check = await computeCartCouponDiscount(cart, caller);

    res.status(200).json({
      success: true,
      message: "Cart synchronized successfully.",
      cart,
      discountPaise: check.discountPaise,
      appliedCoupon: check.appliedCoupon,
      warning: check.warning,
    });
  } catch (error: unknown) {
    console.error("Sync cart error:", error);
    const message = error instanceof Error ? error.message : "Failed to synchronize cart.";
    res.status(400).json({
      success: false,
      message,
    });
  }
}

/**
 * [APPLY COUPON] Attaches a seller promotional coupon to the cart.
 */
export async function applyCartCoupon(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const { code } = req.body;

    if (!code) {
      res.status(400).json({
        success: false,
        message: "Coupon code is required.",
      });
      return;
    }

    const normalizedCode = code.trim().toUpperCase();

    // 1. Fetch active cart
    const cart = await Cart.findOne({ userId: caller._id }).populate({
      path: "items.productId",
      select: "title slug pricePaise comparePricePaise brand categoryId status moderationStatus sellerId",
    });

    if (!cart || cart.items.length === 0) {
      res.status(400).json({
        success: false,
        message: "Cannot apply coupon to an empty cart.",
      });
      return;
    }

    // 2. Fetch the active coupon
    const coupon = await Coupon.findOne({ code: normalizedCode, isActive: true });
    if (!coupon) {
      res.status(400).json({
        success: false,
        message: "Invalid or inactive coupon code.",
      });
      return;
    }

    // 3. Date check
    const now = new Date();
    if (now < coupon.startsAt || now > coupon.endsAt) {
      res.status(400).json({
        success: false,
        message: "This coupon is either not active yet or has expired.",
      });
      return;
    }

    // 4. Global capacity check
    if (coupon.usedCount >= coupon.usageLimit) {
      res.status(400).json({
        success: false,
        message: "This coupon has reached its maximum global usage capacity.",
      });
      return;
    }

    // 5. Match items specifically from the coupon's creator seller, applying target boundary filters
    let sellerSubtotal = 0;
    for (const item of cart.items) {
      const product = item.productId as unknown as IProduct;
      if (product?.sellerId?.toString() === coupon.sellerId.toString()) {
        const matchesProduct = coupon.applicableProducts.length === 0 ||
          coupon.applicableProducts.some((pId: unknown) => String(pId) === String(product._id));

        const matchesCategory = coupon.applicableCategories.length === 0 ||
          coupon.applicableCategories.some((cId: unknown) => String(cId) === String(product.categoryId));

        const itemVariantIdStr = item.variantId?.toString();
        const matchesListing = coupon.applicableListings.length === 0 ||
          (!!itemVariantIdStr && coupon.applicableListings.some((lId: unknown) => String(lId) === itemVariantIdStr));

        if (matchesProduct && matchesCategory && matchesListing) {
          sellerSubtotal += item.pricePaiseSnapshot * item.quantity;
        }
      }
    }

    if (sellerSubtotal === 0) {
      res.status(400).json({
        success: false,
        message: "This coupon is not valid for any products currently in your cart.",
      });
      return;
    }

    // 6. Minimum subtotal check
    if (sellerSubtotal < coupon.minOrderValue) {
      res.status(400).json({
        success: false,
        message: `This coupon requires a minimum subtotal of INR ${(coupon.minOrderValue / 100).toFixed(2)} from this seller's products.`,
      });
      return;
    }

    // 7. Per-user usage limit check
    const OrderModel = mongoose.models.Order;
    if (OrderModel) {
      const count = await OrderModel.countDocuments({
        userId: caller._id,
        couponCode: normalizedCode,
        status: { $ne: "cancelled" },
      });
      if (count >= coupon.perUserLimit) {
        res.status(400).json({
          success: false,
          message: "You have already reached the maximum usage limit for this coupon.",
        });
        return;
      }
    }

    // Attach coupon code and save
    cart.couponCode = normalizedCode;
    await cart.save();

    // Re-run computation to get discount
    const check = await computeCartCouponDiscount(cart, caller);

    res.status(200).json({
      success: true,
      message: "Coupon applied successfully to your cart.",
      cart,
      discountPaise: check.discountPaise,
      appliedCoupon: check.appliedCoupon,
    });
  } catch (error: unknown) {
    console.error("Apply cart coupon error:", error);
    const message = error instanceof Error ? error.message : "Failed to apply coupon to cart.";
    res.status(500).json({
      success: false,
      message,
    });
  }
}

/**
 * [REMOVE COUPON] Detaches any active coupon from the cart.
 */
export async function removeCartCoupon(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;

    const cart = await Cart.findOneAndUpdate(
      { userId: caller._id },
      { $set: { couponCode: null } },
      { new: true }
    ).populate({
      path: "items.productId",
      select: "title slug pricePaise comparePricePaise brand categoryId status moderationStatus sellerId",
    });

    res.status(200).json({
      success: true,
      message: "Coupon removed successfully.",
      cart,
      discountPaise: 0,
      appliedCoupon: null,
    });
  } catch (error: unknown) {
    console.error("Remove cart coupon error:", error);
    const message = error instanceof Error ? error.message : "Failed to remove coupon.";
    res.status(500).json({
      success: false,
      message,
    });
  }
}

/**
 * [DELETE] Clears all items and detaches coupons in the user's cart.
 */
export async function clearCart(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;

    const cart = await Cart.findOneAndUpdate(
      { userId: caller._id },
      { $set: { items: [], couponCode: null } },
      { new: true, upsert: true }
    );

    res.status(200).json({
      success: true,
      message: "Cart cleared successfully.",
      cart,
    });
  } catch (error: unknown) {
    console.error("Clear cart error:", error);
    const message = error instanceof Error ? error.message : "Failed to clear cart.";
    res.status(500).json({
      success: false,
      message,
    });
  }
}
