import mongoose, { Schema, type Document } from "mongoose";

export interface IProductQuestion extends Document {
  catalogProductId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  question: string;
  status: "pending" | "approved" | "hidden";
  createdAt: Date;
  updatedAt: Date;
}

const ProductQuestionSchema = new Schema<IProductQuestion>(
  {
    catalogProductId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Catalog Product ID is required"],
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    question: {
      type: String,
      required: [true, "Question body is required"],
      trim: true,
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
ProductQuestionSchema.index({ catalogProductId: 1 });

export const ProductQuestion = mongoose.model<IProductQuestion>("ProductQuestion", ProductQuestionSchema);
export default ProductQuestion;
