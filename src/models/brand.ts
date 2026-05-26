import mongoose, { Schema, type Document } from "mongoose";

export interface IBrand extends Document {
  name: string;
  slug: string;
  logoUrl?: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BrandSchema = new Schema<IBrand>(
  {
    name: {
      type: String,
      required: [true, "Brand name is required"],
      trim: true,
    },
    slug: {
      type: String,
      required: [true, "Brand slug is required"],
      trim: true,
      unique: true,
      lowercase: true,
    },
    logoUrl: {
      type: String,
      default: "",
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
BrandSchema.index({ name: 1 });

export const Brand = mongoose.model<IBrand>("Brand", BrandSchema);
export default Brand;
