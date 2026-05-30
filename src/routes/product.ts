import { Router } from "express";
import {
  createCategory,
  getAllCategories,
  getCategoryById,
  updateCategory,
  deleteCategory,
} from "../controller/category.js";
import {
  createProduct,
  getAllProducts,
  getProductBySlug,
  updateProduct,
  deleteProduct,
  getVerifiedBrands,
} from "../controller/product.js";
import {
  uploadProductImages,
  deleteProductImage,
} from "../controller/productImage.js";
import {
  getProductVariant,
  getProductVariants,
  createProductVariant,
  updateProductVariant,
  deleteProductVariant,
} from "../controller/productVariant.js";
import { uploadProfilePic } from "../middleware/upload.js";
import { authenticateUser, requireRoles, requireApprovedSeller } from "../middleware/auth.js";

const router = Router();

// ==========================================
// 1. PRODUCT CATEGORIES (Admin/Public)
// ==========================================
// NOTE: Static paths declared BEFORE /:id wildcard to prevent capture conflicts
router.post("/categories", authenticateUser, requireRoles("admin"), createCategory);
router.get("/categories", getAllCategories);
// NOTE: Static /categories before /:id — category-level param routes MUST also come before product /:id
router.get("/categories/:id", getCategoryById);
router.put("/categories/:id", authenticateUser, requireRoles("admin"), updateCategory);
router.delete("/categories/:id", authenticateUser, requireRoles("admin"), deleteCategory);

// ==========================================
// 2. VERIFIED BRANDS (Public)
// ==========================================
// NOTE: Must be before /:id to prevent wildcard capture of "brands"
router.get("/brands", getVerifiedBrands);

// ==========================================
// 3. PRODUCT SLUG LOOKUP (Public)
// ==========================================
// NOTE: Must be before /:id to prevent wildcard capture of "slug"
router.get("/slug/:slug", getProductBySlug);

// ==========================================
// 4. PRODUCT IMAGES CRUD (Seller Only)
// ==========================================
// NOTE: DELETE /images/:imageId must come before DELETE /:id to avoid param capture
// Supports up to 10 array image uploads on field name "images"
router.post("/:id/images", authenticateUser, requireRoles("seller"), requireApprovedSeller, uploadProfilePic.array("images", 10), uploadProductImages);
router.delete("/images/:imageId", authenticateUser, requireRoles("seller"), requireApprovedSeller, deleteProductImage);

// ==========================================
// 5. PRODUCT VARIANTS CRUD (Seller/Authenticated)
// ==========================================
// NOTE: /variants/:id and /variants/:variantId must be before /:id to avoid param capture
router.get("/variants/:id", authenticateUser, getProductVariant);
router.put("/variants/:variantId", authenticateUser, requireRoles("seller"), requireApprovedSeller, updateProductVariant);
router.delete("/variants/:variantId", authenticateUser, requireRoles("seller"), requireApprovedSeller, deleteProductVariant);

// ==========================================
// 6. PRODUCT CRUD — Param Routes (Seller/Public)
// ==========================================
// NOTE: Wildcard param routes are always declared LAST to avoid shadowing static paths above
router.post("/", authenticateUser, requireRoles("seller"), requireApprovedSeller, createProduct);
router.get("/", getAllProducts);
router.put("/:id", authenticateUser, requireRoles("seller"), requireApprovedSeller, updateProduct);
router.delete("/:id", authenticateUser, requireRoles("seller", "admin"), requireApprovedSeller, deleteProduct);

// ==========================================
// 7. PRODUCT VARIANTS by PRODUCT ID (Authenticated)
// ==========================================
// NOTE: /:id/variants is safe after the non-param routes above — Express uses the full path
router.get("/:id/variants", authenticateUser, getProductVariants);
router.post("/:id/variants", authenticateUser, requireRoles("seller"), requireApprovedSeller, createProductVariant);

export default router;
