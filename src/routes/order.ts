import { Router } from "express";
import {
  placeOrder,
  getMyOrders,
  getOrderById,
  cancelOrder,
  getSellerOrders,
  updateOrderStatus,
} from "../controller/order.js";

const router = Router();

// Customer routes
router.post("/", placeOrder);
router.get("/", getMyOrders);
router.get("/seller", getSellerOrders);
router.get("/:orderId", getOrderById);
router.post("/:orderId/cancel", cancelOrder);

// Seller / Admin route
router.patch("/:orderId/status", updateOrderStatus);

export default router;
