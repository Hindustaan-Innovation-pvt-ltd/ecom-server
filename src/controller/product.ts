import type { Request, Response } from "express";
import { parsePagination } from "../utils/pagination.js";
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
import { isRedisActive, redisClient, getCache, setCache, deleteCache, clearCachePattern, tagCacheKeyWithProduct, invalidateProductCache } from "../utils/redis.js";
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

    // Rate-Limiter: Check cool-down limit per seller (Production only)
    if (process.env.NODE_ENV === "production" && isRedisActive && redisClient) {
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

    // Streaming: Push product payload to Product Queue for sequential streaming (Production only)
    if (process.env.NODE_ENV === "production" && isRedisActive) {
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

// ─── Result types ──────────────────────────────────────────────────────────────

interface IPaginatedProductsResult {
  total: number;
  page: number;
  limit: number;
  pages: number;
  products: Record<string, unknown>[];
}

/**
 * [READ LIST] Advanced paginated product query and search.
 *
 * PERFORMANCE: Uses a single MongoDB aggregation pipeline with $lookup stages
 * to join variants → listings → inventory → pricing all in ONE database roundtrip.
 * Previously this fired 150–250+ individual queries per request via a for-loop.
 */
export async function getAllProducts(req: Request, res: Response): Promise<void> {
  try {
    const cacheKey = `products:list:${JSON.stringify(req.query)}`;

    // Check cache first — hits avoid the DB entirely
    const cachedResult = await getCache<IPaginatedProductsResult>(cacheKey);
    if (cachedResult) {
      res.status(200).json({ success: true, fromCache: true, ...cachedResult });
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
    } = req.query;

    const { page: pageNum, limit: limitNum, skip } = parsePagination(req.query);

    // ── 1. Build the base $match stage ─────────────────────────────────────────
    const matchStage: Record<string, unknown> = {
      status: "active",
      moderationStatus: "approved",
    };

    if (categoryId) {
      matchStage.categoryId = categoryId;
    }

    if (tag) {
      matchStage.searchKeywords = tag;
    }

    // Full-text search on title/description/keywords
    if (search) {
      const searchRegex = { $regex: search as string, $options: "i" };
      matchStage.$or = [
        { title: searchRegex },
        { shortDescription: searchRegex },
        { searchKeywords: searchRegex },
      ];
    }

    // ── 2. Resolve brand slug → ID before the pipeline ─────────────────────────
    if (brand) {
      const brandSlug = slugify(brand as string);
      const matchedBrand = await Brand.findOne({ slug: brandSlug }).select("_id").lean();
      if (!matchedBrand) {
        // Brand doesn't exist — return empty result immediately
        res.status(200).json({ success: true, total: 0, page: pageNum, limit: limitNum, pages: 0, products: [] });
        return;
      }
      matchStage.brandId = matchedBrand._id;
    }

    // ── 3. Build sort stage ────────────────────────────────────────────────────
    const sortStage: Record<string, 1 | -1> =
      sort === "priceAsc" ? { "bestPrice": 1 } :
      sort === "priceDesc" ? { "bestPrice": -1 } :
      { createdAt: -1 };  // default: newest

    // ── 4. Aggregation Pipeline ────────────────────────────────────────────────
    // A single pipeline replaces the N+1 loop — all joins happen inside MongoDB.
    const pipeline: object[] = [
      // Stage 1: Filter products
      { $match: matchStage },

      // Stage 2: Join variants for this product
      {
        $lookup: {
          from: "productvariants",
          localField: "_id",
          foreignField: "catalogProductId",
          as: "variants",
        },
      },

      // Stage 3: Join active seller listings for all variants
      {
        $lookup: {
          from: "sellerlistings",
          let: { variantIds: "$variants._id" },
          pipeline: [
            { $match: { $expr: { $and: [
              { $in: ["$variantId", "$$variantIds"] },
              { $eq: ["$status", "active"] },
            ]}}},
            // Join inventory per listing
            {
              $lookup: {
                from: "listinginventories",
                localField: "_id",
                foreignField: "listingId",
                as: "inventory",
              },
            },
            // Join latest pricing per listing
            {
              $lookup: {
                from: "listingpricinghistories",
                let: { lid: "$_id" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$listingId", "$$lid"] } } },
                  { $sort: { createdAt: -1 } },
                  { $limit: 1 },
                ],
                as: "latestPricing",
              },
            },
          ],
          as: "listings",
        },
      },

      // Stage 4: Compute best price + total inventory across all listings
      {
        $addFields: {
          bestPrice: {
            $min: {
              $map: {
                input: "$listings",
                as: "l",
                in: { $arrayElemAt: ["$$l.latestPricing.sellingPricePaise", 0] },
              },
            },
          },
          comparePricePaise: {
            $let: {
              vars: {
                bestListing: {
                  $first: {
                    $filter: {
                      input: "$listings",
                      as: "l",
                      cond: {
                        $eq: [
                          { $arrayElemAt: ["$$l.latestPricing.sellingPricePaise", 0] },
                          {
                            $min: {
                              $map: {
                                input: "$listings",
                                as: "l2",
                                in: { $arrayElemAt: ["$$l2.latestPricing.sellingPricePaise", 0] },
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
              in: { $arrayElemAt: ["$$bestListing.latestPricing.mrpPaise", 0] },
            },
          },
          totalInventory: {
            $sum: {
              $map: {
                input: "$listings",
                as: "l",
                in: { $ifNull: [{ $arrayElemAt: ["$$l.inventory.availableQuantity", 0] }, 0] },
              },
            },
          },
        },
      },

      // Stage 5: Apply price-range filters (happens AFTER computing dynamic pricing)
      ...(minPrice || maxPrice ? [{
        $match: {
          ...(minPrice ? { bestPrice: { $gte: parseInt(minPrice as string, 10) } } : {}),
          ...(maxPrice ? { bestPrice: { $lte: parseInt(maxPrice as string, 10) } } : {}),
        },
      }] : []),

      // Stage 6: Sort
      { $sort: sortStage },

      // Stage 7: Get total count before pagination (using $facet for single round-trip)
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $skip: skip },
            { $limit: limitNum },
            // Populate category and brand
            {
              $lookup: {
                from: "categories",
                localField: "categoryId",
                foreignField: "_id",
                as: "categoryInfo",
              },
            },
            {
              $lookup: {
                from: "brands",
                localField: "brandId",
                foreignField: "_id",
                as: "brandInfo",
              },
            },
            // Project only the fields needed in the response
            {
              $project: {
                _id: 1,
                title: 1,
                slug: 1,
                shortDescription: 1,
                status: 1,
                moderationStatus: 1,
                ratingAverage: 1,
                reviewCount: 1,
                createdAt: 1,
                updatedAt: 1,
                seo: 1,
                highlights: 1,
                pricePaise: "$bestPrice",
                comparePricePaise: 1,
                inventory: "$totalInventory",
                category: { $arrayElemAt: ["$categoryInfo", 0] },
                brand: { $arrayElemAt: ["$brandInfo.name", 0] },
                sellerId: 1,
              },
            },
          ],
        },
      },
    ];

    const [facetResult] = await Product.aggregate(pipeline as any[]);

    const total: number = facetResult?.metadata?.[0]?.total ?? 0;
    const products: Record<string, unknown>[] = facetResult?.data ?? [];

    const result: IPaginatedProductsResult = {
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
      products,
    };

    // Cache the result (TTL: 5 minutes = 300 seconds)
    await setCache(cacheKey, result, 300);

    // Dynamic Cache Tagging: link this cache key to each product ID returned
    if (products.length > 0) {
      for (const prod of products) {
        if (prod._id) {
          await tagCacheKeyWithProduct(prod._id.toString(), cacheKey, 300);
        }
      }
    }

    res.status(200).json({ success: true, ...result });
  } catch (error: unknown) {
    console.error("Get all products error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to query products.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

/**
 * [READ ONE] Detailed product inspection by slug.
 *
 * PERFORMANCE: Replaces the per-variant for-loop (which fired 3 queries per variant)
 * with a single batched $in query for all variant IDs, then joins inventory + pricing
 * in one aggregation pass — reducing from ~20 queries to ~4.
 */
export async function getProductBySlug(req: Request, res: Response): Promise<void> {
  try {
    const { slug } = req.params;
    const cacheKey = `product:slug:${slug}`;

    // Check cache
    const cachedProduct = await getCache<Record<string, unknown>>(cacheKey);
    if (cachedProduct) {
      res.status(200).json({ success: true, fromCache: true, product: cachedProduct });
      return;
    }

    // ── 1. Fetch product with category + brand populated ───────────────────────
    const product = await Product.findOne({ slug: slug as string, status: "active", moderationStatus: "approved" })
      .populate("categoryId", "name slug")
      .populate("brandId", "name slug")
      .populate({ path: "sellerId", select: "businessName ratingAverage totalSales businessEmail" })
      .lean();

    if (!product) {
      res.status(404).json({ success: false, message: "Product not found." });
      return;
    }

    // ── 2. Fetch images and all variants in parallel ───────────────────────────
    const [images, variants] = await Promise.all([
      ProductImage.find({ catalogProductId: product._id }).sort({ sortOrder: 1 }).lean(),
      ProductVariant.find({ catalogProductId: product._id }).lean(),
    ]);

    const variantIds = variants.map(v => v._id);

    // ── 3. Fetch ALL listings for ALL variants in ONE query ────────────────────
    const allListings = await SellerListing.find({ variantId: { $in: variantIds }, status: "active" })
      .populate({ path: "sellerId", select: "businessName ratingAverage totalSales businessEmail" })
      .lean();

    const listingIds = allListings.map(l => l._id);

    // ── 4. Fetch inventory + pricing for all listings in ONE query each ─────────
    // Both are fired in parallel — no sequential dependency.
    const [inventories, pricingHistory] = await Promise.all([
      ListingInventory.find({ listingId: { $in: listingIds } }).lean(),
      ListingPricingHistory.find({ listingId: { $in: listingIds } })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    // ── 5. Build lookup maps for O(1) access during assembly ──────────────────
    // listingId → inventory record
    const inventoryByListing = new Map<string, number>();
    for (const inv of inventories) {
      inventoryByListing.set(inv.listingId.toString(), inv.availableQuantity);
    }

    // listingId → latest pricing (already sorted newest-first from DB)
    const latestPricingByListing = new Map<string, { sellingPricePaise: number; mrpPaise: number }>();
    for (const pricing of pricingHistory) {
      const key = pricing.listingId.toString();
      // Only keep the first (newest) seen per listing since sorted by createdAt DESC
      if (!latestPricingByListing.has(key)) {
        latestPricingByListing.set(key, {
          sellingPricePaise: pricing.sellingPricePaise,
          mrpPaise: pricing.mrpPaise,
        });
      }
    }

    // variantId → listings[]
    const listingsByVariant = new Map<string, typeof allListings>();
    for (const listing of allListings) {
      const key = listing.variantId.toString();
      if (!listingsByVariant.has(key)) listingsByVariant.set(key, []);
      listingsByVariant.get(key)!.push(listing);
    }

    // ── 6. Assemble variant objects ────────────────────────────────────────────
    let lowestPriceAcrossVariants = Infinity;
    let bestMrpAcrossVariants: number | undefined;
    let totalAvailableInventory = 0;
    let primarySellerInfo: unknown = product.sellerId;

    const variantObjects = variants.map(v => {
      const vListings = listingsByVariant.get(v._id.toString()) ?? [];
      let variantTotalInventory = 0;
      let variantLowestPrice = Infinity;
      let variantBestMrp: number | undefined;

      const listingDetails = vListings.map(l => {
        const available = inventoryByListing.get(l._id.toString()) ?? 0;
        variantTotalInventory += available;
        totalAvailableInventory += available;

        const pricing = latestPricingByListing.get(l._id.toString());
        const price = pricing?.sellingPricePaise ?? 0;
        const mrp = pricing?.mrpPaise ?? price;

        if (pricing && price < variantLowestPrice) {
          variantLowestPrice = price;
          variantBestMrp = mrp;
        }
        if (pricing && price < lowestPriceAcrossVariants) {
          lowestPriceAcrossVariants = price;
          bestMrpAcrossVariants = mrp;
          primarySellerInfo = l.sellerId;
        }

        return { ...l, availableQuantity: available, pricePaise: price, comparePricePaise: mrp };
      });

      const attrs = v.variantAttributes || {};
      return {
        ...v,
        pricePaise: variantLowestPrice !== Infinity ? variantLowestPrice : 0,
        comparePricePaise: variantBestMrp,
        inventory: variantTotalInventory,
        listings: listingDetails,
        // Legacy compatibility fields
        option1: attrs.option1 || attrs.size || "",
        option2: attrs.option2 || attrs.color || "",
        option3: attrs.option3 || attrs.style || "",
      };
    });

    // ── 7. Compose final response ──────────────────────────────────────────────
    const productDetails = {
      ...product,
      images,
      variants: variantObjects,
      pricePaise: lowestPriceAcrossVariants !== Infinity ? lowestPriceAcrossVariants : 0,
      comparePricePaise: bestMrpAcrossVariants,
      inventory: totalAvailableInventory,
      brand: product.brandId ? (product.brandId as unknown as { name: string }).name : "",
      sellerId: primarySellerInfo,
    };

    // Cache the detail result (TTL: 10 minutes = 600 seconds)
    await setCache(cacheKey, productDetails, 600);

    res.status(200).json({ success: true, product: productDetails });
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

    // Invalidate precise cached listing pages that contain this product, plus the slug cache
    await invalidateProductCache(product._id.toString(), product.slug);

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

    // 3. Perform cascading deletions in parallel for speed
    await Promise.all([
      Product.findByIdAndDelete(id),
      ProductImage.deleteMany({ catalogProductId: id }),
      ProductVariant.deleteMany({ catalogProductId: id }),
      SellerListing.deleteMany({ variantId: { $in: variantIds } }),
      ListingInventory.deleteMany({ listingId: { $in: listingIds } }),
      ListingPricingHistory.deleteMany({ listingId: { $in: listingIds } }),
    ]);

    // Invalidate precise cached listing pages that contain this product, plus the slug cache
    await invalidateProductCache(id, product.slug);

    res.status(200).json({
      success: true,
      message: "Product and associated variants/images/listings deleted successfully.",
    });
  } catch (error: unknown) {
    console.error("Delete product error:", error);
    res.status(500).json({ success: false, message: "Failed to delete product." });
  }
}

/**
 * [READ BRANDS] Public endpoint returning all verified brands
 * (either registered system brands or seller custom brands approved by admins).
 */
export async function getVerifiedBrands(req: Request, res: Response): Promise<void> {
  try {
    const brands = await Brand.find({
      $or: [{ isVerified: true }, { createdBy: null }],
    }).sort({ name: 1 });

    res.status(200).json({
      success: true,
      brands,
    });
  } catch (error) {
    console.error("Get verified brands error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch verified brands catalog." });
  }
}
