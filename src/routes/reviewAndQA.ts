import { Router } from "express";
import { authenticateUser } from "../middleware/auth.js";
import {
  createReview,
  getProductReviews,
  voteHelpfulReview,
  createQuestion,
  getProductQuestions,
  createAnswer,
  getQuestionAnswers,
} from "../controller/reviewAndQA.js";

const router = Router();

// ==========================================
// 1. REVIEWS ENDPOINTS
// ==========================================
router.post("/product/:id/reviews", authenticateUser, createReview);
router.get("/product/:id/reviews", getProductReviews);
router.post("/reviews/:reviewId/helpful", authenticateUser, voteHelpfulReview);

// ==========================================
// 2. Q&A ENDPOINTS
// ==========================================
router.post("/product/:id/questions", authenticateUser, createQuestion);
router.get("/product/:id/questions", getProductQuestions);

router.post("/question/:questionId/answers", authenticateUser, createAnswer);
router.get("/question/:questionId/answers", getQuestionAnswers);

export default router;
