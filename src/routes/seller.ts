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
} from "../controller/seller.js";
import { uploadProfilePic } from "../middleware/upload.js";
import { authenticateUser, requireRoles } from "../middleware/auth.js";

const router = Router();

// ==========================================
// 1. CREATE CRUD
// ==========================================
router.post("/register", uploadProfilePic.single("avatar"), registerSeller);

// ==========================================
// 2. READ CRUD
// ==========================================
router.get("/profile", authenticateUser, requireRoles("seller"), getSellerProfile);
router.get("/", authenticateUser, requireRoles("admin"), getAllSellers); // Admin listing of all sellers
router.get("/:id", getSellerById); // Public seller business details

// ==========================================
// 3. UPDATE CRUD
// ==========================================
router.put("/profile", authenticateUser, requireRoles("seller"), updateSellerProfile);
router.put("/:id/status", authenticateUser, requireRoles("admin"), updateSellerStatus); // Admin approval toggle

// ==========================================
// 4. DELETE CRUD
// ==========================================
router.delete("/profile", authenticateUser, requireRoles("seller"), deleteSellerProfile);
router.delete("/:id", authenticateUser, requireRoles("admin"), deleteSellerById);

export default router;
