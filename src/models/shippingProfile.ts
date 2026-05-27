import mongoose, { Schema, type Document } from "mongoose";

export interface IShippingProfile extends Document {
  sellerId: mongoose.Types.ObjectId;
  name: string;
  processingDays: number;
  shippingType: "free" | "paid";
  baseChargePaise: number;
  codAvailable: boolean;
  freeShippingAbove?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const ShippingProfileSchema = new Schema<IShippingProfile>(
  {
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: [true, "Seller ID is required"],
    },
    name: {
      type: String,
      required: [true, "Shipping profile name is required"],
      trim: true,
    },
    processingDays: {
      type: Number,
      required: [true, "Estimated processing/handling days is required"],
      min: [0, "Processing days cannot be negative"],
    },
    shippingType: {
      type: String,
      enum: ["free", "paid"],
      default: "free",
    },
    baseChargePaise: {
      type: Number,
      default: 0,
      min: [0, "Shipping charges cannot be negative"],
    },
    codAvailable: {
      type: Boolean,
      default: true,
    },
    freeShippingAbove: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
ShippingProfileSchema.index({ sellerId: 1 });

export const ShippingProfile = mongoose.model<IShippingProfile>("ShippingProfile", ShippingProfileSchema);
export default ShippingProfile;
