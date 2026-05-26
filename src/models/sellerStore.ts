import mongoose, { Schema, type Document } from "mongoose";

export interface ISellerStoreAddress {
  line1: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
}

export interface ISellerStoreLocation {
  type: "Point";
  coordinates: number[]; // [longitude, latitude]
}

export interface ISellerStore extends Document {
  sellerId: mongoose.Types.ObjectId;
  name: string;
  address: ISellerStoreAddress;
  location: ISellerStoreLocation;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SellerStoreSchema = new Schema<ISellerStore>(
  {
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: [true, "Seller ID reference is required"],
    },
    name: {
      type: String,
      required: [true, "Store/Warehouse name is required"],
      trim: true,
    },
    address: {
      line1: { type: String, required: true, trim: true },
      city: { type: String, required: true, trim: true },
      state: { type: String, required: true, trim: true },
      country: { type: String, required: true, trim: true },
      pincode: { type: String, required: true, trim: true },
    },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
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
SellerStoreSchema.index({ sellerId: 1 });
SellerStoreSchema.index({ location: "2dsphere" });

export const SellerStore = mongoose.model<ISellerStore>("SellerStore", SellerStoreSchema);
export default SellerStore;
