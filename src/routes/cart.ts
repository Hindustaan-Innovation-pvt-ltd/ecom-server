import { Router } from "express";
import {
  getCart,
  syncCart,
  clearCart,
  applyCartCoupon,
  addItemToCart,
  removeCartCoupon,
} from "../controller/cart.js";
import { authenticateUser, requireRoles } from "../middleware/auth.js";

const router = Router();

// All cart routes require active session authentication
router.use(authenticateUser);
router.use(requireRoles("customer", "seller", "admin"));

// Persistent Cart endpoints
router.get("/", getCart);
router.post("/add", addItemToCart);
router.post("/sync", syncCart);
router.delete("/", clearCart);

// Cart Coupon endpoints
router.post("/coupon", applyCartCoupon);
router.delete("/coupon", removeCartCoupon);

export default router;
