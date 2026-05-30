import { Router } from "express";
import { authenticateUser, requireRoles, requireApprovedSeller } from "../middleware/auth.js";
import {
  createShippingProfile,
  getShippingProfiles,
  updateShippingProfile,
  deleteShippingProfile,
  createSellerStore,
  getSellerStores,
  findNearbyStores,
  updateSellerStore,
  deleteSellerStore,
} from "../controller/shippingAndStore.js";

const router = Router();

// ==========================================
// 1. SHIPPING PROFILES (Seller / Admin)
// ==========================================
// POST /api/shipping — configure custom logistics rules → saves to SHIPPING_PROFILE collection
router.post("/shipping", authenticateUser, requireRoles("seller"), requireApprovedSeller, createShippingProfile);
// GET  /api/shipping — returns shipping options for caller seller; admins can filter by ?sellerId=
router.get("/shipping", authenticateUser, requireRoles("seller", "admin"), requireApprovedSeller, getShippingProfiles);
// PUT  /api/shipping/:id — update a specific shipping profile (Seller, own only)
router.put("/shipping/:id", authenticateUser, requireRoles("seller"), requireApprovedSeller, updateShippingProfile);
// DELETE /api/shipping/:id — delete a shipping profile (Seller own, or Admin any)
router.delete("/shipping/:id", authenticateUser, requireRoles("seller", "admin"), requireApprovedSeller, deleteShippingProfile);

// ==========================================
// 2. SELLER STORES / WAREHOUSE DEPOTS
// ==========================================
// NOTE: GET /stores/nearby must be declared BEFORE GET /stores to prevent param shadowing
// GET  /api/stores/nearby — public geospatial $near query to find active warehouses within radius
router.get("/stores/nearby", findNearbyStores);
// POST /api/stores — registers a fulfillment center GeoJSON point to SELLER_STORE collection
router.post("/stores", authenticateUser, requireRoles("seller"), requireApprovedSeller, createSellerStore);
// GET  /api/stores — returns active warehouse locations for caller seller; admins can filter by ?sellerId=
router.get("/stores", authenticateUser, requireRoles("seller", "admin"), requireApprovedSeller, getSellerStores);
// PUT  /api/stores/:id — update a store (Seller, own only)
router.put("/stores/:id", authenticateUser, requireRoles("seller"), requireApprovedSeller, updateSellerStore);
// DELETE /api/stores/:id — delete a store (Seller own, or Admin any)
router.delete("/stores/:id", authenticateUser, requireRoles("seller", "admin"), requireApprovedSeller, deleteSellerStore);

export default router;

