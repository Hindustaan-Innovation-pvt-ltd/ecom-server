import mongoose, { Schema, type Document } from "mongoose";
import { translationPlugin } from "../utils/translationPlugin.js";

export interface IReview extends Document {
  catalogProductId: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId | null;
  listingId?: mongoose.Types.ObjectId | null;
  userId: mongoose.Types.ObjectId;
  rating: number;
  title: string;
  comment: string;
  verifiedPurchase: boolean;
  helpfulVotes: number;
  status: "pending" | "approved" | "hidden";
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>(
  {
    catalogProductId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Catalog Product ID is required"],
    },
    variantId: {
      type: Schema.Types.ObjectId,
      ref: "ProductVariant",
      default: null,
    },
    listingId: {
      type: Schema.Types.ObjectId,
      ref: "SellerListing",
      default: null,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating cannot exceed 5"],
    },
    title: {
      type: String,
      required: [true, "Review title is required"],
      trim: true,
    },
    comment: {
      type: String,
      required: [true, "Review comment/body is required"],
      trim: true,
    },
    verifiedPurchase: {
      type: Boolean,
      default: false,
    },
    helpfulVotes: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "hidden"],
      default: "approved",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
ReviewSchema.index({ catalogProductId: 1 });
ReviewSchema.index({ userId: 1 });
ReviewSchema.index({ rating: 1 });
ReviewSchema.index({ catalogProductId: 1, status: 1, helpfulVotes: -1 });
ReviewSchema.index({ catalogProductId: 1, status: 1, rating: -1 });

ReviewSchema.plugin(translationPlugin);

export const Review = mongoose.model<IReview>("Review", ReviewSchema);
export default Review;
