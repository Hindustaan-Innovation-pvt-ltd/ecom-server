import { Router } from "express";
import {
  createAddress,
  getMyAddresses,
  getAddressById,
  updateAddress,
  deleteAddress,
} from "../controller/address.js";
import { authenticateUser } from "../middleware/auth.js";

const router = Router();

// All address routes require a valid active session
router.use(authenticateUser);

// CRUD address endpoints
router.post("/", createAddress);
router.get("/", getMyAddresses);
router.get("/:id", getAddressById);
router.put("/:id", updateAddress);
router.delete("/:id", deleteAddress);

export default router;
