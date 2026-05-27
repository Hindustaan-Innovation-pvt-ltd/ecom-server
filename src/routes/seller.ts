import { Router } from "express";
import {
  registerSeller,
  getSellerProfile,
  getAllSellers,
  getSellerById,
  updateSellerProfile,
  updateSellerStatus,
  deleteSellerProfile,
  deleteSellerById,
  getSellerDashboardAnalytics,
  createSellerListing,
  getMySellerListings,
  updateSellerListing,
  deleteSellerListing,
  registerBrand,
  getMyBrands,
  updateBrandVerificationStatus,
} from "../controller/seller.js";
import { uploadProfilePic } from "../middleware/upload.js";
import { authenticateUser, requireRoles } from "../middleware/auth.js";

const router = Router();

// ==========================================
// 1. CREATE CRUD
// ==========================================
router.post("/register", uploadProfilePic.single("avatar"), registerSeller);

// ==========================================
// 2. READ CRUD
// ==========================================
router.get("/profile", authenticateUser, requireRoles("seller"), getSellerProfile);
router.get("/", authenticateUser, requireRoles("admin"), getAllSellers); // Admin listing of all sellers
router.get("/:id", getSellerById); // Public seller business details

// ==========================================
// 3. UPDATE CRUD
// ==========================================
router.put("/profile", authenticateUser, requireRoles("seller"), updateSellerProfile);
router.put("/:id/status", authenticateUser, requireRoles("admin"), updateSellerStatus); // Admin approval toggle

// ==========================================
// 4. DELETE CRUD
// ==========================================
router.delete("/profile", authenticateUser, requireRoles("seller"), deleteSellerProfile);
router.delete("/:id", authenticateUser, requireRoles("admin"), deleteSellerById);

// ==========================================
// 5. SELLER ANALYTICS DASHBOARD
// ==========================================
router.get("/analytics/dashboard", authenticateUser, requireRoles("seller"), getSellerDashboardAnalytics);

// ==========================================
// 6. SELLER LISTINGS CRUD
// ==========================================
router.post("/listings", authenticateUser, requireRoles("seller"), createSellerListing);
router.get("/listings", authenticateUser, requireRoles("seller"), getMySellerListings);
router.put("/listings/:id", authenticateUser, requireRoles("seller"), updateSellerListing);
router.delete("/listings/:id", authenticateUser, requireRoles("seller"), deleteSellerListing);

// ==========================================
// 7. SELLER CUSTOM BRAND REGISTRY
// ==========================================
router.post("/brands", authenticateUser, requireRoles("seller"), uploadProfilePic.single("logo"), registerBrand);
router.get("/brands", authenticateUser, requireRoles("seller"), getMyBrands);
router.put("/brands/:id/status", authenticateUser, requireRoles("admin"), updateBrandVerificationStatus);

export default router;
