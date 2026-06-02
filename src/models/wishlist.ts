import mongoose, { Schema, type Document } from "mongoose";

export interface IWishlistItem {
	productId: mongoose.Types.ObjectId;
	createdAt: Date;
}

export interface IWishlist extends Document {
	userId: mongoose.Types.ObjectId;
	items: IWishlistItem[];
	createdAt: Date;
	updatedAt: Date;
}

const WishlistItemSchema = new Schema<IWishlistItem>({
	productId: {
		type: Schema.Types.ObjectId,
		ref: "Product",
		required: [true, "Product ID is required"],
	},
	createdAt: {
		type: Date,
		default: Date.now,
	},
});

const WishlistSchema = new Schema<IWishlist>(
	{
		userId: {
			type: Schema.Types.ObjectId,
			ref: "User",
			required: [true, "User ID is required"],
			unique: true,
		},
		items: {
			type: [WishlistItemSchema],
			default: [],
		},
	},
	{
		timestamps: true,
	}
);

// Add index on userId for fast lookups
WishlistSchema.index({ userId: 1 });

export const Wishlist = mongoose.model<IWishlist>("Wishlist", WishlistSchema);
export default Wishlist;
