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
  deleteBrand,
} from "../controller/seller.js";
import { uploadProfilePic } from "../middleware/upload.js";
import { authenticateUser, requireRoles, requireApprovedSeller } from "../middleware/auth.js";

const router = Router();

// ==========================================
// 1. SELLER REGISTRATION (Public)
// ==========================================
// Decoupled seller onboarding — creates USER with role "seller" and provisions SELLER record
router.post("/register", uploadProfilePic.single("avatar"), registerSeller);

// ==========================================
// 2. SELLER ANALYTICS DASHBOARD
// ==========================================
// NOTE: Must be declared BEFORE /:id to prevent param route capturing "analytics/dashboard"
router.get(
  "/analytics/dashboard",
  authenticateUser,
  requireRoles("seller"),
  requireApprovedSeller,
  getSellerDashboardAnalytics
);

// ==========================================
// 3. SELLER LISTINGS CRUD
// ==========================================
// NOTE: Must be declared BEFORE /:id to prevent param route capturing "listings"
router.post("/listings", authenticateUser, requireRoles("seller"), requireApprovedSeller, createSellerListing);
router.get("/listings", authenticateUser, requireRoles("seller"), requireApprovedSeller, getMySellerListings);
router.put("/listings/:id", authenticateUser, requireRoles("seller"), requireApprovedSeller, updateSellerListing);
router.delete("/listings/:id", authenticateUser, requireRoles("seller"), requireApprovedSeller, deleteSellerListing);

// ==========================================
// 4. SELLER CUSTOM BRAND REGISTRY
// ==========================================
// NOTE: Must be declared BEFORE /:id to prevent param route capturing "brands"
router.post("/brands", authenticateUser, requireRoles("seller"), requireApprovedSeller, uploadProfilePic.single("logo"), registerBrand);
router.get("/brands", authenticateUser, requireRoles("seller"), requireApprovedSeller, getMyBrands);
router.put("/brands/:id/status", authenticateUser, requireRoles("admin"), updateBrandVerificationStatus);
router.delete("/brands/:id", authenticateUser, requireRoles("seller", "admin"), deleteBrand);

// ==========================================
// 5. SELLER PROFILE (Authenticated Self)
// ==========================================
// NOTE: Must be declared BEFORE /:id to prevent param route capturing "profile"
router.get("/profile", authenticateUser, requireRoles("seller"), getSellerProfile);
router.put("/profile", authenticateUser, requireRoles("seller"), updateSellerProfile);
router.delete("/profile", authenticateUser, requireRoles("seller"), deleteSellerProfile);

// ==========================================
// 6. ADMIN SELLER MANAGEMENT
// ==========================================
router.get("/", authenticateUser, requireRoles("admin"), getAllSellers);

// ==========================================
// 7. WILDCARD PARAM ROUTES (must be LAST)
// ==========================================
// Public route — retrieves public seller contact info by ID
router.get("/:id", getSellerById);
// Admin approval toggle — updates SELLER.approvalStatus (approved | rejected)
router.put("/:id/status", authenticateUser, requireRoles("admin"), updateSellerStatus);
// Admin force-delete SELLER profile and the referenced USER record
router.delete("/:id", authenticateUser, requireRoles("admin"), deleteSellerById);

export default router;
