import { Router } from "express";
import {
  register,
  login,
  logout,
} from "../controller/auth.js";
import {
  getMe,
  getAllUsers,
  getUserById,
  updateMe,
  updateUserStatus,
  deleteMe,
  deleteUserById,
} from "../controller/user.controller.js";
import { uploadProfilePic } from "../middleware/upload.js";
import { authenticateUser, requireRoles } from "../middleware/auth.js";

const router = Router();

// ==========================================
// 1. CREATE & INITIAL SESSIONS
// ==========================================
router.post("/register", uploadProfilePic.single("avatar"), register);
router.post("/login", uploadProfilePic.none(), login);
router.post("/logout", logout);

// ==========================================
// 2. READ CRUD
// ==========================================
router.get("/me", authenticateUser, getMe);
router.get("/users", authenticateUser, requireRoles("admin"), getAllUsers);
router.get("/users/:id", authenticateUser, getUserById);

// ==========================================
// 3. UPDATE CRUD
// ==========================================
router.put("/me", authenticateUser, uploadProfilePic.single("avatar"), updateMe);
router.put("/users/:id/status", authenticateUser, requireRoles("admin"), updateUserStatus);

// ==========================================
// 4. DELETE CRUD
// ==========================================
router.delete("/me", authenticateUser, deleteMe);
router.delete("/users/:id", authenticateUser, requireRoles("admin"), deleteUserById);

export default router;
