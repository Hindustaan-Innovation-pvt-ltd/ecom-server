import type { Request, Response } from "express";
import { Product } from "../models/product.js";
import { ProductVariant } from "../models/productVariant.js";
import { SellerListing } from "../models/sellerListing.js";
import { ListingInventory } from "../models/listingInventory.js";
import { ListingPricingHistory } from "../models/listingPricingHistory.js";
import type { IUser } from "../models/user.js";
import { deleteCache } from "../utils/redis.js";

export async function createProductVariant(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string; // Product ID
    const seller = req.seller;
    const { option1, option2, option3, pricePaise, inventory, sku } = req.body;

    if (!seller) {
      res.status(403).json({ success: false, message: "Forbidden." });
      return;
    }

    if (!option1 || !pricePaise || !sku) {
      res.status(400).json({ success: false, message: "Required fields: option1, pricePaise, and sku." });
      return;
    }

    const product = await Product.findById(id);
    if (!product) {
      res.status(404).json({ success: false, message: "Product not found." });
      return;
    }

    // Verify ownership of catalog product
    const caller = req.user as IUser | undefined;
    if (
      product.sellerId?.toString() !== seller._id.toString() &&
      product.createdBy?.toString() !== caller?._id?.toString()
    ) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this product." });
      return;
    }

    // Verify unique variant SKU
    const existingSku = await ProductVariant.findOne({ sku });
    if (existingSku) {
      res.status(400).json({ success: false, message: "A variant with this SKU already exists." });
      return;
    }

    const variant = new ProductVariant({
      catalogProductId: id,
      sku: sku.trim(),
      variantAttributes: {
        option1,
        ...(option2 ? { option2 } : {}),
        ...(option3 ? { option3 } : {}),
      },
      isActive: true,
    });

    await variant.save();

    // Automatically provision Seller Listing, Pricing, and Inventory
    const listing = new SellerListing({
      sellerId: seller._id,
      variantId: variant._id,
      sellerSku: sku.trim(),
      condition: "new",
      status: "active",
    });
    await listing.save();

    const listingInventory = new ListingInventory({
      listingId: listing._id,
      availableQuantity: inventory || 0,
    });
    await listingInventory.save();

    const listingPricing = new ListingPricingHistory({
      listingId: listing._id,
      mrpPaise: pricePaise,
      sellingPricePaise: pricePaise,
      startAt: new Date(),
    });
    await listingPricing.save();

    // Invalidate product details cache
    await deleteCache(`product:slug:${product.slug}`);

    // Attach pricing and inventory for legacy compatibility return
    const variantResult = variant.toObject() as unknown as Record<string, unknown>;
    variantResult.pricePaise = pricePaise;
    variantResult.inventory = inventory || 0;
    variantResult.option1 = option1;
    variantResult.option2 = option2 || "";
    variantResult.option3 = option3 || "";

    res.status(201).json({
      success: true,
      message: "Product variant created successfully.",
      variant: variantResult,
    });
  } catch (error: unknown) {
    console.error("Create variant error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create variant.";
    res.status(400).json({ success: false, message: errorMessage });
  }
}

export async function updateProductVariant(req: Request, res: Response): Promise<void> {
  try {
    const variantId = req.params.variantId as string;
    const seller = req.seller;
    const { option1, option2, option3, pricePaise, inventory, sku } = req.body;

    if (!seller) {
      res.status(403).json({ success: false, message: "Forbidden." });
      return;
    }

    const variant = await ProductVariant.findById(variantId);
    if (!variant) {
      res.status(404).json({ success: false, message: "Product variant not found." });
      return;
    }

    // Verify product ownership
    const product = await Product.findById(variant.catalogProductId);
    const caller = req.user as IUser | undefined;
    if (
      !product ||
      (product.sellerId?.toString() !== seller._id.toString() &&
        product.createdBy?.toString() !== caller?._id?.toString())
    ) {
      res.status(403).json({ success: false, message: "Forbidden. Access denied." });
      return;
    }

    if (option1 || option2 !== undefined || option3 !== undefined) {
      const nextAttributes = { ...variant.variantAttributes };
      if (option1) nextAttributes.option1 = option1;
      if (option2 !== undefined) nextAttributes.option2 = option2;
      if (option3 !== undefined) nextAttributes.option3 = option3;
      variant.variantAttributes = nextAttributes;
      variant.markModified("variantAttributes");
    }

    if (sku && sku !== variant.sku) {
      const existingSku = await ProductVariant.findOne({ sku });
      if (existingSku) {
        res.status(400).json({ success: false, message: "A variant with this SKU is already registered." });
        return;
      }
      variant.sku = sku;
    }

    await variant.save();

    // Resolve or create seller listing to update pricing and inventory
    let listing = await SellerListing.findOne({ sellerId: seller._id, variantId: variant._id });
    if (!listing) {
      listing = new SellerListing({
        sellerId: seller._id,
        variantId: variant._id,
        sellerSku: sku || variant.sku,
        condition: "new",
        status: "active",
      });
      await listing.save();
    }

    if (inventory !== undefined) {
      let inv = await ListingInventory.findOne({ listingId: listing._id });
      if (!inv) inv = new ListingInventory({ listingId: listing._id });
      inv.availableQuantity = inventory;
      await inv.save();
    }

    let finalPrice = pricePaise;
    if (pricePaise !== undefined) {
      const pricing = new ListingPricingHistory({
        listingId: listing._id,
        mrpPaise: pricePaise,
        sellingPricePaise: pricePaise,
        startAt: new Date(),
      });
      await pricing.save();
      finalPrice = pricing.sellingPricePaise;
    } else {
      const latestPricing = await ListingPricingHistory.findOne({ listingId: listing._id }).sort({ createdAt: -1 });
      finalPrice = latestPricing ? latestPricing.sellingPricePaise : 0;
    }

    // Invalidate product details cache
    if (product) {
      await deleteCache(`product:slug:${product.slug}`);
    }

    // Read latest inventory
    const activeInv = await ListingInventory.findOne({ listingId: listing._id });

    const variantResult = variant.toObject() as unknown as Record<string, unknown>;
    variantResult.pricePaise = finalPrice;
    variantResult.inventory = activeInv ? activeInv.availableQuantity : 0;
    variantResult.option1 = variant.variantAttributes.option1 || "";
    variantResult.option2 = variant.variantAttributes.option2 || "";
    variantResult.option3 = variant.variantAttributes.option3 || "";

    res.status(200).json({
      success: true,
      message: "Variant updated successfully.",
      variant: variantResult,
    });
  } catch (error: unknown) {
    console.error("Update variant error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to update variant.";
    res.status(400).json({ success: false, message: errorMessage });
  }
}

export async function deleteProductVariant(req: Request, res: Response): Promise<void> {
  try {
    const variantId = req.params.variantId as string;
    const seller = req.seller;

    if (!seller) {
      res.status(403).json({ success: false, message: "Forbidden." });
      return;
    }

    const variant = await ProductVariant.findById(variantId);
    if (!variant) {
      res.status(404).json({ success: false, message: "Variant not found." });
      return;
    }

    // Verify ownership
    const product = await Product.findById(variant.catalogProductId);
    const caller = req.user as IUser | undefined;
    if (
      !product ||
      (product.sellerId?.toString() !== seller._id.toString() &&
        product.createdBy?.toString() !== caller?._id?.toString())
    ) {
      res.status(403).json({ success: false, message: "Forbidden. Access denied." });
      return;
    }

    // Cascading deletions for variant
    const listings = await SellerListing.find({ variantId: variantId });
    const listingIds = listings.map(l => l._id);

    await ProductVariant.findByIdAndDelete(variantId);
    await SellerListing.deleteMany({ variantId: variantId });
    await ListingInventory.deleteMany({ listingId: { $in: listingIds } });
    await ListingPricingHistory.deleteMany({ listingId: { $in: listingIds } });

    // Invalidate product details cache
    if (product) {
      await deleteCache(`product:slug:${product.slug}`);
    }

    res.status(200).json({ success: true, message: "Product variant deleted successfully." });
  } catch (error: unknown) {
    console.error("Delete variant error:", error);
    res.status(500).json({ success: false, message: "Failed to delete variant." });
  }
}
