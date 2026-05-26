import { Router } from "express";
import { authenticateUser, requireRoles } from "../middleware/auth.js";
import {
  createShippingProfile,
  getShippingProfiles,
  createSellerStore,
  getSellerStores,
} from "../controller/shippingAndStore.js";

const router = Router();

// ==========================================
// 1. SHIPPING ENDPOINTS
// ==========================================
router.post("/shipping", authenticateUser, requireRoles("seller"), createShippingProfile);
router.get("/shipping", authenticateUser, requireRoles("seller"), getShippingProfiles);

// ==========================================
// 2. STORE/WAREHOUSE ENDPOINTS
// ==========================================
router.post("/stores", authenticateUser, requireRoles("seller"), createSellerStore);
router.get("/stores", authenticateUser, requireRoles("seller"), getSellerStores);

export default router;
