import { Router } from "express";
import {
  createCoupon,
  getMyCoupons,
  deleteCoupon,
  validateCoupon,
} from "../controller/coupon.js";
import { authenticateUser, requireRoles, requireApprovedSeller } from "../middleware/auth.js";

const router = Router();

// Seller-only Coupon campaign management
router.post("/", authenticateUser, requireRoles("seller"), requireApprovedSeller, createCoupon);
router.get("/my", authenticateUser, requireRoles("seller"), requireApprovedSeller, getMyCoupons);
router.delete("/:id", authenticateUser, requireRoles("seller"), requireApprovedSeller, deleteCoupon);

// Customer-facing Coupon validation
router.post("/validate", authenticateUser, validateCoupon);

export default router;
