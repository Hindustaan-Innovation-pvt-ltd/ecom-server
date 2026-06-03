import mongoose, { Schema, type Document } from "mongoose";
import { translationPlugin } from "../utils/translationPlugin.js";

export interface IProductAnswer extends Document {
  questionId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  answer: string;
  isSellerAnswer: boolean;
  helpfulVotes: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductAnswerSchema = new Schema<IProductAnswer>(
  {
    questionId: {
      type: Schema.Types.ObjectId,
      ref: "ProductQuestion",
      required: [true, "Question ID reference is required"],
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID reference is required"],
    },
    answer: {
      type: String,
      required: [true, "Answer body is required"],
      trim: true,
    },
    isSellerAnswer: {
      type: Boolean,
      default: false,
    },
    helpfulVotes: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
ProductAnswerSchema.index({ questionId: 1 });

ProductAnswerSchema.plugin(translationPlugin);

export const ProductAnswer = mongoose.model<IProductAnswer>("ProductAnswer", ProductAnswerSchema);
export default ProductAnswer;
