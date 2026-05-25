import mongoose, { Schema, Document } from "mongoose";

export interface IProductVariant extends Document {
  productId: mongoose.Types.ObjectId;
  option1: string; // size
  option2?: string; // color
  option3?: string; // material/style
  pricePaise: number; // INR prices stored in Paise to avoid float issues
  inventory: number;
  sku: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProductVariantSchema = new Schema<IProductVariant>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product ID is required"],
    },
    option1: {
      type: String,
      required: [true, "Option 1 (e.g. Size, Weight, or Volume) is required"],
      trim: true,
    },
    option2: {
      type: String,
      default: "",
      trim: true,
    },
    option3: {
      type: String,
      default: "",
      trim: true,
    },
    pricePaise: {
      type: Number,
      required: [true, "Variant price in Paise is required"],
      min: [0, "Variant price cannot be negative"],
    },
    inventory: {
      type: Number,
      required: [true, "Variant inventory is required"],
      min: [0, "Variant inventory cannot be negative"],
      default: 0,
    },
    sku: {
      type: String,
      required: [true, "Variant SKU is required"],
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
ProductVariantSchema.index({ productId: 1 });
ProductVariantSchema.index({ sku: 1 });

export const ProductVariant = mongoose.model<IProductVariant>("ProductVariant", ProductVariantSchema);
export default ProductVariant;
