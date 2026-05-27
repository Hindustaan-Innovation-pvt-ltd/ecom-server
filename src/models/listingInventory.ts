import mongoose, { Schema } from "mongoose";

export interface IListingInventory extends mongoose.Document {
  listingId: mongoose.Types.ObjectId;
  storeId?: mongoose.Types.ObjectId | null;
  availableQuantity: number;
  reservedQuantity: number;
  damagedQuantity: number;
  lowStockThreshold: number;
  createdAt: Date;
  updatedAt: Date;
}

const ListingInventorySchema = new Schema<IListingInventory>(
  {
    listingId: {
      type: Schema.Types.ObjectId,
      ref: "SellerListing",
      required: [true, "Listing ID is required"],
    },
    storeId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    availableQuantity: {
      type: Number,
      required: [true, "Available quantity is required"],
      min: [0, "Quantity cannot be negative"],
      default: 0,
    },
    reservedQuantity: {
      type: Number,
      min: [0, "Reserved quantity cannot be negative"],
      default: 0,
    },
    damagedQuantity: {
      type: Number,
      min: [0, "Damaged quantity cannot be negative"],
      default: 0,
    },
    lowStockThreshold: {
      type: Number,
      min: [0, "Low stock threshold cannot be negative"],
      default: 5,
    },
  },
  {
    timestamps: true,
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

// Covers: find inventory by listingId + project availableQuantity (most common use)
ListingInventorySchema.index({ listingId: 1, availableQuantity: 1 });

export const ListingInventory = mongoose.model<IListingInventory>("ListingInventory", ListingInventorySchema);
export default ListingInventory;
