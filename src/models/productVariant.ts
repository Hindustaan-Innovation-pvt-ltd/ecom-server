import mongoose, { Schema, type Document } from "mongoose";

export interface IProductVariant extends Document {
  catalogProductId: mongoose.Types.ObjectId;
  sku: string;
  variantAttributes: Record<string, string>;
  barcode?: string;
  weight?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProductVariantSchema = new Schema<IProductVariant>(
  {
    catalogProductId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Catalog Product ID is required"],
    },
    sku: {
      type: String,
      required: [true, "Variant SKU is required"],
      trim: true,
      unique: true,
    },
    variantAttributes: {
      type: Schema.Types.Mixed,
      required: [true, "Variant attributes are required"],
      default: {},
    },
    barcode: {
      type: String,
      default: "",
      trim: true,
    },
    weight: {
      type: Number,
      default: 0,
    },
    dimensions: {
      length: { type: Number, default: 0 },
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
ProductVariantSchema.index({ catalogProductId: 1 });

export const ProductVariant = mongoose.model<IProductVariant>("ProductVariant", ProductVariantSchema);
export default ProductVariant;
