import { Router } from "express";
import {
  createCategory,
  getAllCategories,
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
router.post("/categories", authenticateUser, requireRoles("admin"), createCategory);
router.get("/categories", getAllCategories);
router.get("/brands", getVerifiedBrands);

// ==========================================
// 2. PRODUCT CRUD (Seller/Public)
// ==========================================
router.post("/", authenticateUser, requireRoles("seller"), requireApprovedSeller, createProduct);
router.get("/", getAllProducts);
router.get("/slug/:slug", getProductBySlug);
router.put("/:id", authenticateUser, requireRoles("seller"), requireApprovedSeller, updateProduct);
router.delete("/:id", authenticateUser, requireRoles("seller", "admin"), requireApprovedSeller, deleteProduct);

// ==========================================
// 3. PRODUCT IMAGES CRUD (Seller Only)
// ==========================================
// Supports up to 10 array image uploads on field name "images"
router.post("/:id/images", authenticateUser, requireRoles("seller"), requireApprovedSeller, uploadProfilePic.array("images", 10), uploadProductImages);
router.delete("/images/:imageId", authenticateUser, requireRoles("seller"), requireApprovedSeller, deleteProductImage);

// ==========================================
// 4. PRODUCT VARIANTS CRUD (Seller Only)
// ==========================================
router.get("/variants/:id", authenticateUser, getProductVariant);
router.get("/:id/variants", authenticateUser, getProductVariants);
router.post("/:id/variants", authenticateUser, requireRoles("seller"), requireApprovedSeller, createProductVariant);
router.put("/variants/:variantId", authenticateUser, requireRoles("seller"), requireApprovedSeller, updateProductVariant);
router.delete("/variants/:variantId", authenticateUser, requireRoles("seller"), requireApprovedSeller, deleteProductVariant);

export default router;
