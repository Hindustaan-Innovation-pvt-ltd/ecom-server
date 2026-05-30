import type { Request, Response } from "express";
import mongoose from "mongoose";
import { parsePagination } from "../utils/pagination.js";
import { Review } from "../models/review.js";
import { ReviewMedia } from "../models/reviewMedia.js";
import { ProductQuestion } from "../models/productQuestion.js";
import { ProductAnswer } from "../models/productAnswer.js";
import { Product } from "../models/product.js";
import type { IUser } from "../models/user.js";

// ==========================================
// 1. REVIEWS CRUD & MANAGEMENT
// ==========================================

export async function createReview(req: Request, res: Response): Promise<void> {
  try {
    const catalogProductId = req.params.id as string;
    const caller = req.user as IUser | undefined;
    if (!caller) {
      res.status(401).json({ success: false, message: "Not authenticated." });
      return;
    }

    const { rating, title, comment, variantId, listingId, mediaUrls = [] } = req.body;

    if (!rating || !title || !comment) {
      res.status(400).json({ success: false, message: "Required fields: rating, title, and comment." });
      return;
    }

    const product = await Product.findById(catalogProductId);
    if (!product) {
      res.status(404).json({ success: false, message: "Product not found." });
      return;
    }

    const review = new Review({
      catalogProductId,
      variantId: variantId || null,
      listingId: listingId || null,
      userId: caller._id,
      rating,
      title,
      comment,
      verifiedPurchase: true, // Mock purchase check for testing
    });

    await review.save();

    const savedMedia = [];
    if (Array.isArray(mediaUrls) && mediaUrls.length > 0) {
      for (const url of mediaUrls) {
        const media = new ReviewMedia({
          reviewId: review._id,
          type: "image",
          url,
        });
        await media.save();
        savedMedia.push(media);
      }
    }

    // Refresh product average reviews
    const allReviews = await Review.find({ catalogProductId, status: "approved" });
    if (allReviews.length > 0) {
      const sum = allReviews.reduce((acc, r) => acc + r.rating, 0);
      product.ratingAverage = parseFloat((sum / allReviews.length).toFixed(1));
      product.reviewCount = allReviews.length;
      await product.save();
    }

    res.status(201).json({
      success: true,
      message: "Review submitted successfully.",
      review,
      media: savedMedia,
    });
  } catch (error: unknown) {
    console.error("Create review error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to save review.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

export async function getProductReviews(req: Request, res: Response): Promise<void> {
  try {
    const catalogProductId = req.params.id as string;

    if (!mongoose.Types.ObjectId.isValid(catalogProductId)) {
      res.status(400).json({ success: false, message: "Invalid product ID." });
      return;
    }

    const { page, limit, skip } = parsePagination(req.query);

    // ── 1. Calculate Rating Distribution Statistics ───────────────────────────
    const breakdownAgg = await Review.aggregate([
      {
        $match: {
          catalogProductId: new mongoose.Types.ObjectId(catalogProductId),
          status: "approved",
        },
      },
      {
        $group: {
          _id: "$rating",
          count: { $sum: 1 },
        },
      },
    ]);

    const distribution: Record<number, { count: number; percentage: number }> = {
      1: { count: 0, percentage: 0 },
      2: { count: 0, percentage: 0 },
      3: { count: 0, percentage: 0 },
      4: { count: 0, percentage: 0 },
      5: { count: 0, percentage: 0 },
    };

    let totalReviews = 0;
    let sumRatings = 0;

    for (const item of breakdownAgg) {
      const ratingVal = item._id as number;
      const count = item.count as number;
      const dist = distribution[ratingVal];
      if (dist) {
        dist.count = count;
        totalReviews += count;
        sumRatings += ratingVal * count;
      }
    }

    if (totalReviews > 0) {
      for (let star = 1; star <= 5; star++) {
        const dist = distribution[star];
        if (dist) {
          dist.percentage = parseFloat(
            ((dist.count / totalReviews) * 100).toFixed(1)
          );
        }
      }
    }

    const ratingAverage = totalReviews > 0 
      ? parseFloat((sumRatings / totalReviews).toFixed(2)) 
      : 0;

    // ── 2. Build Query & Filter criteria ──────────────────────────────────────
    const filterQuery: Record<string, unknown> = {
      catalogProductId: new mongoose.Types.ObjectId(catalogProductId),
      status: "approved",
    };

    const ratingParam = req.query.rating;
    if (ratingParam) {
      const parsedRating = parseInt(ratingParam as string, 10);
      if (parsedRating >= 1 && parsedRating <= 5) {
        filterQuery.rating = parsedRating;
      }
    }

    // ── 3. Build Sorting criteria ─────────────────────────────────────────────
    const sortParam = req.query.sort as string;
    let sortQuery: Record<string, 1 | -1> = { createdAt: -1 }; // default: newest

    if (sortParam === "helpful") {
      sortQuery = { helpfulVotes: -1, createdAt: -1 };
    } else if (sortParam === "highest") {
      sortQuery = { rating: -1, createdAt: -1 };
    } else if (sortParam === "lowest") {
      sortQuery = { rating: 1, createdAt: -1 };
    }

    // ── 4. Retrieve matching reviews with media O(1) optimized fetch ───────────
    const [reviews, totalMatching] = await Promise.all([
      Review.find(filterQuery)
        .populate("userId", "fullName avatarUrl")
        .sort(sortQuery as any)
        .skip(skip)
        .limit(limit),
      Review.countDocuments(filterQuery),
    ]);

    const reviewIds = reviews.map((r) => r._id);
    const mediaList = await ReviewMedia.find({ reviewId: { $in: reviewIds } }).lean();

    const mediaMap = new Map<string, typeof mediaList>();
    for (const m of mediaList) {
      const rId = m.reviewId.toString();
      if (!mediaMap.has(rId)) {
        mediaMap.set(rId, []);
      }
      mediaMap.get(rId)!.push(m);
    }

    const reviewObjects = reviews.map((r) => ({
      ...r.toObject(),
      media: mediaMap.get(r._id.toString()) ?? [],
    }));

    res.status(200).json({
      success: true,
      statistics: {
        totalReviews,
        ratingAverage,
        breakdown: distribution,
      },
      reviews: reviewObjects,
      pagination: { 
        page, 
        limit, 
        total: totalMatching, 
        pages: Math.ceil(totalMatching / limit) 
      },
    });
  } catch (error: unknown) {
    console.error("Get product reviews error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch reviews." });
  }
}

export async function voteHelpfulReview(req: Request, res: Response): Promise<void> {
  try {
    const reviewId = req.params.reviewId;

    if (!reviewId || typeof reviewId !== "string" || !mongoose.Types.ObjectId.isValid(reviewId)) {
      res.status(400).json({ success: false, message: "Invalid review ID." });
      return;
    }

    const review = await Review.findByIdAndUpdate(
      reviewId,
      { $inc: { helpfulVotes: 1 } },
      { new: true }
    );

    if (!review) {
      res.status(404).json({ success: false, message: "Review not found." });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Helpful vote recorded successfully.",
      review,
    });
  } catch (error: unknown) {
    console.error("Vote helpful review error:", error);
    res.status(500).json({ success: false, message: "Failed to record helpful vote." });
  }
}

// ==========================================
// 2. PRODUCT Q&A MANAGEMENT
// ==========================================

export async function createQuestion(req: Request, res: Response): Promise<void> {
  try {
    const catalogProductId = req.params.id as string;
    const caller = req.user as IUser | undefined;
    if (!caller) {
      res.status(401).json({ success: false, message: "Not authenticated." });
      return;
    }

    const { question } = req.body;
    if (!question) {
      res.status(400).json({ success: false, message: "Question content is required." });
      return;
    }

    const product = await Product.findById(catalogProductId);
    if (!product) {
      res.status(404).json({ success: false, message: "Product not found." });
      return;
    }

    const productQuestion = new ProductQuestion({
      catalogProductId,
      userId: caller._id,
      question: question.trim(),
    });

    await productQuestion.save();

    res.status(201).json({
      success: true,
      message: "Question posted successfully.",
      question: productQuestion,
    });
  } catch (error: unknown) {
    console.error("Create question error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to post question.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

export async function getProductQuestions(req: Request, res: Response): Promise<void> {
  try {
    const catalogProductId = req.params.id as string;
    const { page, limit, skip } = parsePagination(req.query);

    const [questions, total] = await Promise.all([
      ProductQuestion.find({ catalogProductId, status: "approved" })
        .populate("userId", "fullName avatarUrl")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ProductQuestion.countDocuments({ catalogProductId, status: "approved" }),
    ]);

    res.status(200).json({
      success: true,
      questions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    console.error("Get product questions error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch questions." });
  }
}

export async function createAnswer(req: Request, res: Response): Promise<void> {
  try {
    const questionId = req.params.questionId as string;
    const caller = req.user as IUser | undefined;
    if (!caller) {
      res.status(401).json({ success: false, message: "Not authenticated." });
      return;
    }

    const { answer } = req.body;
    if (!answer) {
      res.status(400).json({ success: false, message: "Answer content is required." });
      return;
    }

    const question = await ProductQuestion.findById(questionId);
    if (!question) {
      res.status(404).json({ success: false, message: "Question not found." });
      return;
    }

    const product = await Product.findById(question.catalogProductId);
    const isSeller = product?.sellerId?.toString() === caller._id.toString();

    const productAnswer = new ProductAnswer({
      questionId,
      userId: caller._id,
      answer: answer.trim(),
      isSellerAnswer: isSeller,
    });

    await productAnswer.save();

    res.status(201).json({
      success: true,
      message: "Answer posted successfully.",
      answer: productAnswer,
    });
  } catch (error: unknown) {
    console.error("Create answer error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to post answer.";
    res.status(500).json({ success: false, message: errorMessage });
  }
}

export async function getQuestionAnswers(req: Request, res: Response): Promise<void> {
  try {
    const questionId = req.params.questionId as string;
    const { page, limit, skip } = parsePagination(req.query);

    const [answers, total] = await Promise.all([
      ProductAnswer.find({ questionId })
        .populate("userId", "fullName avatarUrl")
        .sort({ helpfulVotes: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ProductAnswer.countDocuments({ questionId }),
    ]);

    res.status(200).json({
      success: true,
      answers,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    console.error("Get question answers error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch answers." });
  }
}

// ==========================================
// 3. REVIEW MODERATION & DELETE
// ==========================================

/**
 * [DELETE] Removes a review and its REVIEW_MEDIA. (Owner or Admin)
 * Recalculates PRODUCT.ratingAverage and reviewCount after deletion.
 */
export async function deleteReview(req: Request, res: Response): Promise<void> {
  try {
    const { reviewId } = req.params;
    const caller = req.user as IUser | undefined;
    if (!caller) {
      res.status(401).json({ success: false, message: "Not authenticated." });
      return;
    }

    if (!reviewId || typeof reviewId !== "string" || !mongoose.Types.ObjectId.isValid(reviewId)) {
      res.status(400).json({ success: false, message: "Invalid review ID." });
      return;
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      res.status(404).json({ success: false, message: "Review not found." });
      return;
    }

    if (caller.role !== "admin" && review.userId.toString() !== caller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this review." });
      return;
    }

    const catalogProductId = review.catalogProductId;

    // Cascade-delete all review media first
    await ReviewMedia.deleteMany({ reviewId: review._id });
    await Review.findByIdAndDelete(reviewId);

    // Recalculate product rating after deletion
    const remaining = await Review.find({ catalogProductId, status: "approved" });
    const product = await Product.findById(catalogProductId);
    if (product) {
      if (remaining.length > 0) {
        const sum = remaining.reduce((acc, r) => acc + r.rating, 0);
        product.ratingAverage = parseFloat((sum / remaining.length).toFixed(1));
        product.reviewCount = remaining.length;
      } else {
        product.ratingAverage = 0;
        product.reviewCount = 0;
      }
      await product.save();
    }

    res.status(200).json({ success: true, message: "Review deleted successfully." });
  } catch (error: unknown) {
    console.error("Delete review error:", error);
    res.status(500).json({ success: false, message: "Failed to delete review." });
  }
}

/**
 * [UPDATE STATUS] Admin moderates a review — sets status to approved | hidden | pending.
 */
export async function updateReviewStatus(req: Request, res: Response): Promise<void> {
  try {
    const { reviewId } = req.params;
    const { status } = req.body as { status: string };

    if (!reviewId || typeof reviewId !== "string" || !mongoose.Types.ObjectId.isValid(reviewId)) {
      res.status(400).json({ success: false, message: "Invalid review ID." });
      return;
    }

    if (!["approved", "hidden", "pending"].includes(status)) {
      res.status(400).json({ success: false, message: "Invalid status. Must be: approved | hidden | pending" });
      return;
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      res.status(404).json({ success: false, message: "Review not found." });
      return;
    }

    review.status = status as "approved" | "hidden" | "pending";
    await review.save();

    res.status(200).json({ success: true, message: `Review status updated to "${status}".`, review });
  } catch (error: unknown) {
    console.error("Update review status error:", error);
    res.status(500).json({ success: false, message: "Failed to update review status." });
  }
}

// ==========================================
// 4. QUESTION MODERATION & DELETE
// ==========================================

/**
 * [DELETE] Removes a product question and cascades to delete all its answers. (Owner or Admin)
 */
export async function deleteQuestion(req: Request, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;
    const caller = req.user as IUser | undefined;
    if (!caller) {
      res.status(401).json({ success: false, message: "Not authenticated." });
      return;
    }

    if (!questionId || typeof questionId !== "string" || !mongoose.Types.ObjectId.isValid(questionId)) {
      res.status(400).json({ success: false, message: "Invalid question ID." });
      return;
    }

    const question = await ProductQuestion.findById(questionId);
    if (!question) {
      res.status(404).json({ success: false, message: "Question not found." });
      return;
    }

    if (caller.role !== "admin" && question.userId.toString() !== caller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this question." });
      return;
    }

    // Cascade: delete all answers belonging to this question
    await ProductAnswer.deleteMany({ questionId: question._id });
    await ProductQuestion.findByIdAndDelete(questionId);

    res.status(200).json({ success: true, message: "Question and its answers deleted successfully." });
  } catch (error: unknown) {
    console.error("Delete question error:", error);
    res.status(500).json({ success: false, message: "Failed to delete question." });
  }
}

/**
 * [UPDATE STATUS] Admin moderates a product question — sets status to approved | hidden | pending.
 */
export async function updateQuestionStatus(req: Request, res: Response): Promise<void> {
  try {
    const { questionId } = req.params;
    const { status } = req.body as { status: string };

    if (!questionId || typeof questionId !== "string" || !mongoose.Types.ObjectId.isValid(questionId)) {
      res.status(400).json({ success: false, message: "Invalid question ID." });
      return;
    }

    if (!["approved", "hidden", "pending"].includes(status)) {
      res.status(400).json({ success: false, message: "Invalid status. Must be: approved | hidden | pending" });
      return;
    }

    const question = await ProductQuestion.findById(questionId);
    if (!question) {
      res.status(404).json({ success: false, message: "Question not found." });
      return;
    }

    question.status = status as "approved" | "hidden" | "pending";
    await question.save();

    res.status(200).json({ success: true, message: `Question status updated to "${status}".`, question });
  } catch (error: unknown) {
    console.error("Update question status error:", error);
    res.status(500).json({ success: false, message: "Failed to update question status." });
  }
}

// ==========================================
// 5. ANSWER DELETE & HELPFUL VOTE
// ==========================================

/**
 * [DELETE] Removes a product answer. (Owner or Admin)
 */
export async function deleteAnswer(req: Request, res: Response): Promise<void> {
  try {
    const { answerId } = req.params;
    const caller = req.user as IUser | undefined;
    if (!caller) {
      res.status(401).json({ success: false, message: "Not authenticated." });
      return;
    }

    if (!answerId || typeof answerId !== "string" || !mongoose.Types.ObjectId.isValid(answerId)) {
      res.status(400).json({ success: false, message: "Invalid answer ID." });
      return;
    }

    const answer = await ProductAnswer.findById(answerId);
    if (!answer) {
      res.status(404).json({ success: false, message: "Answer not found." });
      return;
    }

    if (caller.role !== "admin" && answer.userId.toString() !== caller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this answer." });
      return;
    }

    await ProductAnswer.findByIdAndDelete(answerId);

    res.status(200).json({ success: true, message: "Answer deleted successfully." });
  } catch (error: unknown) {
    console.error("Delete answer error:", error);
    res.status(500).json({ success: false, message: "Failed to delete answer." });
  }
}

/**
 * [HELPFUL VOTE] Increments the helpful votes counter on a product answer. (Authenticated)
 */
export async function voteHelpfulAnswer(req: Request, res: Response): Promise<void> {
  try {
    const { answerId } = req.params;

    if (!answerId || typeof answerId !== "string" || !mongoose.Types.ObjectId.isValid(answerId)) {
      res.status(400).json({ success: false, message: "Invalid answer ID." });
      return;
    }

    const answer = await ProductAnswer.findByIdAndUpdate(
      answerId,
      { $inc: { helpfulVotes: 1 } },
      { new: true }
    );

    if (!answer) {
      res.status(404).json({ success: false, message: "Answer not found." });
      return;
    }

    res.status(200).json({ success: true, message: "Helpful vote recorded.", answer });
  } catch (error: unknown) {
    console.error("Vote helpful answer error:", error);
    res.status(500).json({ success: false, message: "Failed to record helpful vote." });
  }
}
