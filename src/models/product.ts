import mongoose, { Schema, Document } from "mongoose";

export interface IProduct extends Document {
  sellerId: mongoose.Types.ObjectId;
  categoryId: mongoose.Types.ObjectId;
  title: string;
  slug: string;
  description: string;
  brand: string;
  sku: string;
  pricePaise: number; // INR prices stored in Paise to avoid float issues
  comparePricePaise?: number; // Paise
  inventory: number;
  tags: string[];
  isActive: boolean;
  moderationStatus: "pending" | "approved" | "hidden" | "removed";
  moderationReason?: string;
  moderatedBy?: mongoose.Types.ObjectId;
  ratingAverage: number;
  reviewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: [true, "Seller ID is required"],
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category ID is required"],
    },
    title: {
      type: String,
      required: [true, "Product title is required"],
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Product description is required"],
      trim: true,
    },
    brand: {
      type: String,
      required: [true, "Brand name is required"],
      trim: true,
    },
    sku: {
      type: String,
      required: [true, "Product SKU is required"],
      trim: true,
    },
    pricePaise: {
      type: Number,
      required: [true, "Product price in Paise is required"],
      min: [0, "Price cannot be negative"],
    },
    comparePricePaise: {
      type: Number,
      min: [0, "Compare price cannot be negative"],
    },
    inventory: {
      type: Number,
      required: [true, "Inventory count is required"],
      min: [0, "Inventory cannot be negative"],
      default: 0,
    },
    tags: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    moderationStatus: {
      type: String,
      enum: ["pending", "approved", "hidden", "removed"],
      default: "pending",
    },
    moderationReason: {
      type: String,
      default: "",
    },
    moderatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    ratingAverage: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewCount: {
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
ProductSchema.index({ sellerId: 1 });
ProductSchema.index({ categoryId: 1 });
ProductSchema.index({ moderationStatus: 1 });
ProductSchema.index({ tags: 1 });

// Helper to generate URL-friendly slug
function slugifyText(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")          // Replace spaces with -
    .replace(/[^\w\-]+/g, "")       // Remove all non-word chars
    .replace(/\-\-+/g, "-")         // Replace multiple - with single -
    .replace(/^-+/, "")             // Trim - from start of text
    .replace(/-+$/, "");            // Trim - from end of text
}

// Pre-validate hook: Auto generate slug from title before Mongoose validation
ProductSchema.pre("validate", function (this: any) {
  if (this.title && !this.slug) {
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    this.slug = `${slugifyText(this.title)}-${randomSuffix}`;
  }
});

export const Product = mongoose.model<IProduct>("Product", ProductSchema);
export default Product;
