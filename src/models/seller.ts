import mongoose, { Schema, type Document } from "mongoose";

export interface ISeller extends Document {
  userId: mongoose.Types.ObjectId;
  businessName: string;
  gstNumber: string;
  businessPhone: string;
  businessEmail: string;
  approvalStatus: "pending" | "approved" | "rejected";
  rejectionReason?: string;
  approvedBy?: mongoose.Types.ObjectId;
  approvedAt?: Date;
  ratingAverage: number;
  totalSales: number;
  createdAt: Date;
  updatedAt: Date;
}

const SellerSchema = new Schema<ISeller>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      unique: true,
    },
    businessName: {
      type: String,
      required: [true, "Business name is required"],
      trim: true,
    },
    gstNumber: {
      type: String,
      required: [true, "GST number is required"],
      unique: true,
      trim: true,
      // Standard GSTIN format validation (India)
      match: [/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, "Please provide a valid Indian GST number"],
    },
    businessPhone: {
      type: String,
      required: [true, "Business phone is required"],
      trim: true,
      match: [/^\+?[0-9\s-]{7,15}$/, "Please provide a valid business phone number"],
    },
    businessEmail: {
      type: String,
      required: [true, "Business email is required"],
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid business email address"],
    },
    approvalStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: {
      type: String,
      default: "",
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
    ratingAverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    totalSales: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
SellerSchema.index({ approvalStatus: 1 });

export const Seller = mongoose.model<ISeller>("Seller", SellerSchema);
export default Seller;
