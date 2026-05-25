import mongoose, { Schema, Document } from "mongoose";

export interface IProductImage extends Document {
  productId: mongoose.Types.ObjectId;
  imageUrl: string;
  sortOrder: number;
  createdAt: Date;
}

const ProductImageSchema = new Schema<IProductImage>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product ID is required"],
    },
    imageUrl: {
      type: String,
      required: [true, "Image URL is required"],
      trim: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // only track createdAt
  }
);

// Indexes
ProductImageSchema.index({ productId: 1 });

export const ProductImage = mongoose.model<IProductImage>("ProductImage", ProductImageSchema);
export default ProductImage;
