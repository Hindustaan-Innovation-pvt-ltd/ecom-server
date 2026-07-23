import { Router } from "express";
import { authenticateUser, requireRoles } from "../middleware/auth.js";
import {
  createExpense,
  getExpenses,
  getExpensesAndRevenueSummary,
  getAuditLogs,
  getPendingModerationProducts,
  bulkModerateProducts,
  getAllBrandsAdmin,
  updateBrandStatusAdmin,
  uploadImageAdmin,
} from "../controller/admin.js";
import { uploadProfilePic } from "../middleware/upload.js";

const router = Router();

// Apply administrative authentication and authorization checks globally across all endpoints
router.use(authenticateUser, requireRoles("admin"));

// ==========================================
// 1. PLATFORM EXPENSES & REVENUE
// ==========================================
// NOTE: GET /expenses/summary must be declared BEFORE GET /expenses to prevent path capture
// GET  /api/admin/expenses/summary — aggregates order revenues vs expenses to compute net profit margins
router.get("/expenses/summary", getExpensesAndRevenueSummary);
// POST /api/admin/expenses   — saves an administrative operational platform expense
router.post("/expenses", createExpense);
// GET  /api/admin/expenses   — returns paginated platform expenses, filterable by date and category
router.get("/expenses", getExpenses);

// ==========================================
// 2. AUDIT LOGS
// ==========================================
// GET  /api/admin/audit-logs — lists platform operations admin audit logs
router.get("/audit-logs", getAuditLogs);

// ==========================================
// 3. CATALOG BULK MODERATION
// ==========================================
// GET  /api/admin/moderation/products      — paginated list of catalog products awaiting moderation
router.get("/moderation/products", getPendingModerationProducts);
// POST /api/admin/moderation/products/bulk — batch approve, reject, or hide products; queues seller notification emails
router.post("/moderation/products/bulk", bulkModerateProducts);

// ==========================================
// 4. BRAND MANAGEMENT
// ==========================================
// GET  /api/admin/brands           — lists all brands on the platform with pagination & filters
router.get("/brands", getAllBrandsAdmin);
// PATCH /api/admin/brands/:id/status — updates the active/inactive and verified status of a brand
router.patch("/brands/:id/status", updateBrandStatusAdmin);

// ==========================================
// 5. ASSET UPLOAD
// ==========================================
// POST /api/admin/upload-image — uploads a single image for admin purposes
router.post("/upload-image", uploadProfilePic.single("image"), uploadImageAdmin);

export default router;
