import type { Request, Response } from "express";
import { Category, type ICategory } from "../models/category.js";
import { getCache, setCache, deleteCache } from "../utils/redis.js";
import { slugify } from "../utils/slugify.js";

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
  } catch (error: unknown) {
    console.error("Create category error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to create category.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

export async function getAllCategories(_req: Request, res: Response): Promise<void> {
  try {
    // Attempt cache read
    const cachedCategories = await getCache<ICategory[]>("categories:all");
    if (cachedCategories) {
      res.status(200).json({ success: true, fromCache: true, categories: cachedCategories });
      return;
    }

    const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });

    // Save to cache (TTL: 1 hour = 3600 seconds)
    await setCache("categories:all", categories, 3600);

    res.status(200).json({ success: true, categories });
  } catch (error: unknown) {
    console.error("Get all categories error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
}
