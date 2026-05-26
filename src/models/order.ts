import mongoose, { Schema, type Document } from "mongoose";

// ─── Address Snapshot Subdocument ────────────────────────────────────────────

export interface IAddressSnapshot {
  fullName: string;
  phone: string;
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
}

const AddressSnapshotSchema = new Schema<IAddressSnapshot>(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    line2: { type: String, required: true },
    landmark: { type: String, default: "" },
    city: { type: String, required: true },
    state: { type: String, required: true },
    country: { type: String, required: true },
    pincode: { type: String, required: true },
  },
  { _id: false }
);

// ─── Order Item Subdocument ───────────────────────────────────────────────────

export interface IOrderItem {
  productId: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId | null;
  listingId?: mongoose.Types.ObjectId | null;
  sellerId: mongoose.Types.ObjectId;
  titleSnapshot: string;
  imageSnapshot?: string;
  sku?: string;
  quantity: number;
  mrpPaiseSnapshot: number;
  sellingPricePaiseSnapshot: number;
  couponDiscountPaiseForItem: number;
}

const OrderItemSchema = new Schema<IOrderItem>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product ID is required"],
    },
    variantId: {
      type: Schema.Types.ObjectId,
      ref: "ProductVariant",
      default: null,
    },
    listingId: {
      type: Schema.Types.ObjectId,
      ref: "SellerListing",
      default: null,
    },
    sellerId: {
      type: Schema.Types.ObjectId,
      ref: "Seller",
      required: [true, "Seller ID is required on each order item"],
    },
    titleSnapshot: {
      type: String,
      required: [true, "Title snapshot is required"],
      trim: true,
    },
    imageSnapshot: { type: String, default: "" },
    sku: { type: String, default: "" },
    quantity: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
    },
    mrpPaiseSnapshot: {
      type: Number,
      required: [true, "MRP snapshot is required"],
      min: [0, "MRP cannot be negative"],
    },
    sellingPricePaiseSnapshot: {
      type: Number,
      required: [true, "Selling price snapshot is required"],
      min: [0, "Selling price cannot be negative"],
    },
    couponDiscountPaiseForItem: {
      type: Number,
      default: 0,
      min: [0, "Item coupon discount cannot be negative"],
    },
  },
  { _id: false }
);

// ─── Order Document ───────────────────────────────────────────────────────────

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "return_requested"
  | "returned";

export type PaymentStatus =
  | "pending"
  | "paid"
  | "failed"
  | "refunded"
  | "partially_refunded";

export type PaymentMethod = "cod";

export interface IOrder extends Document {
  userId: mongoose.Types.ObjectId;
  addressId: mongoose.Types.ObjectId;
  addressSnapshot: IAddressSnapshot;
  items: IOrderItem[];

  // Coupon
  couponCode?: string | null;
  couponDiscountPaise: number;

  // Price breakdown (all in paise)
  mrpTotalPaise: number;         // Sum of mrpPaiseSnapshot × qty
  sellingTotalPaise: number;     // Sum of sellingPricePaiseSnapshot × qty
  productDiscountPaise: number;  // mrpTotal - sellingTotal (catalog/MRP discount)
  totalPaise: number;            // sellingTotal - couponDiscount (final charged amount)

  // Payment
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;

  // Order lifecycle
  status: OrderStatus;
  notes?: string | null;
  cancellationReason?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    addressId: {
      type: Schema.Types.ObjectId,
      ref: "Address",
      required: [true, "Address ID is required"],
    },
    addressSnapshot: {
      type: AddressSnapshotSchema,
      required: [true, "Address snapshot is required"],
    },
    items: {
      type: [OrderItemSchema],
      required: [true, "Order must contain at least one item"],
      validate: {
        validator: (items: IOrderItem[]) => items.length > 0,
        message: "Order must contain at least one item",
      },
    },

    // Coupon
    couponCode: { type: String, default: null, uppercase: true, trim: true },
    couponDiscountPaise: { type: Number, default: 0, min: [0, "Coupon discount cannot be negative"] },

    // Price breakdown
    mrpTotalPaise: { type: Number, required: true, min: [0, "MRP total cannot be negative"] },
    sellingTotalPaise: { type: Number, required: true, min: [0, "Selling total cannot be negative"] },
    productDiscountPaise: { type: Number, default: 0, min: [0, "Product discount cannot be negative"] },
    totalPaise: { type: Number, required: true, min: [0, "Order total cannot be negative"] },

    // Payment
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded", "partially_refunded"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      enum: ["cod"],
      required: [true, "Payment method is required"],
    },

    // Order lifecycle
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "return_requested",
        "returned",
      ],
      default: "pending",
    },
    notes: { type: String, default: null },
    cancellationReason: { type: String, default: null },
  },
  { timestamps: true }
);

// Indexes
OrderSchema.index({ userId: 1 });
OrderSchema.index({ status: 1 });
OrderSchema.index({ paymentStatus: 1 });
OrderSchema.index({ "items.sellerId": 1 });
OrderSchema.index({ couponCode: 1 }, { sparse: true });

export const Order = mongoose.model<IOrder>("Order", OrderSchema);
export default Order;
