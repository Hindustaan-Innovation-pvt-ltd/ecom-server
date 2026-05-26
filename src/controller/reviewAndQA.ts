import type { Request, Response } from "express";
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
    const reviews = await Review.find({ catalogProductId, status: "approved" })
      .populate("userId", "fullName avatarUrl")
      .sort({ createdAt: -1 });

    const reviewObjects = [];
    for (const r of reviews) {
      const media = await ReviewMedia.find({ reviewId: r._id });
      reviewObjects.push({
        ...r.toObject(),
        media,
      });
    }

    res.status(200).json({ success: true, reviews: reviewObjects });
  } catch (error: unknown) {
    console.error("Get product reviews error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch reviews." });
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
    const questions = await ProductQuestion.find({ catalogProductId, status: "approved" })
      .populate("userId", "fullName avatarUrl")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, questions });
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
    const answers = await ProductAnswer.find({ questionId })
      .populate("userId", "fullName avatarUrl")
      .sort({ helpfulVotes: -1, createdAt: -1 });

    res.status(200).json({ success: true, answers });
  } catch (error: unknown) {
    console.error("Get question answers error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch answers." });
  }
}
