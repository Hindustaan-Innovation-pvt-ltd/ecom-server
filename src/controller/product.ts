import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import mongoose from "mongoose";
import { Product } from "../models/product.js";
import { Category } from "../models/category.js";
import { ProductImage } from "../models/productImage.js";
import { ProductVariant } from "../models/productVariant.js";
import type { IUser } from "../models/user.js";
import { uploadToCloudinary } from "../utils/cloudinary.js";
import { redisClient, isRedisActive, getCache, setCache, deleteCache, clearCachePattern } from "../utils/redis.js";
import { productQueue } from "../workers/bullmq.js";

// Helper to slugify category names
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
    const { name, imageUrl } = req.body;
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

    const category = new Category({ name, slug, imageUrl });
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

    const categories = await Category.find({ isActive: true }).sort({ name: 1 });
    
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

    // Rate-Limiter: Check cool-down limit per seller (Scenario 2)
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

    // Streaming: Push product payload to Product Queue for sequential streaming (Scenario 2)
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
    const product = new Product({
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

    await product.save();

    // Invalidate product lists cache
    await clearCachePattern("products:list:*");

    res.status(201).json({
      success: true,
      message: "Product created successfully and is pending moderation.",
      product,
    });
  } catch (error: any) {
    console.error("Create product error:", error);
    res.status(400).json({ success: false, message: error.message || "Failed to create product." });
  }
}

/**
 * [READ LIST] Advanced paginated product query and search.
 */
export async function getAllProducts(req: Request, res: Response): Promise<void> {
  try {
    // Generate a unique cache key based on query parameters
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
      isActive: true,
      moderationStatus: "approved",
    };

    // Filter by Category
    if (categoryId) {
      query.categoryId = categoryId;
    }

    // Filter by Brand
    if (brand) {
      query.brand = brand;
    }

    // Filter by Tag
    if (tag) {
      query.tags = tag;
    }

    // Filter by Price range (INR stored in Paise)
    if (minPrice || maxPrice) {
      query.pricePaise = {};
      if (minPrice) query.pricePaise.$gte = parseInt(minPrice as string, 10);
      if (maxPrice) query.pricePaise.$lte = parseInt(maxPrice as string, 10);
    }

    // Search query on title, description, brand, or tags
    if (search) {
      const searchRegex = new RegExp(search as string, "i");
      query.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { brand: searchRegex },
        { tags: searchRegex },
      ];
    }

    // Pagination
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = parseInt(limit as string, 10) || 10;
    const skipNum = (pageNum - 1) * limitNum;

    // Sorting
    let sortOptions: any = { createdAt: -1 };
    if (sort === "priceAsc") {
      sortOptions = { pricePaise: 1 };
    } else if (sort === "priceDesc") {
      sortOptions = { pricePaise: -1 };
    } else if (sort === "newest") {
      sortOptions = { createdAt: -1 };
    }

    const products = await Product.find(query)
      .populate("categoryId", "name slug")
      .populate({
        path: "sellerId",
        select: "businessName ratingAverage",
      })
      .sort(sortOptions)
      .skip(skipNum)
      .limit(limitNum);

    const total = await Product.countDocuments(query);

    const result = {
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
      products,
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
 * Populates categories, extra photos, and variants!
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

    const product = await Product.findOne({ slug: slug as string, isActive: true, moderationStatus: "approved" })
      .populate("categoryId", "name slug")
      .populate({
        path: "sellerId",
        select: "businessName ratingAverage totalSales businessEmail",
      });

    if (!product) {
      res.status(404).json({ success: false, message: "Product not found." });
      return;
    }

    // Fetch extra images
    const images = await ProductImage.find({ productId: product._id }).sort({ sortOrder: 1 });

    // Fetch variants
    const variants = await ProductVariant.find({ productId: product._id }).sort({ pricePaise: 1 });

    const productDetails = {
      ...product.toObject(),
      images,
      variants,
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
    if (product.sellerId.toString() !== seller._id.toString()) {
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

    if (title) product.title = title;
    if (description) product.description = description;
    if (brand) product.brand = brand;
    if (sku) product.sku = sku;
    if (pricePaise) product.pricePaise = pricePaise;
    if (comparePricePaise !== undefined) product.comparePricePaise = comparePricePaise;
    if (inventory !== undefined) product.inventory = inventory;
    if (typeof isActive === "boolean") product.isActive = isActive;
    
    if (tags) {
      product.tags = Array.isArray(tags) ? tags : String(tags).split(",").map(t => t.trim()).filter(Boolean);
    }

    await product.save();

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
 * Cascades to delete extra photos and variants.
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

    // RBAC: Only Admin or Owner Seller can delete
    if (caller.role !== "admin") {
      if (!seller || product.sellerId.toString() !== seller._id.toString()) {
        res.status(403).json({ success: false, message: "Forbidden. Access denied." });
        return;
      }
    }

    // Delete Product
    await Product.findByIdAndDelete(id);

    // Cascades: Delete linked images and variants
    await ProductImage.deleteMany({ productId: id as string });
    await ProductVariant.deleteMany({ productId: id as string });

    // Invalidate product caches
    await deleteCache(`product:slug:${product.slug}`);
    await clearCachePattern("products:list:*");

    res.status(200).json({
      success: true,
      message: "Product and associated variants/images deleted successfully.",
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
    if (product.sellerId.toString() !== seller._id.toString()) {
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

    // Stream files to Cloudinary and compile models
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
          productId: id,
          imageUrl: finalUrl,
          sortOrder: i,
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
    const product = await Product.findById(image.productId);
    if (!product || product.sellerId.toString() !== seller._id.toString()) {
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

    // Verify ownership
    if (product.sellerId.toString() !== seller._id.toString()) {
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
      productId: id,
      option1,
      option2,
      option3,
      pricePaise,
      inventory,
      sku,
    });

    await variant.save();

    // Invalidate product details cache
    await deleteCache(`product:slug:${product.slug}`);

    res.status(201).json({
      success: true,
      message: "Product variant created successfully.",
      variant,
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
    const product = await Product.findById(variant.productId);
    if (!product || product.sellerId.toString() !== seller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. Access denied." });
      return;
    }

    if (option1) variant.option1 = option1;
    if (option2 !== undefined) variant.option2 = option2;
    if (option3 !== undefined) variant.option3 = option3;
    if (pricePaise !== undefined) variant.pricePaise = pricePaise;
    if (inventory !== undefined) variant.inventory = inventory;
    
    if (sku && sku !== variant.sku) {
      const existingSku = await ProductVariant.findOne({ sku });
      if (existingSku) {
        res.status(400).json({ success: false, message: "A variant with this SKU is already registered." });
        return;
      }
      variant.sku = sku;
    }

    await variant.save();

    // Invalidate product details cache
    if (product) {
      await deleteCache(`product:slug:${product.slug}`);
    }

    res.status(200).json({
      success: true,
      message: "Variant updated successfully.",
      variant,
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
    const product = await Product.findById(variant.productId);
    if (!product || product.sellerId.toString() !== seller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. Access denied." });
      return;
    }

    await ProductVariant.findByIdAndDelete(variantId);

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
