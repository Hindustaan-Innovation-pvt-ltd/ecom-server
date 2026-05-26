import mongoose, { Schema, type Document } from "mongoose";

export interface ICoupon extends Document {
  sellerId: mongoose.Types.ObjectId;
  code: string;
  discountType: "percent" | "flat";
  discountValue: number;
  minOrderValue: number;
  maxDiscountValue?: number;
  usageLimit: number;
  perUserLimit: number;
  usedCount: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  applicableProducts: mongoose.Types.ObjectId[];
  applicableCategories: mongoose.Types.ObjectId[];
  applicableListings: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const CouponSchema = new Schema<ICoupon>(
  {
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: [true, "Seller ID is required for a seller-created coupon"],
    },
    code: {
      type: String,
      required: [true, "Coupon code is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    discountType: {
      type: String,
      enum: {
        values: ["percent", "flat"],
        message: "discountType must be either percent or flat",
      },
      required: [true, "Discount type is required"],
    },
    discountValue: {
      type: Number,
      required: [true, "Discount value is required"],
      min: [0, "Discount value cannot be negative"],
    },
    minOrderValue: {
      type: Number,
      default: 0,
      min: [0, "Minimum order value cannot be negative"],
    },
    maxDiscountValue: {
      type: Number,
      min: [0, "Maximum discount value cannot be negative"],
    },
    usageLimit: {
      type: Number,
      required: [true, "Total usage limit is required"],
      min: [1, "Usage limit must be at least 1"],
    },
    perUserLimit: {
      type: Number,
      required: [true, "Per-user limit is required"],
      default: 1,
      min: [1, "Per-user limit must be at least 1"],
    },
    usedCount: {
      type: Number,
      default: 0,
      min: [0, "Used count cannot be negative"],
    },
    startsAt: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endsAt: {
      type: Date,
      required: [true, "End date is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    applicableProducts: {
      type: [Schema.Types.ObjectId],
      ref: "Product",
      default: [],
    },
    applicableCategories: {
      type: [Schema.Types.ObjectId],
      ref: "Category",
      default: [],
    },
    applicableListings: {
      type: [Schema.Types.ObjectId],
      ref: "SellerListing",
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
CouponSchema.index({ sellerId: 1 });
CouponSchema.index({ code: 1 }, { unique: true });

// Pre-validate hook: Uppercase code
CouponSchema.pre("validate", function () {
  if (this.code) {
    this.code = this.code.trim().toUpperCase();
  }
});

export const Coupon = mongoose.model<ICoupon>("Coupon", CouponSchema);
export default Coupon;
