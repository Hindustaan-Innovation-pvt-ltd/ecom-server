import { Router } from "express";
import {
  getCart,
  syncCart,
  clearCart,
  applyCartCoupon,
  removeCartCoupon,
} from "../controller/cart.js";
import { authenticateUser, requireRoles } from "../middleware/auth.js";

const router = Router();

// All cart routes require active session authentication and customer role-based access control
router.use(authenticateUser);
router.use(requireRoles("customer"));

// Persistent Cart endpoints
router.get("/", getCart);
router.post("/sync", syncCart);
router.delete("/", clearCart);

// Cart Coupon endpoints
router.post("/coupon", applyCartCoupon);
router.delete("/coupon", removeCartCoupon);

export default router;
