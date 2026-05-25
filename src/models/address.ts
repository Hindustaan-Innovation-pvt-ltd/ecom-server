import mongoose, { Schema, Document } from "mongoose";

const INDIAN_STATES_AND_UTS = [
  // States
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
  // Union Territories
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"
];

export interface IAddress extends Document {
  userId: mongoose.Types.ObjectId;
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema<IAddress>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    fullName: {
      type: String,
      required: [true, "Recipient full name is required"],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, "Recipient phone number is required"],
      trim: true,
      // Validates Indian mobile number format
      match: [/^(?:\+91|0)?[6-9]\d{9}$/, "Please provide a valid 10-digit Indian phone number"],
    },
    line1: {
      type: String,
      required: [true, "Flat, House no., Building, Company, or Apartment is required"],
      trim: true,
    },
    line2: {
      type: String,
      required: [true, "Area, Street, Sector, or Village is required"],
      trim: true,
    },
    landmark: {
      type: String,
      required: [true, "Landmark (e.g. near hospital, school) is required for Indian deliveries"],
      trim: true,
    },
    city: {
      type: String,
      required: [true, "City or District is required"],
      trim: true,
    },
    state: {
      type: String,
      required: [true, "State or Union Territory is required"],
      trim: true,
      enum: {
        values: INDIAN_STATES_AND_UTS,
        message: "{VALUE} is not a valid Indian State or Union Territory",
      },
    },
    country: {
      type: String,
      required: [true, "Country is required"],
      default: "India",
      trim: true,
    },
    pincode: {
      type: String,
      required: [true, "6-digit Postal PIN code is required"],
      trim: true,
      // Validates 6-digit Indian PIN code format
      match: [/^[1-9][0-9]{5}$/, "Please provide a valid 6-digit Indian PIN code"],
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index
AddressSchema.index({ userId: 1 });

// Pre-save hook: Handle default address toggling logic
AddressSchema.pre("save", async function () {
  if (this.isDefault) {
    try {
      // Toggle off isDefault for all other addresses owned by this user
      await mongoose.model("Address").updateMany(
        { userId: this.userId, _id: { $ne: this._id } },
        { $set: { isDefault: false } }
      );
    } catch (err: any) {
      throw err;
    }
  }
});

export const Address = mongoose.model<IAddress>("Address", AddressSchema);
export default Address;
