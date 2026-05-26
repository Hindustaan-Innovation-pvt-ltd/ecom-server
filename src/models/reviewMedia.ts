import mongoose, { Schema, type Document } from "mongoose";

export interface IReviewMedia extends Document {
  reviewId: mongoose.Types.ObjectId;
  type: "image" | "video";
  url: string;
  createdAt: Date;
}

const ReviewMediaSchema = new Schema<IReviewMedia>(
  {
    reviewId: {
      type: Schema.Types.ObjectId,
      ref: "Review",
      required: [true, "Review ID reference is required"],
    },
    type: {
      type: String,
      enum: ["image", "video"],
      default: "image",
    },
    url: {
      type: String,
      required: [true, "Media URL is required"],
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Indexes
ReviewMediaSchema.index({ reviewId: 1 });

export const ReviewMedia = mongoose.model<IReviewMedia>("ReviewMedia", ReviewMediaSchema);
export default ReviewMedia;
