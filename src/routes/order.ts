import { Router } from "express";
import {
  placeOrder,
  getMyOrders,
  getOrderById,
  cancelOrder,
  getSellerOrders,
  updateOrderStatus,
  getAllOrdersAdmin,
} from "../controller/order.js";
import { authenticateUser } from "../middleware/auth.js";

const router = Router();

// Enforce authentication across all order management routes
router.use(authenticateUser);

// Customer routes
router.post("/", placeOrder);
router.get("/", getMyOrders);
// NOTE: /all and /seller must be before /:orderId to prevent param route capture
router.get("/all", getAllOrdersAdmin); // Admin: all platform orders with filters
router.get("/seller", getSellerOrders);
router.get("/:orderId", getOrderById);
router.post("/:orderId/cancel", cancelOrder);

// Seller / Admin route
router.patch("/:orderId/status", updateOrderStatus);

export default router;
