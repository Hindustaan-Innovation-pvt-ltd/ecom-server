import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import mongoose from "mongoose";
import { Product } from "../models/product.js";
import { Category } from "../models/category.js";
import { ProductImage } from "../models/productImage.js";
import { ProductVariant } from "../models/productVariant.js";
import { Brand } from "../models/brand.js";
import { SellerListing } from "../models/sellerListing.js";
import { ListingInventory } from "../models/listingInventory.js";
import { ListingPricingHistory } from "../models/listingPricingHistory.js";
import type { IUser } from "../models/user.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";
import { redisClient, isRedisActive, getCache, setCache, deleteCache, clearCachePattern } from "../utils/redis.js";
import { productQueue } from "../workers/bullmq.js";
import { saveProductToCatalog } from "../utils/productHelper.js";
import { dispatchWebhookEvent } from "../services/webhookDispatcher.js";

// Helper to slugify text
function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]+/g, "")
    .replace(/\-\-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

// ==========================================
// A. CATEGORIES CRUD (Admin / Public)
// ==========================================

export async function createCategory(req: Request, res: Response): Promise<void> {
  try {
    const { name, imageUrl, parentId, sortOrder } = req.body;
    if (!name) {
      res.status(400).json({ success: false, message: "Category name is required." });
      return;
    }

    const slug = slugify(name);
    const existing = await Category.findOne({ slug });
    if (existing) {
      res.status(400).json({ success: false, message: "A category with this name already exists." });
      return;
    }

    let level = 1;
    let path: string[] = [slug];

    if (parentId) {
      const parent = await Category.findById(parentId);
      if (!parent) {
        res.status(400).json({ success: false, message: "Parent category not found." });
        return;
      }
      level = parent.level + 1;
      path = [...parent.path, slug];

      // Update parent isLeaf status if it was true
      if (parent.isLeaf) {
        parent.isLeaf = false;
        await parent.save();
      }
    }

    const category = new Category({
      name,
      slug,
      parentId: parentId || null,
      level,
      path,
      isLeaf: true,
      sortOrder: sortOrder || 1,
      imageUrl,
    });
    await category.save();

    // Invalidate categories cache
    await deleteCache("categories:all");

    res.status(201).json({ success: true, message: "Category created successfully.", category });
  } catch (error: any) {
    console.error("Create category error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to create category." });
  }
}

export async function getAllCategories(req: Request, res: Response): Promise<void> {
  try {
    // Attempt cache read
    const cachedCategories = await getCache<any[]>("categories:all");
    if (cachedCategories) {
      res.status(200).json({ success: true, fromCache: true, categories: cachedCategories });
      return;
    }

    const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });

    // Save to cache (TTL: 1 hour = 3600 seconds)
    await setCache("categories:all", categories, 3600);

    res.status(200).json({ success: true, categories });
  } catch (error) {
    console.error("Get all categories error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
}

// ==========================================
// B. PRODUCTS CRUD (Seller / Public)
// ==========================================

export async function createProduct(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const seller = req.seller;

    if (caller.role !== "seller" || !seller) {
      res.status(403).json({ success: false, message: "Forbidden. Only registered and active sellers can create products." });
      return;
    }

    const {
      categoryId,
      title,
      description,
      brand,
      sku,
      pricePaise,
      comparePricePaise,
      inventory,
      tags = [],
    } = req.body;

    if (!categoryId || !title || !description || !brand || !sku || !pricePaise) {
      res.status(400).json({
        success: false,
        message: "Required fields: categoryId, title, description, brand, sku, and pricePaise.",
      });
      return;
    }

    // Rate-Limiter: Check cool-down limit per seller
    if (isRedisActive && redisClient) {
      const rateLimitKey = `product:limit:${seller._id.toString()}`;
      const isRateLimited = await redisClient.exists(rateLimitKey);
      if (isRateLimited) {
        res.status(429).json({
          success: false,
          message: "Too many requests. You can only add one product at a time. Please wait a few seconds.",
        });
        return;
      }
      // Set 3-second cool-down window
      await redisClient.set(rateLimitKey, "1", "EX", 3);
    }

    // Verify category exists
    const category = await Category.findById(categoryId);
    if (!category) {
      res.status(404).json({ success: false, message: "Category not found." });
      return;
    }

    // Streaming: Push product payload to Product Queue for sequential streaming
    if (isRedisActive) {
      const job = await productQueue.add("createProduct", {
        sellerId: seller._id,
        categoryId,
        title,
        description,
        brand,
        sku,
        pricePaise,
        comparePricePaise,
        inventory,
        tags: Array.isArray(tags) ? tags : String(tags).split(",").map(t => t.trim()).filter(Boolean),
      });

      res.status(202).json({
        success: true,
        message: "Your product creation request is queued and is being processed sequentially.",
        jobId: job.id,
      });
      return;
    }

    // Synchronous fallback if Redis is offline
    const result = await saveProductToCatalog({
      sellerId: seller._id,
      categoryId,
      title,
      description,
      brand,
      sku,
      pricePaise,
      comparePricePaise,
      inventory,
      tags: Array.isArray(tags) ? tags : String(tags).split(",").map(t => t.trim()).filter(Boolean),
      moderationStatus: "pending",
    });

    // Invalidate product lists cache
    await clearCachePattern("products:list:*");

    dispatchWebhookEvent("product.created", result.product.toObject(), result.product.sellerId ?? undefined);

    res.status(201).json({
      success: true,
      message: "Product created successfully and is pending moderation.",
      product: result.product,
    });
  } catch (error: any) {
    console.error("Create product error:", error);
    res.status(400).json({ success: false, message: error.message || "Failed to create product." });
  }
}

/**
 * [READ LIST] Advanced paginated product query and search.
 * Connects with brand schemas, dynamic attributes, and seller listings.
 */
export async function getAllProducts(req: Request, res: Response): Promise<void> {
  try {
    const cacheKey = `products:list:${JSON.stringify(req.query)}`;

    // Check cache
    const cachedResult = await getCache<{
      total: number;
      page: number;
      limit: number;
      pages: number;
      products: any[];
    }>(cacheKey);

    if (cachedResult) {
      res.status(200).json({
        success: true,
        fromCache: true,
        ...cachedResult,
      });
      return;
    }

    const {
      categoryId,
      brand,
      tag,
      minPrice,
      maxPrice,
      search,
      sort = "newest",
      page = "1",
      limit = "10",
    } = req.query;

    const query: any = {
      status: "active",
      moderationStatus: "approved",
    };

    // Filter by Category
    if (categoryId) {
      query.categoryId = categoryId;
    }

    // Filter by Brand
    if (brand) {
      const brandSlug = slugify(brand as string);
      const matchedBrand = await Brand.findOne({ slug: brandSlug });
      if (matchedBrand) {
        query.brandId = matchedBrand._id;
      } else {
        // Return empty since the requested brand doesn't exist
        res.status(200).json({ success: true, total: 0, page: 1, limit: 10, pages: 0, products: [] });
        return;
      }
    }

    // Filter by Tag
    if (tag) {
      query.searchKeywords = tag;
    }

    // Search query on title, description, keywords
    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      query.$or = [
        { title: searchRegex },
        { shortDescription: searchRegex },
        { longDescription: searchRegex },
        { searchKeywords: searchRegex },
      ];
    }

    // Fetch all matched products to calculate dynamic listing prices/inventories
    const matchedProducts = await Product.find(query)
      .populate("categoryId", "name slug")
      .populate("brandId", "name slug");

    const processedProducts: any[] = [];

    for (const prod of matchedProducts) {
      const variants = await ProductVariant.find({ catalogProductId: prod._id });
      const variantIds = variants.map(v => v._id);

      const listings = await SellerListing.find({ variantId: { $in: variantIds }, status: "active" })
        .populate({
          path: "sellerId",
          select: "businessName ratingAverage totalSales businessEmail",
        });

      const listingIds = listings.map(l => l._id);
      const inventories = await ListingInventory.find({ listingId: { $in: listingIds } });
      const pricingHistory = await ListingPricingHistory.find({ listingId: { $in: listingIds } });

      let bestListing = listings[0] || null;
      let lowestPrice = Infinity;
      let bestPricing = null;
      let totalInventory = 0;

      for (const listing of listings) {
        const inv = inventories.find(i => i.listingId.toString() === listing._id.toString());
        if (inv) {
          totalInventory += inv.availableQuantity;
        }

        const pricing = pricingHistory
          .filter(p => p.listingId.toString() === listing._id.toString())
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]; // Latest pricing

        if (pricing && pricing.sellingPricePaise < lowestPrice) {
          lowestPrice = pricing.sellingPricePaise;
          bestListing = listing;
          bestPricing = pricing;
        }
      }

      // Skip if price filters are applied and the lowest price doesn't match the filter
      const sellingPrice = bestPricing ? bestPricing.sellingPricePaise : 0;
      if (minPrice && sellingPrice < parseInt(minPrice as string, 10)) continue;
      if (maxPrice && sellingPrice > parseInt(maxPrice as string, 10)) continue;

      const prodObj = prod.toObject() as any;
      prodObj.pricePaise = sellingPrice;
      prodObj.comparePricePaise = bestPricing ? bestPricing.mrpPaise : undefined;
      prodObj.inventory = totalInventory;
      prodObj.brand = prod.brandId ? (prod.brandId as any).name : "";
      prodObj.sellerId = bestListing ? bestListing.sellerId : prod.sellerId; // Fallback to creator seller

      processedProducts.push(prodObj);
    }

    // Sort in-memory to guarantee correct listing-driven order
    if (sort === "priceAsc") {
      processedProducts.sort((a, b) => a.pricePaise - b.pricePaise);
    } else if (sort === "priceDesc") {
      processedProducts.sort((a, b) => b.pricePaise - a.pricePaise);
    } else { // default to newest
      processedProducts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    // Pagination
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 10;
    const skipNum = (pageNum - 1) * limitNum;

    const paginatedProducts = processedProducts.slice(skipNum, skipNum + limitNum);
    const total = processedProducts.length;

    const result = {
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
      products: paginatedProducts,
    };

    // Cache the result (TTL: 5 minutes = 300 seconds)
    await setCache(cacheKey, result, 300);

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error("Get all products error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to query products." });
  }
}

/**
 * [READ ONE] Detailed product inspection by slug.
 * Populates categories, brands, extra photos, variants, and nested multi-seller listings!
 */
export async function getProductBySlug(req: Request, res: Response): Promise<void> {
  try {
    const { slug } = req.params;
    const cacheKey = `product:slug:${slug}`;

    // Check cache
    const cachedProduct = await getCache<any>(cacheKey);
    if (cachedProduct) {
      res.status(200).json({
        success: true,
        fromCache: true,
        product: cachedProduct,
      });
      return;
    }

    const product = await Product.findOne({ slug: slug as string, status: "active", moderationStatus: "approved" })
      .populate("categoryId", "name slug")
      .populate("brandId", "name slug")
      .populate({
        path: "sellerId",
        select: "businessName ratingAverage totalSales businessEmail",
      });

    if (!product) {
      res.status(404).json({ success: false, message: "Product not found." });
      return;
    }

    // Fetch media (images/videos)
    const images = await ProductImage.find({ catalogProductId: product._id }).sort({ sortOrder: 1 });

    // Fetch variants
    const variants = await ProductVariant.find({ catalogProductId: product._id });

    const variantObjects = [];
    let lowestPriceAcrossVariants = Infinity;
    let bestPricingAcrossVariants: any = null;
    let totalAvailableInventory = 0;
    let primarySellerInfo = product.sellerId;

    for (const v of variants) {
      const listings = await SellerListing.find({ variantId: v._id, status: "active" })
        .populate({
          path: "sellerId",
          select: "businessName ratingAverage totalSales businessEmail",
        });

      const listingIds = listings.map(l => l._id);
      const inventories = await ListingInventory.find({ listingId: { $in: listingIds } });
      const pricingHistory = await ListingPricingHistory.find({ listingId: { $in: listingIds } });

      let totalInventory = 0;
      let lowestPrice = Infinity;
      let bestPricing: any = null;
      let bestListing = null;

      const listingDetails = listings.map(l => {
        const inv = inventories.find(i => i.listingId.toString() === l._id.toString());
        const available = inv ? inv.availableQuantity : 0;
        totalInventory += available;
        totalAvailableInventory += available;

        const pricing = pricingHistory
          .filter(p => p.listingId.toString() === l._id.toString())
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]; // Latest pricing

        const price = pricing ? pricing.sellingPricePaise : 0;
        const mrp = pricing ? pricing.mrpPaise : price;

        if (pricing && price < lowestPrice) {
          lowestPrice = price;
          bestPricing = pricing;
          bestListing = l;
        }

        if (pricing && price < lowestPriceAcrossVariants) {
          lowestPriceAcrossVariants = price;
          bestPricingAcrossVariants = pricing;
          primarySellerInfo = l.sellerId as any;
        }

        return {
          ...l.toObject(),
          availableQuantity: available,
          pricePaise: price,
          comparePricePaise: mrp,
        };
      });

      const vObj = v.toObject() as any;
      vObj.pricePaise = bestPricing ? bestPricing.sellingPricePaise : 0;
      vObj.comparePricePaise = bestPricing ? bestPricing.mrpPaise : undefined;
      vObj.inventory = totalInventory;
      vObj.listings = listingDetails;

      // Keep legacy properties option1/option2/option3 populated for backward compatibility
      vObj.option1 = v.variantAttributes.option1 || v.variantAttributes.size || "";
      vObj.option2 = v.variantAttributes.option2 || v.variantAttributes.color || "";
      vObj.option3 = v.variantAttributes.option3 || v.variantAttributes.style || "";

      variantObjects.push(vObj);
    }

    const productDetails = {
      ...product.toObject(),
      images,
      variants: variantObjects,
      pricePaise: lowestPriceAcrossVariants !== Infinity ? lowestPriceAcrossVariants : 0,
      comparePricePaise: bestPricingAcrossVariants ? (bestPricingAcrossVariants as any).mrpPaise : undefined,
      inventory: totalAvailableInventory,
      brand: product.brandId ? (product.brandId as any).name : "",
      sellerId: primarySellerInfo,
    };

    // Cache the detail result (TTL: 10 minutes = 600 seconds)
    await setCache(cacheKey, productDetails, 600);

    res.status(200).json({
      success: true,
      product: productDetails,
    });
  } catch (error: any) {
    console.error("Get product error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to retrieve product." });
  }
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const caller = req.user as IUser;
    const seller = req.seller;

    if (caller.role !== "seller" || !seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller role required." });
      return;
    }

    const product = await Product.findById(id);
    if (!product) {
      res.status(404).json({ success: false, message: "Product not found." });
      return;
    }

    // Enforce ownership
    if (product.sellerId?.toString() !== seller._id.toString() && product.createdBy?.toString() !== caller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this product." });
      return;
    }

    const {
      categoryId,
      title,
      description,
      brand,
      sku,
      pricePaise,
      comparePricePaise,
      inventory,
      tags,
      isActive,
    } = req.body;

    if (categoryId) {
      const category = await Category.findById(categoryId);
      if (!category) {
        res.status(404).json({ success: false, message: "Category not found." });
        return;
      }
      product.categoryId = categoryId;
    }

    if (brand) {
      const brandSlug = slugify(brand);
      let matchedBrand = await Brand.findOne({ slug: brandSlug });
      if (!matchedBrand) {
        matchedBrand = new Brand({ name: brand.trim(), slug: brandSlug });
        await matchedBrand.save();
      }
      product.brandId = matchedBrand._id as mongoose.Types.ObjectId;
    }

    if (title) product.title = title;
    if (description) {
      product.shortDescription = description.slice(0, 150);
      product.longDescription = description;
    }

    if (typeof isActive === "boolean") {
      product.status = isActive ? "active" : "draft";
    }

    if (tags) {
      const compiledTags = Array.isArray(tags) ? tags : String(tags).split(",").map(t => t.trim()).filter(Boolean);
      product.searchKeywords = compiledTags;
    }

    await product.save();

    // If pricing or inventory values are passed, update the Seller's Listing for the default variant
    if (pricePaise !== undefined || inventory !== undefined) {
      const defaultVariant = await ProductVariant.findById(product.defaultVariantId);
      if (defaultVariant) {
        let listing = await SellerListing.findOne({ sellerId: seller._id, variantId: defaultVariant._id });
        if (!listing) {
          listing = new SellerListing({
            sellerId: seller._id,
            variantId: defaultVariant._id,
            sellerSku: sku || defaultVariant.sku,
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

        if (pricePaise !== undefined) {
          const pricing = new ListingPricingHistory({
            listingId: listing._id,
            mrpPaise: comparePricePaise || pricePaise,
            sellingPricePaise: pricePaise,
            startAt: new Date(),
          });
          await pricing.save();
        }
      }
    }

    // Invalidate product caches
    await deleteCache(`product:slug:${product.slug}`);
    await clearCachePattern("products:list:*");

    res.status(200).json({
      success: true,
      message: "Product updated successfully.",
      product,
    });
  } catch (error: any) {
    console.error("Update product error:", error);
    res.status(400).json({ success: false, message: error.message || "Failed to update product." });
  }
}

/**
 * [DELETE] Deletes own product or lets Admin delete it.
 * Cascades to delete variants, media, seller listings, pricing lists, and inventories.
 */
export async function deleteProduct(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const caller = req.user as IUser;
    const seller = req.seller;

    const product = await Product.findById(id);
    if (!product) {
      res.status(404).json({ success: false, message: "Product not found." });
      return;
    }

    // RBAC: Only Admin or Creator Seller can delete
    if (caller.role !== "admin") {
      if (!seller || (product.sellerId?.toString() !== seller._id.toString() && product.createdBy?.toString() !== caller._id.toString())) {
        res.status(403).json({ success: false, message: "Forbidden. Access denied." });
        return;
      }
    }

    // 1. Fetch variants to isolate listings
    const variants = await ProductVariant.find({ catalogProductId: id } as any);
    const variantIds = variants.map(v => v._id);

    // 2. Fetch active listings
    const listings = await SellerListing.find({ variantId: { $in: variantIds } });
    const listingIds = listings.map(l => l._id);

    // 3. Perform cascading deletions
    await Product.findByIdAndDelete(id);
    await ProductImage.deleteMany({ catalogProductId: id } as any);
    await ProductVariant.deleteMany({ catalogProductId: id } as any);
    await SellerListing.deleteMany({ variantId: { $in: variantIds } });
    await ListingInventory.deleteMany({ listingId: { $in: listingIds } });
    await ListingPricingHistory.deleteMany({ listingId: { $in: listingIds } });

    // Invalidate product caches
    await deleteCache(`product:slug:${product.slug}`);
    await clearCachePattern("products:list:*");

    res.status(200).json({
      success: true,
      message: "Product and associated variants/images/listings deleted successfully.",
    });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ success: false, message: "Failed to delete product." });
  }
}

// ==========================================
// C. PRODUCT IMAGES (Seller Only)
// ==========================================

export async function uploadProductImages(req: Request, res: Response): Promise<void> {
  const files = (req as any).files as any[];
  try {
    const { id } = req.params; // Product ID
    const seller = req.seller;

    if (!seller) {
      if (files) files.forEach(f => fs.unlinkSync(f.path));
      res.status(403).json({ success: false, message: "Forbidden. Seller permissions required." });
      return;
    }

    const product = await Product.findById(id);
    if (!product) {
      if (files) files.forEach(f => fs.unlinkSync(f.path));
      res.status(404).json({ success: false, message: "Product not found." });
      return;
    }

    // Enforce ownership
    if (product.sellerId?.toString() !== seller._id.toString() && product.createdBy?.toString() !== (req.user as any)?._id?.toString()) {
      if (files) files.forEach(f => fs.unlinkSync(f.path));
      res.status(403).json({ success: false, message: "Forbidden. You do not own this product." });
      return;
    }

    if (!files || files.length === 0) {
      res.status(400).json({ success: false, message: "Please upload at least one image file." });
      return;
    }

    const uploadedUrls: string[] = [];
    const imageDocuments: any[] = [];

    // Stream files to Cloudinary
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const cloudUrl = await uploadToCloudinary(file.path, `hmarketplace/products/${id}`);
        const finalUrl = cloudUrl || `/uploads/user_profile/${file.filename}`;

        if (cloudUrl && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }

        uploadedUrls.push(finalUrl);

        const newImage = new ProductImage({
          catalogProductId: id,
          imageUrl: finalUrl,
          type: "image",
          sortOrder: i,
          isPrimary: i === 0,
        });
        await newImage.save();
        imageDocuments.push(newImage);
      } catch (uploadErr) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        console.error("Single image upload failed:", uploadErr);
      }
    }

    // Invalidate product details cache
    await deleteCache(`product:slug:${product.slug}`);

    res.status(201).json({
      success: true,
      message: `${imageDocuments.length} images uploaded and linked successfully.`,
      images: imageDocuments,
    });
  } catch (error: any) {
    if (files) files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
    console.error("Upload product images error:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to upload images." });
  }
}

export async function deleteProductImage(req: Request, res: Response): Promise<void> {
  try {
    const { imageId } = req.params;
    const seller = req.seller;

    if (!seller) {
      res.status(403).json({ success: false, message: "Forbidden. Seller permissions required." });
      return;
    }

    const image = await ProductImage.findById(imageId);
    if (!image) {
      res.status(404).json({ success: false, message: "Image not found." });
      return;
    }

    // Verify ownership of the product
    const product = await Product.findById(image.catalogProductId);
    if (!product || (product.sellerId?.toString() !== seller._id.toString() && product.createdBy?.toString() !== (req.user as any)?._id?.toString())) {
      res.status(403).json({ success: false, message: "Forbidden. Access denied." });
      return;
    }

    await ProductImage.findByIdAndDelete(imageId);

    // Invalidate product details cache
    if (product) {
      await deleteCache(`product:slug:${product.slug}`);
    }

    res.status(200).json({ success: true, message: "Product image deleted successfully." });
  } catch (error) {
    console.error("Delete image error:", error);
    res.status(500).json({ success: false, message: "Failed to delete product image." });
  }
}

// ==========================================
// D. PRODUCT VARIANTS (Seller Only)
// ==========================================

export async function createProductVariant(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params; // Product ID
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
    if (product.sellerId?.toString() !== seller._id.toString() && product.createdBy?.toString() !== (req.user as any)?._id?.toString()) {
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
    const variantResult = variant.toObject() as any;
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
  } catch (error: any) {
    console.error("Create variant error:", error);
    res.status(400).json({ success: false, message: error.message || "Failed to create variant." });
  }
}

export async function updateProductVariant(req: Request, res: Response): Promise<void> {
  try {
    const { variantId } = req.params;
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
    if (!product || (product.sellerId?.toString() !== seller._id.toString() && product.createdBy?.toString() !== (req.user as any)?._id?.toString())) {
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

    const variantResult = variant.toObject() as any;
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
  } catch (error: any) {
    console.error("Update variant error:", error);
    res.status(400).json({ success: false, message: error.message || "Failed to update variant." });
  }
}

export async function deleteProductVariant(req: Request, res: Response): Promise<void> {
  try {
    const { variantId } = req.params;
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
    if (!product || (product.sellerId?.toString() !== seller._id.toString() && product.createdBy?.toString() !== (req.user as any)?._id?.toString())) {
      res.status(403).json({ success: false, message: "Forbidden. Access denied." });
      return;
    }

    // Cascading deletions for variant
    const listings = await SellerListing.find({ variantId: variantId } as any);
    const listingIds = listings.map(l => l._id);

    await ProductVariant.findByIdAndDelete(variantId);
    await SellerListing.deleteMany({ variantId: variantId } as any);
    await ListingInventory.deleteMany({ listingId: { $in: listingIds } });
    await ListingPricingHistory.deleteMany({ listingId: { $in: listingIds } });

    // Invalidate product details cache
    if (product) {
      await deleteCache(`product:slug:${product.slug}`);
    }

    res.status(200).json({ success: true, message: "Product variant deleted successfully." });
  } catch (error) {
    console.error("Delete variant error:", error);
    res.status(500).json({ success: false, message: "Failed to delete variant." });
  }
}
