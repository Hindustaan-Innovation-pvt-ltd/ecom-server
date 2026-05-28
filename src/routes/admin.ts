import { Router } from "express";
import { authenticateUser, requireRoles } from "../middleware/auth.js";
import {
  createExpense,
  getExpenses,
  getExpensesAndRevenueSummary,
  getAuditLogs,
  getPendingModerationProducts,
  bulkModerateProducts,
} from "../controller/admin.js";

const router = Router();

// Apply administrative authentication and authorization checks globally across all endpoints
router.use(authenticateUser, requireRoles("admin"));

// ==========================================
// 1. DYNAMIC EXPENSES & REVENUES ENDPOINTS
// ==========================================
router.post("/expenses", createExpense);
router.get("/expenses", getExpenses);
router.get("/expenses/summary", getExpensesAndRevenueSummary);

// ==========================================
// 2. AUDIT LOGS ENDPOINTS
// ==========================================
router.get("/audit-logs", getAuditLogs);

// ==========================================
// 3. CATALOG BULK MODERATION ENDPOINTS
// ==========================================
router.get("/moderation/products", getPendingModerationProducts);
router.post("/moderation/products/bulk", bulkModerateProducts);

export default router;
