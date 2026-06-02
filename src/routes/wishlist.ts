import { Router } from "express";
import {
	getWishlist,
	addItemToWishlist,
	removeItemFromWishlist,
	clearWishlist,
} from "../controller/wishlist.js";
import { authenticateUser, requireRoles } from "../middleware/auth.js";

const router = Router();

// All wishlist routes require active session or token authentication
router.use(authenticateUser);
router.use(requireRoles("customer", "seller", "admin"));

// Wishlist endpoints
router.get("/", getWishlist);
router.post("/add", addItemToWishlist);
router.delete("/:productId", removeItemFromWishlist);
router.delete("/", clearWishlist);

export default router;
