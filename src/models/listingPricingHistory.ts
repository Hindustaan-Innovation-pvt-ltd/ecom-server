import mongoose, { Schema, type Document } from "mongoose";

export interface IListingPricingHistory extends Document {
  listingId: mongoose.Types.ObjectId;
  mrpPaise: number;
  sellingPricePaise: number;
  discountPercentage?: number;
  startAt: Date;
  endAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ListingPricingHistorySchema = new Schema<IListingPricingHistory>(
  {
    listingId: {
      type: Schema.Types.ObjectId,
      ref: "SellerListing",
      required: [true, "Listing ID is required"],
    },
    mrpPaise: {
      type: Number,
      required: [true, "MRP in Paise is required"],
      min: [0, "MRP cannot be negative"],
    },
    sellingPricePaise: {
      type: Number,
      required: [true, "Selling price in Paise is required"],
      min: [0, "Selling price cannot be negative"],
    },
    discountPercentage: {
      type: Number,
      min: [0, "Discount percentage cannot be negative"],
      max: [100, "Discount percentage cannot exceed 100"],
    },
    startAt: {
      type: Date,
      default: Date.now,
    },
    endAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook to calculate discount percentage based on mrp and selling price
ListingPricingHistorySchema.pre("save", function (this: IListingPricingHistory) {
  if (this.mrpPaise > 0 && this.sellingPricePaise !== undefined) {
    const rawDiscount = ((this.mrpPaise - this.sellingPricePaise) / this.mrpPaise) * 100;
    this.discountPercentage = Math.max(0, Math.min(100, Math.round(rawDiscount)));
  } else {
    this.discountPercentage = 0;
  }
});

// ── Indexes ───────────────────────────────────────────────────────────────────

// Compound: listingId + createdAt DESC covers the `.sort({ createdAt: -1 })` without in-memory sort
ListingPricingHistorySchema.index({ listingId: 1, createdAt: -1 });

export const ListingPricingHistory = mongoose.model<IListingPricingHistory>("ListingPricingHistory", ListingPricingHistorySchema);
export default ListingPricingHistory;
