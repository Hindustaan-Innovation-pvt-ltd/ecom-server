import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Category, type ICategory } from "../models/category.js";
import { Product } from "../models/product.js";
import { getCache, setCache, deleteCache } from "../utils/redis.js";
import { slugify } from "../utils/slugify.js";

export async function createCategory(req: Request, res: Response): Promise<void> {
  try {
    const { name, imageUrl, parentId, sortOrder, isActive } = req.body;
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
      isActive: isActive !== undefined ? isActive : true,
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

/**
 * [READ ONE] Retrieves a single category by its ID. (Public)
 */
export async function getCategoryById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id || typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: "Invalid category ID." });
      return;
    }

    const category = await Category.findById(id).populate("parentId", "name slug").lean();
    if (!category) {
      res.status(404).json({ success: false, message: "Category not found." });
      return;
    }

    res.status(200).json({ success: true, category });
  } catch (error: unknown) {
    console.error("Get category by ID error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch category." });
  }
}

/**
 * [UPDATE] Edits category metadata — name, imageUrl, sortOrder, isActive. (Admin Only)
 * Re-slugifies if the name changes and ensures uniqueness.
 */
export async function updateCategory(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { name, imageUrl, sortOrder, isActive } = req.body;

    if (!id || typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: "Invalid category ID." });
      return;
    }

    const category = await Category.findById(id);
    if (!category) {
      res.status(404).json({ success: false, message: "Category not found." });
      return;
    }

    if (name && name !== category.name) {
      const newSlug = slugify(name);
      const duplicate = await Category.findOne({ slug: newSlug, _id: { $ne: id } });
      if (duplicate) {
        res.status(400).json({ success: false, message: "A category with this name already exists." });
        return;
      }
      category.name = name.trim();
      category.slug = newSlug;
    }

    if (imageUrl !== undefined) category.imageUrl = imageUrl;
    if (sortOrder !== undefined) category.sortOrder = Number(sortOrder);
    if (typeof isActive === "boolean") category.isActive = isActive;

    await category.save();

    // Invalidate categories list cache
    await deleteCache("categories:all");

    res.status(200).json({ success: true, message: "Category updated successfully.", category });
  } catch (error: unknown) {
    console.error("Update category error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to update category.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

/**
 * [DELETE] Soft-deletes a category by setting isActive=false. (Admin Only)
 * Blocked if any PRODUCT documents still reference this category to prevent orphaned data.
 */
export async function deleteCategory(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    if (!id || typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: "Invalid category ID." });
      return;
    }

    const category = await Category.findById(id);
    if (!category) {
      res.status(404).json({ success: false, message: "Category not found." });
      return;
    }

    // Block deletion if products reference this category to avoid orphaning product data
    const productCount = await Product.countDocuments({ categoryId: id });
    if (productCount > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete category "${category.name}" — ${productCount} product(s) are still assigned to it. Reassign or remove those products first.`,
      });
      return;
    }

    // Block if child sub-categories still exist
    const childCount = await Category.countDocuments({ parentId: id, isActive: true });
    if (childCount > 0) {
      res.status(409).json({
        success: false,
        message: `Cannot delete category "${category.name}" — it has ${childCount} active sub-category(ies). Delete those first.`,
      });
      return;
    }

    // Soft delete
    category.isActive = false;
    await category.save();

    // If this was a child, re-check whether parent should be marked as leaf again
    if (category.parentId) {
      const remainingSiblings = await Category.countDocuments({
        parentId: category.parentId,
        isActive: true,
      });
      if (remainingSiblings === 0) {
        await Category.findByIdAndUpdate(category.parentId, { isLeaf: true });
      }
    }

    // Invalidate categories list cache
    await deleteCache("categories:all");

    res.status(200).json({ success: true, message: `Category "${category.name}" deactivated successfully.` });
  } catch (error: unknown) {
    console.error("Delete category error:", error);
    res.status(500).json({ success: false, message: "Failed to delete category." });
  }
}
