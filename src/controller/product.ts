import type { Request, Response } from "express";
import type mongoose from "mongoose";
import { Product, type IProduct } from "../models/product.js";
import { Category } from "../models/category.js";
import { ProductImage } from "../models/productImage.js";
import { ProductVariant } from "../models/productVariant.js";
import { Brand } from "../models/brand.js";
import { SellerListing } from "../models/sellerListing.js";
import { ListingInventory } from "../models/listingInventory.js";
import { ListingPricingHistory } from "../models/listingPricingHistory.js";
import type { IUser } from "../models/user.js";
import { isRedisActive, redisClient, getCache, setCache, deleteCache, clearCachePattern } from "../utils/redis.js";
import { productQueue } from "../workers/bullmq.js";
import { saveProductToCatalog } from "../utils/productHelper.js";
import { dispatchWebhookEvent } from "../services/webhookDispatcher.js";
import { slugify } from "../utils/slugify.js";

// ==========================================
// PRODUCTS CRUD (Seller / Public)
// ==========================================

export async function createProduct(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const seller = req.seller;

    if (caller.role !== "seller" || !seller) {
      res.status(403).json({ success: false, message: "Forbidden. Only registered and active sellers can create products." });
      return;
    }

    let payload = req.body;
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("yaml") || contentType.includes("yml") || req.body.yamlPayload) {
      let yamlStr = req.body.yamlPayload;
      if (!yamlStr && typeof req.body === "string") {
        yamlStr = req.body;
      }
      if (yamlStr) {
        try {
          const { parseYAML } = await import("../utils/yamlParser.js");
          payload = parseYAML(yamlStr);
        } catch (parseErr: any) {
          res.status(400).json({ success: false, message: "Invalid YAML format: " + parseErr.message });
          return;
        }
      }
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
      descriptionObj,
      specifications,
      attributeValues,
      richDescription,
      seo,
      dimensions,
      variantAttributes,
      barcode,
      weight,
    } = payload;

    let finalDescription = "";
    let finalDescriptionObj = descriptionObj;
    if (description) {
      if (typeof description === "string") {
        finalDescription = description;
      } else if (typeof description === "object") {
        finalDescriptionObj = description;
        finalDescription = description.long || description.short || "";
      }
    }

    if (!categoryId || !title || !finalDescription || !brand || !sku || !pricePaise) {
      res.status(400).json({
        success: false,
        message: "Required fields: categoryId, title, description (string or short/long object), brand, sku, and pricePaise.",
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
        description: finalDescription,
        brand,
        sku,
        pricePaise,
        comparePricePaise,
        inventory,
        tags: Array.isArray(tags) ? tags : String(tags).split(",").map(t => t.trim()).filter(Boolean),
        descriptionObj: finalDescriptionObj,
        specifications,
        attributeValues,
        richDescription,
        seo,
        dimensions,
        variantAttributes,
        barcode,
        weight,
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
      description: finalDescription,
      brand,
      sku,
      pricePaise,
      comparePricePaise,
      inventory,
      tags: Array.isArray(tags) ? tags : String(tags).split(",").map(t => t.trim()).filter(Boolean),
      moderationStatus: "approved",
      descriptionObj: finalDescriptionObj,
      specifications,
      attributeValues,
      richDescription,
      seo,
      dimensions,
      variantAttributes,
      barcode,
      weight,
    });

    // Invalidate product lists cache
    await clearCachePattern("products:list:*");

    dispatchWebhookEvent("product.created", result.product.toObject(), result.product.sellerId ?? undefined);

    res.status(201).json({
      success: true,
      message: "Product created successfully and is pending moderation.",
      product: result.product,
    });
  } catch (error: unknown) {
    console.error("Create product error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create product.";
    res.status(400).json({ success: false, message: errorMessage });
  }
}

/**
 * [READ LIST] Advanced paginated product query and search.
 * Connects with brand schemas, dynamic attributes, and seller listings.
 */
interface IPaginatedProductsResult {
  total: number;
  page: number;
  limit: number;
  pages: number;
  products: Record<string, unknown>[];
}

export async function getAllProducts(req: Request, res: Response): Promise<void> {
  try {
    const cacheKey = `products:list:${JSON.stringify(req.query)}`;

    // Check cache
    const cachedResult = await getCache<IPaginatedProductsResult>(cacheKey);

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

    const query: {
      status?: "draft" | "active" | "blocked";
      moderationStatus?: "pending" | "approved" | "hidden" | "removed";
      categoryId?: string | mongoose.Types.ObjectId;
      brandId?: mongoose.Types.ObjectId;
      searchKeywords?: string;
      $or?: Array<Record<string, unknown>>;
    } = {
      status: "active",
      moderationStatus: "approved",
    };

    // Filter by Category
    if (categoryId) {
      query.categoryId = categoryId as string;
    }

    // Filter by Brand
    if (brand) {
      const brandSlug = slugify(brand as string);
      const matchedBrand = await Brand.findOne({ slug: brandSlug });
      if (matchedBrand) {
        query.brandId = matchedBrand._id as mongoose.Types.ObjectId;
      } else {
        // Return empty since the requested brand doesn't exist
        res.status(200).json({ success: true, total: 0, page: 1, limit: 10, pages: 0, products: [] });
        return;
      }
    }

    // Filter by Tag
    if (tag) {
      query.searchKeywords = tag as string;
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

    const processedProducts: Record<string, unknown>[] = [];

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

      const prodObj = prod.toObject() as unknown as Record<string, unknown>;
      prodObj.pricePaise = sellingPrice;
      prodObj.comparePricePaise = bestPricing ? bestPricing.mrpPaise : undefined;
      prodObj.inventory = totalInventory;
      const populatedBrand = prod.brandId as unknown as { name: string; slug: string } | null | undefined;
      prodObj.brand = populatedBrand ? populatedBrand.name : "";
      prodObj.sellerId = bestListing ? bestListing.sellerId : prod.sellerId; // Fallback to creator seller

      processedProducts.push(prodObj);
    }

    // Sort in-memory to guarantee correct listing-driven order
    if (sort === "priceAsc") {
      processedProducts.sort((a, b) => (a.pricePaise as number) - (b.pricePaise as number));
    } else if (sort === "priceDesc") {
      processedProducts.sort((a, b) => (b.pricePaise as number) - (a.pricePaise as number));
    } else { // default to newest
      processedProducts.sort((a, b) => {
        const timeA = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a.createdAt as string).getTime();
        const timeB = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b.createdAt as string).getTime();
        return timeB - timeA;
      });
    }

    // Pagination
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 10;
    const skipNum = (pageNum - 1) * limitNum;

    const paginatedProducts = processedProducts.slice(skipNum, skipNum + limitNum);
    const total = processedProducts.length;

    const result: IPaginatedProductsResult = {
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
  } catch (error: unknown) {
    console.error("Get all products error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to query products.";
    res.status(500).json({ success: false, message: errorMessage });
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
    const cachedProduct = await getCache<Record<string, unknown>>(cacheKey);
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

    const variantObjects: Record<string, unknown>[] = [];
    let lowestPriceAcrossVariants = Infinity;
    let bestPricingAcrossVariants: unknown = null;
    let totalAvailableInventory = 0;
    let primarySellerInfo: unknown = product.sellerId;

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
      let bestPricing = null;

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
        }

        if (pricing && price < lowestPriceAcrossVariants) {
          lowestPriceAcrossVariants = price;
          bestPricingAcrossVariants = pricing;
          primarySellerInfo = l.sellerId;
        }

        return {
          ...l.toObject(),
          availableQuantity: available,
          pricePaise: price,
          comparePricePaise: mrp,
        };
      });

      const vObj = v.toObject() as unknown as Record<string, unknown>;
      vObj.pricePaise = bestPricing ? (bestPricing as { sellingPricePaise: number }).sellingPricePaise : 0;
      vObj.comparePricePaise = bestPricing ? (bestPricing as { mrpPaise: number }).mrpPaise : undefined;
      vObj.inventory = totalInventory;
      vObj.listings = listingDetails;

      // Keep legacy properties option1/option2/option3 populated for backward compatibility
      const attrs = v.variantAttributes || {};
      vObj.option1 = attrs.option1 || attrs.size || "";
      vObj.option2 = attrs.option2 || attrs.color || "";
      vObj.option3 = attrs.option3 || attrs.style || "";

      variantObjects.push(vObj);
    }

    const productDetails = {
      ...product.toObject(),
      images,
      variants: variantObjects,
      pricePaise: lowestPriceAcrossVariants !== Infinity ? lowestPriceAcrossVariants : 0,
      comparePricePaise: bestPricingAcrossVariants ? (bestPricingAcrossVariants as { mrpPaise: number }).mrpPaise : undefined,
      inventory: totalAvailableInventory,
      brand: product.brandId ? (product.brandId as unknown as { name: string }).name : "",
      sellerId: primarySellerInfo,
    };

    // Cache the detail result (TTL: 10 minutes = 600 seconds)
    await setCache(cacheKey, productDetails, 600);

    res.status(200).json({
      success: true,
      product: productDetails,
    });
  } catch (error: unknown) {
    console.error("Get product error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to retrieve product.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
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

    let payload = req.body;
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("yaml") || contentType.includes("yml") || req.body.yamlPayload) {
      let yamlStr = req.body.yamlPayload;
      if (!yamlStr && typeof req.body === "string") {
        yamlStr = req.body;
      }
      if (yamlStr) {
        try {
          const { parseYAML } = await import("../utils/yamlParser.js");
          payload = parseYAML(yamlStr);
        } catch (parseErr: any) {
          res.status(400).json({ success: false, message: "Invalid YAML format: " + parseErr.message });
          return;
        }
      }
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
      descriptionObj,
      specifications,
      attributeValues,
      richDescription,
      seo,
    } = payload;

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
      if (typeof description === "string") {
        product.longDescription = description;
        product.shortDescription = description.slice(0, 150);
        product.description = { short: description.slice(0, 150), long: description };
      } else if (typeof description === "object") {
        product.description = description;
        product.longDescription = description.long || "";
        product.shortDescription = description.short || "";
      }
    }

    if (descriptionObj) {
      product.description = descriptionObj;
      product.longDescription = descriptionObj.long || "";
      product.shortDescription = descriptionObj.short || "";
    }

    if (attributeValues) product.attributeValues = attributeValues;
    if (specifications) product.specifications = specifications;
    if (richDescription) product.richDescription = richDescription;
    if (seo) product.seo = seo;

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
  } catch (error: unknown) {
    console.error("Update product error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to update product.";
    res.status(400).json({ success: false, message: errorMessage });
  }
}

/**
 * [DELETE] Deletes own product or lets Admin delete it.
 * Cascades to delete variants, media, seller listings, pricing lists, and inventories.
 */
export async function deleteProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
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
    const variants = await ProductVariant.find({ catalogProductId: id });
    const variantIds = variants.map(v => v._id);

    // 2. Fetch active listings
    const listings = await SellerListing.find({ variantId: { $in: variantIds } });
    const listingIds = listings.map(l => l._id);

    // 3. Perform cascading deletions
    await Product.findByIdAndDelete(id);
    await ProductImage.deleteMany({ catalogProductId: id });
    await ProductVariant.deleteMany({ catalogProductId: id });
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
  } catch (error: unknown) {
    console.error("Delete product error:", error);
    res.status(500).json({ success: false, message: "Failed to delete product." });
  }
}
