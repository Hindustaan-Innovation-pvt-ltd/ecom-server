import mongoose, { Schema, Document } from "mongoose";

export interface IProductImage extends Document {
  catalogProductId: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId | null;
  type: "image" | "video";
  imageUrl: string;
  alt?: string;
  angle?: "front" | "back" | "side" | "top" | "isometric" | "detail" | "lifestyle" | "other" | null;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: Date;
}

const ProductImageSchema = new Schema<IProductImage>(
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
    type: {
      type: String,
      enum: ["image", "video"],
      default: "image",
    },
    imageUrl: {
      type: String,
      required: [true, "Image/Media URL is required"],
      trim: true,
    },
    alt: {
      type: String,
      default: "",
      trim: true,
    },
    angle: {
      type: String,
      enum: ["front", "back", "side", "top", "isometric", "detail", "lifestyle", "other", null],
      default: null,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // only track createdAt
  }
);

// Indexes
ProductImageSchema.index({ catalogProductId: 1 });
ProductImageSchema.index({ variantId: 1 });

export const ProductImage = mongoose.model<IProductImage>("ProductImage", ProductImageSchema);
export default ProductImage;
