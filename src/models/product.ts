import mongoose, { Schema } from "mongoose";

export interface IProduct extends mongoose.Document {
  categoryId: mongoose.Types.ObjectId;
  brandId: mongoose.Types.ObjectId;
  sellerId?: mongoose.Types.ObjectId | null; // Compatibility: seller who created the catalog entry
  title: string;
  slug: string;
  description: {
    short?: string;
    long?: any;
  };
  shortDescription?: string;
  longDescription?: any;
  highlights: string[];
  searchKeywords: string[];
  attributeValues: Record<string, unknown>;
  specifications?: any;
  richDescription?: any;
  seo?: {
    metaTitle?: string;
    metaDescription?: string;
    canonicalUrl?: string;
  };
  defaultVariantId?: mongoose.Types.ObjectId | null;
  status: "draft" | "active" | "blocked";
  moderationStatus: "pending" | "approved" | "hidden" | "removed"; // Compatibility with existing admin approval pipelines
  moderationReason?: string;
  moderatedBy?: mongoose.Types.ObjectId;
  ratingAverage: number;
  reviewCount: number;
  createdBy?: mongoose.Types.ObjectId;
  approvedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category ID is required"],
    },
    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: [true, "Brand ID is required"],
    },
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      default: null,
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
      short: { type: String, default: "" },
      long: { type: Schema.Types.Mixed, default: "" },
    },
    shortDescription: {
      type: String,
      default: "",
      trim: true,
    },
    longDescription: {
      type: Schema.Types.Mixed,
      default: "",
    },
    highlights: {
      type: [String],
      default: [],
    },
    searchKeywords: {
      type: [String],
      default: [],
    },
    attributeValues: {
      type: Schema.Types.Mixed,
      default: {},
    },
    specifications: {
      type: Schema.Types.Mixed,
      default: {},
    },
    richDescription: {
      type: Schema.Types.Mixed,
      default: "",
    },
    seo: {
      metaTitle: { type: String, default: "" },
      metaDescription: { type: String, default: "" },
      canonicalUrl: { type: String, default: "" },
    },
    defaultVariantId: {
      type: Schema.Types.ObjectId,
      ref: "ProductVariant",
      default: null,
    },
    status: {
      type: String,
      enum: ["draft", "active", "blocked"],
      default: "active",
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
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

// Primary hot query: getAllProducts always filters on { status, moderationStatus }
ProductSchema.index({ status: 1, moderationStatus: 1 });

// Secondary filters after the primary filter
ProductSchema.index({ status: 1, moderationStatus: 1, categoryId: 1 });
ProductSchema.index({ status: 1, moderationStatus: 1, brandId: 1 });
ProductSchema.index({ status: 1, moderationStatus: 1, searchKeywords: 1 });

// Slug lookup (unique already provides an index, this makes intent explicit)
ProductSchema.index({ slug: 1 });

// Full-text search index across title, description and keywords
ProductSchema.index(
  { title: "text", shortDescription: "text", searchKeywords: "text" },
  { name: "product_text_search", weights: { title: 10, searchKeywords: 5, shortDescription: 1 } }
);

// Helper to generate URL-friendly slug
function slugifyText(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")          // Replace spaces with -
    .replace(/[^\w-]+/g, "")       // Remove all non-word chars
    .replace(/--+/g, "-")         // Replace multiple - with single -
    .replace(/^-+/, "")             // Trim - from start of text
    .replace(/-+$/, "");            // Trim - from end of text
}

// Pre-validate hook: Auto generate slug from title before Mongoose validation
ProductSchema.pre("validate", function (this: IProduct) {
  if (this.title && !this.slug) {
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    this.slug = `${slugifyText(this.title)}-${randomSuffix}`;
  }
});

export const Product = mongoose.model<IProduct>("Product", ProductSchema);
export default Product;
