import mongoose, { Schema, Document } from "mongoose";

export interface ISellerListing extends Document {
  sellerId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  sellerSku: string;
  condition: "new" | "refurbished";
  procurementType: "stock" | "dropship";
  fulfillmentType: "seller" | "platform";
  shippingProfileId?: mongoose.Types.ObjectId | null;
  status: "active" | "paused" | "blocked";
  createdAt: Date;
  updatedAt: Date;
}

const SellerListingSchema = new Schema<ISellerListing>(
  {
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: [true, "Seller ID is required"],
    },
    variantId: {
      type: Schema.Types.ObjectId,
      ref: "ProductVariant",
      required: [true, "Variant ID is required"],
    },
    sellerSku: {
      type: String,
      required: [true, "Seller SKU is required"],
      trim: true,
    },
    condition: {
      type: String,
      enum: ["new", "refurbished"],
      default: "new",
    },
    procurementType: {
      type: String,
      enum: ["stock", "dropship"],
      default: "stock",
    },
    fulfillmentType: {
      type: String,
      enum: ["seller", "platform"],
      default: "seller",
    },
    shippingProfileId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "paused", "blocked"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
SellerListingSchema.index({ sellerId: 1 });
SellerListingSchema.index({ variantId: 1 });
SellerListingSchema.index({ status: 1 });

export const SellerListing = mongoose.model<ISellerListing>("SellerListing", SellerListingSchema);
export default SellerListing;
