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
} from "../controller/product.js";
import {
  uploadProductImages,
  deleteProductImage,
} from "../controller/productImage.js";
import {
  createProductVariant,
  updateProductVariant,
  deleteProductVariant,
} from "../controller/productVariant.js";
import { uploadProfilePic } from "../middleware/upload.js";
import { authenticateUser, requireRoles } from "../middleware/auth.js";

const router = Router();

// ==========================================
// 1. PRODUCT CATEGORIES (Admin/Public)
// ==========================================
router.post("/categories", authenticateUser, requireRoles("admin"), createCategory);
router.get("/categories", getAllCategories);

// ==========================================
// 2. PRODUCT CRUD (Seller/Public)
// ==========================================
router.post("/", authenticateUser, requireRoles("seller"), createProduct);
router.get("/", getAllProducts);
router.get("/slug/:slug", getProductBySlug);
router.put("/:id", authenticateUser, requireRoles("seller"), updateProduct);
router.delete("/:id", authenticateUser, requireRoles("seller", "admin"), deleteProduct);

// ==========================================
// 3. PRODUCT IMAGES CRUD (Seller Only)
// ==========================================
// Supports up to 10 array image uploads on field name "images"
router.post("/:id/images", authenticateUser, requireRoles("seller"), uploadProfilePic.array("images", 10), uploadProductImages);
router.delete("/images/:imageId", authenticateUser, requireRoles("seller"), deleteProductImage);

// ==========================================
// 4. PRODUCT VARIANTS CRUD (Seller Only)
// ==========================================
router.post("/:id/variants", authenticateUser, requireRoles("seller"), createProductVariant);
router.put("/variants/:variantId", authenticateUser, requireRoles("seller"), updateProductVariant);
router.delete("/variants/:variantId", authenticateUser, requireRoles("seller"), deleteProductVariant);

export default router;
