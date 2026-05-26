import { Router } from "express";
import { authenticateUser, requireRoles } from "../middleware/auth.js";
import {
  createSubscription,
  getMySubscriptions,
  deleteSubscription,
} from "../controller/webhook.js";

const router = Router();

// Outgoing webhook subscriptions are available to active sellers and admins
router.post(
  "/",
  authenticateUser,
  requireRoles("seller", "admin"),
  createSubscription
);

router.get(
  "/",
  authenticateUser,
  requireRoles("seller", "admin"),
  getMySubscriptions
);

router.delete(
  "/:id",
  authenticateUser,
  requireRoles("seller", "admin"),
  deleteSubscription
);

export default router;
