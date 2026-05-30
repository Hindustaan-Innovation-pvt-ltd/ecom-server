import { Router } from "express";
import { authenticateUser, requireRoles } from "../middleware/auth.js";
import {
  createReview,
  getProductReviews,
  voteHelpfulReview,
  deleteReview,
  updateReviewStatus,
  createQuestion,
  getProductQuestions,
  deleteQuestion,
  updateQuestionStatus,
  createAnswer,
  getQuestionAnswers,
  deleteAnswer,
  voteHelpfulAnswer,
} from "../controller/reviewAndQA.js";

const router = Router();

// ==========================================
// 1. REVIEWS ENDPOINTS
// ==========================================
// POST /api/product/:id/reviews       — Submit a product review (Authenticated)
router.post("/product/:id/reviews", authenticateUser, createReview);
// GET  /api/product/:id/reviews       — Paginated approved reviews for a product (Public)
router.get("/product/:id/reviews", getProductReviews);
// POST /api/reviews/:reviewId/helpful — Increment helpful-vote counter on a review (Authenticated)
router.post("/reviews/:reviewId/helpful", authenticateUser, voteHelpfulReview);
// DELETE /api/reviews/:reviewId       — Delete a review and its media (Owner or Admin)
router.delete("/reviews/:reviewId", authenticateUser, deleteReview);
// PUT /api/reviews/:reviewId/status   — Admin: set review status (approved|hidden|pending)
router.put("/reviews/:reviewId/status", authenticateUser, requireRoles("admin"), updateReviewStatus);

// ==========================================
// 2. Q&A ENDPOINTS
// ==========================================
// POST /api/product/:id/questions      — Post a question on a product (Authenticated)
router.post("/product/:id/questions", authenticateUser, createQuestion);
// GET  /api/product/:id/questions      — Paginated approved questions for a product (Public)
router.get("/product/:id/questions", getProductQuestions);
// DELETE /api/question/:questionId     — Delete a question + cascade-delete its answers (Owner or Admin)
router.delete("/question/:questionId", authenticateUser, deleteQuestion);
// PUT /api/question/:questionId/status — Admin: set question status (approved|hidden|pending)
router.put("/question/:questionId/status", authenticateUser, requireRoles("admin"), updateQuestionStatus);

// POST /api/question/:questionId/answers — Post an answer to a question (Authenticated)
router.post("/question/:questionId/answers", authenticateUser, createAnswer);
// GET  /api/question/:questionId/answers — Paginated answers sorted by helpfulness (Public)
router.get("/question/:questionId/answers", getQuestionAnswers);
// DELETE /api/answers/:answerId          — Delete an answer (Owner or Admin)
router.delete("/answers/:answerId", authenticateUser, deleteAnswer);
// POST /api/answers/:answerId/helpful    — Increment helpful-vote counter on an answer (Authenticated)
router.post("/answers/:answerId/helpful", authenticateUser, voteHelpfulAnswer);

export default router;
