import mongoose, { Schema, type Document } from "mongoose";

export interface ICouponUsage extends Document {
  couponId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  discountPaise: number;
  usedAt: Date;
}

const CouponUsageSchema = new Schema<ICouponUsage>(
  {
    couponId: {
      type: Schema.Types.ObjectId,
      ref: "Coupon",
      required: [true, "Coupon ID is required"],
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: [true, "Order ID is required"],
    },
    discountPaise: {
      type: Number,
      required: [true, "Discount paise is required"],
      min: [0, "Discount cannot be negative"],
    },
    usedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false, // Writable-only ledger entries
  }
);

// Compound index to instantly check per-user limits and enforce race-condition locks
CouponUsageSchema.index({ couponId: 1, userId: 1 });
CouponUsageSchema.index({ orderId: 1 });

export const CouponUsage = mongoose.model<ICouponUsage>("CouponUsage", CouponUsageSchema);
export default CouponUsage;
