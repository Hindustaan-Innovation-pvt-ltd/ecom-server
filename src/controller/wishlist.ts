import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Wishlist } from "../models/wishlist.js";
import { Product } from "../models/product.js";
import type { IUser } from "../models/user.js";

/**
 * [READ] Fetch the active user's wishlist.
 * Automatically populates the product details.
 */
export async function getWishlist(req: Request, res: Response): Promise<void> {
	try {
		const caller = req.user as IUser;

		let wishlist = await Wishlist.findOne({ userId: caller._id }).populate({
			path: "items.productId",
			select: "title slug pricePaise comparePricePaise brandId categoryId status moderationStatus ratingAverage reviewCount",
		});

		if (!wishlist) {
			wishlist = new Wishlist({
				userId: caller._id,
				items: [],
			});
		}

		res.status(200).json({
			success: true,
			wishlist,
		});
	} catch (error: unknown) {
		console.error("Get wishlist error:", error);
		const message = error instanceof Error ? error.message : "Failed to retrieve wishlist.";
		res.status(500).json({ success: false, message });
	}
}

/**
 * [ADD] Add a product to the active user's wishlist.
 */
export async function addItemToWishlist(req: Request, res: Response): Promise<void> {
	try {
		const caller = req.user as IUser;
		const { productId } = req.body;

		if (!productId) {
			res.status(400).json({ success: false, message: "Product ID is required." });
			return;
		}

		if (!mongoose.Types.ObjectId.isValid(productId)) {
			res.status(400).json({ success: false, message: "Invalid Product ID format." });
			return;
		}

		// Verify product exists and is active/approved
		const product = await Product.findById(productId);
		if (!product) {
			res.status(404).json({ success: false, message: "Product not found." });
			return;
		}

		let wishlist = await Wishlist.findOne({ userId: caller._id });
		if (!wishlist) {
			wishlist = new Wishlist({
				userId: caller._id,
				items: [],
			});
		}

		// Check if product is already in the wishlist
		const isAlreadyAdded = wishlist.items.some(
			(item) => item.productId.toString() === productId.toString()
		);

		if (isAlreadyAdded) {
			res.status(200).json({
				success: true,
				message: "Product is already in your wishlist.",
				wishlist,
			});
			return;
		}

		wishlist.items.push({
			productId: new mongoose.Types.ObjectId(productId),
			createdAt: new Date(),
		});

		await wishlist.save();

		// Populate for response
		await wishlist.populate({
			path: "items.productId",
			select: "title slug pricePaise comparePricePaise brandId categoryId status moderationStatus ratingAverage reviewCount",
		});

		res.status(200).json({
			success: true,
			message: "Product added to wishlist.",
			wishlist,
		});
	} catch (error: unknown) {
		console.error("Add item to wishlist error:", error);
		const message = error instanceof Error ? error.message : "Failed to add product to wishlist.";
		res.status(400).json({ success: false, message });
	}
}

/**
 * [REMOVE] Remove a product from the active user's wishlist.
 */
export async function removeItemFromWishlist(req: Request, res: Response): Promise<void> {
	try {
		const caller = req.user as IUser;
		const { productId } = req.params;

		if (!productId) {
			res.status(400).json({ success: false, message: "Product ID is required." });
			return;
		}

		const wishlist = await Wishlist.findOne({ userId: caller._id });
		if (!wishlist) {
			res.status(404).json({ success: false, message: "Wishlist not found." });
			return;
		}

		const initialItemCount = wishlist.items.length;
		wishlist.items = wishlist.items.filter(
			(item) => item.productId.toString() !== productId.toString()
		);

		if (wishlist.items.length === initialItemCount) {
			res.status(404).json({ success: false, message: "Product not found in wishlist." });
			return;
		}

		await wishlist.save();

		await wishlist.populate({
			path: "items.productId",
			select: "title slug pricePaise comparePricePaise brandId categoryId status moderationStatus ratingAverage reviewCount",
		});

		res.status(200).json({
			success: true,
			message: "Product removed from wishlist.",
			wishlist,
		});
	} catch (error: unknown) {
		console.error("Remove item from wishlist error:", error);
		const message = error instanceof Error ? error.message : "Failed to remove product from wishlist.";
		res.status(400).json({ success: false, message });
	}
}

/**
 * [DELETE] Clear the entire wishlist.
 */
export async function clearWishlist(req: Request, res: Response): Promise<void> {
	try {
		const caller = req.user as IUser;

		const wishlist = await Wishlist.findOneAndUpdate(
			{ userId: caller._id },
			{ $set: { items: [] } },
			{ new: true, upsert: true }
		);

		res.status(200).json({
			success: true,
			message: "Wishlist cleared successfully.",
			wishlist,
		});
	} catch (error: unknown) {
		console.error("Clear wishlist error:", error);
		const message = error instanceof Error ? error.message : "Failed to clear wishlist.";
		res.status(500).json({ success: false, message });
	}
}
