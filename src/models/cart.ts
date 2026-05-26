import mongoose, { Schema, type Document } from "mongoose";

export interface ICartItem {
  productId: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId | null;
  quantity: number;
  titleSnapshot: string;
  imageSnapshot?: string;
  pricePaiseSnapshot: number;
}

export interface ICart extends Document {
  userId: mongoose.Types.ObjectId;
  items: ICartItem[];
  couponCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const CartItemSchema = new Schema<ICartItem>({
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
  quantity: {
    type: Number,
    required: [true, "Quantity is required"],
    min: [1, "Quantity must be at least 1"],
  },
  titleSnapshot: {
    type: String,
    required: [true, "Title snapshot is required"],
    trim: true,
  },
  imageSnapshot: {
    type: String,
    default: "",
  },
  pricePaiseSnapshot: {
    type: Number,
    required: [true, "Price snapshot is required"],
    min: [0, "Price snapshot cannot be negative"],
  },
});

const CartSchema = new Schema<ICart>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      unique: true,
    },
    items: {
      type: [CartItemSchema],
      default: [],
    },
    couponCode: {
      type: String,
      default: null,
      uppercase: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

CartSchema.index({ userId: 1 }, { unique: true });

export const Cart = mongoose.model<ICart>("Cart", CartSchema);
export default Cart;
