import { Router } from "express";
import { handleChat } from "../controller/chat.js";
import { authenticateUser } from "../middleware/auth.js";

const router = Router();

// Endpoint for AI chatbot
router.post("/", authenticateUser, handleChat);

export default router;
