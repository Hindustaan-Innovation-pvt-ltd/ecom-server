import { Router } from "express";
import { authenticateUser, requireRoles, requireApprovedSeller } from "../middleware/auth.js";
import {
  createShippingProfile,
  getShippingProfiles,
  createSellerStore,
  getSellerStores,
  findNearbyStores,
} from "../controller/shippingAndStore.js";

const router = Router();

// ==========================================
// 1. SHIPPING ENDPOINTS
// ==========================================
router.post("/shipping", authenticateUser, requireRoles("seller"), requireApprovedSeller, createShippingProfile);
router.get("/shipping", authenticateUser, requireRoles("seller", "admin"), requireApprovedSeller, getShippingProfiles);

// ==========================================
// 2. STORE/WAREHOUSE ENDPOINTS
// ==========================================
router.post("/stores", authenticateUser, requireRoles("seller"), requireApprovedSeller, createSellerStore);
router.get("/stores", authenticateUser, requireRoles("seller", "admin"), requireApprovedSeller, getSellerStores);
router.get("/stores/nearby", findNearbyStores);

export default router;
