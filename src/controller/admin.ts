import type { Request, Response } from "express";
import mongoose from "mongoose";
import { parsePagination } from "../utils/pagination.js";
import { type IUser } from "../models/user.js";
import { Product } from "../models/product.js";
import { Order } from "../models/order.js";
import { AuditLog } from "../models/auditLog.js";
import { Expense } from "../models/expense.js";
import { enqueueSellerStatusEmail } from "../services/email.js";

// ==========================================
// 1. SYSTEM PLATFORM EXPENSES
// ==========================================

export async function createExpense(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const { title, amountPaise, category, description } = req.body;

    if (!title || amountPaise === undefined || !category) {
      res.status(400).json({
        success: false,
        message: "Required fields: title, amountPaise, and category.",
      });
      return;
    }

    if (!["promotions", "marketing", "shipping", "hosting", "others"].includes(category)) {
      res.status(400).json({
        success: false,
        message: "Invalid category. Must be one of: promotions, marketing, shipping, hosting, others",
      });
      return;
    }

    const expense = new Expense({
      title: title.trim(),
      amountPaise: Math.max(0, Number(amountPaise)),
      category,
      description: description || "",
      createdBy: caller._id,
    });

    await expense.save();

    // Log the action to AuditLog
    const audit = new AuditLog({
      action: "EXPENSE_CREATED",
      performedBy: caller._id,
      targetId: expense._id,
      details: `Created new platform expense: "${expense.title}" of ₹${(expense.amountPaise / 100).toFixed(2)} under category: ${category}.`,
    });
    await audit.save();

    res.status(201).json({
      success: true,
      message: "Platform expense recorded successfully.",
      expense,
    });
  } catch (error: unknown) {
    console.error("Create expense error:", error);
    res.status(500).json({ success: false, message: "Failed to record expense." });
  }
}

export async function getExpenses(req: Request, res: Response): Promise<void> {
  try {
    const { category, startDate, endDate } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const query: Record<string, unknown> = {};

    if (category && ["promotions", "marketing", "shipping", "hosting", "others"].includes(category as string)) {
      query.category = category;
    }

    if (startDate || endDate) {
      const dateRange: Record<string, unknown> = {};
      if (startDate) dateRange.$gte = new Date(startDate as string);
      if (endDate) dateRange.$lte = new Date(endDate as string);
      query.createdAt = dateRange;
    }

    const [expenses, total] = await Promise.all([
      Expense.find(query)
        .populate("createdBy", "fullName email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Expense.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      expenses,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    console.error("Get expenses error:", error);
    res.status(500).json({ success: false, message: "Failed to retrieve expenses." });
  }
}

// ==========================================
// 2. PROFITABILITY DASHBOARD METRICS
// ==========================================

export async function getExpensesAndRevenueSummary(req: Request, res: Response): Promise<void> {
  try {
    // 1. Calculate total sales revenue & total coupon discount costs
    // Filters only "delivered" orders that are fully "paid" to secure solid financial reporting
    const orderMetrics = await Order.aggregate([
      {
        $match: {
          status: "delivered",
          paymentStatus: "paid",
        },
      },
      {
        $group: {
          _id: null,
          totalRevenuePaise: { $sum: "$totalPaise" },
          totalCouponDiscountPaise: { $sum: "$couponDiscountPaise" },
        },
      },
    ]);

    const totalRevenuePaise = orderMetrics[0]?.totalRevenuePaise ?? 0;
    const totalCouponDiscountPaise = orderMetrics[0]?.totalCouponDiscountPaise ?? 0;

    // 2. Calculate platform logged expenses
    const expenseMetrics = await Expense.aggregate([
      {
        $group: {
          _id: null,
          totalExpensesPaise: { $sum: "$amountPaise" },
        },
      },
    ]);

    const totalLoggedExpensesPaise = expenseMetrics[0]?.totalExpensesPaise ?? 0;

    // 3. Compute net profit (Revenue from sales minus discounts & expenses)
    const netProfitPaise = totalRevenuePaise - totalLoggedExpensesPaise;

    res.status(200).json({
      success: true,
      metrics: {
        totalRevenueRupees: parseFloat((totalRevenuePaise / 100).toFixed(2)),
        totalCouponDiscountRupees: parseFloat((totalCouponDiscountPaise / 100).toFixed(2)),
        totalLoggedExpensesRupees: parseFloat((totalLoggedExpensesPaise / 100).toFixed(2)),
        netProfitRupees: parseFloat((netProfitPaise / 100).toFixed(2)),
        rawPaise: {
          revenue: totalRevenuePaise,
          couponDiscounts: totalCouponDiscountPaise,
          expenses: totalLoggedExpensesPaise,
          netProfit: netProfitPaise,
        },
      },
    });
  } catch (error: unknown) {
    console.error("Get financials summary error:", error);
    res.status(500).json({ success: false, message: "Failed to generate dynamic financial summary dashboard." });
  }
}

// ==========================================
// 3. AUDIT CONTROL LOGS
// ==========================================

export async function getAuditLogs(req: Request, res: Response): Promise<void> {
  try {
    const { action, performedBy } = req.query;
    const { page, limit, skip } = parsePagination(req.query);

    const query: Record<string, unknown> = {};

    if (action) {
      query.action = action;
    }

    if (performedBy && mongoose.Types.ObjectId.isValid(performedBy as string)) {
      query.performedBy = new mongoose.Types.ObjectId(performedBy as string);
    }

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate("performedBy", "fullName email role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      logs,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    console.error("Get audit logs error:", error);
    res.status(500).json({ success: false, message: "Failed to retrieve administrative audit logs." });
  }
}

// ==========================================
// 4. BULK CATALOG PRODUCT MODERATION
// ==========================================

export async function getPendingModerationProducts(req: Request, res: Response): Promise<void> {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    const [products, total] = await Promise.all([
      Product.find({ moderationStatus: "pending" })
        .populate("categoryId", "name slug")
        .populate("brandId", "name slug")
        .populate("sellerId", "businessName businessEmail ratingAverage")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Product.countDocuments({ moderationStatus: "pending" }),
    ]);

    res.status(200).json({
      success: true,
      products,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: unknown) {
    console.error("Get pending moderation products error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch pending products queue." });
  }
}

export async function bulkModerateProducts(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const { productIds, action, reason } = req.body as {
      productIds: string[];
      action: "approve" | "reject" | "hide";
      reason?: string;
    };

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0 || !action) {
      res.status(400).json({
        success: false,
        message: "Required fields: productIds (non-empty string array) and action.",
      });
      return;
    }

    if (!["approve", "reject", "hide"].includes(action)) {
      res.status(400).json({
        success: false,
        message: "Invalid action. Permitted: approve | reject | hide",
      });
      return;
    }

    const oIds = productIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (oIds.length === 0) {
      res.status(400).json({ success: false, message: "No valid product ObjectIds provided." });
      return;
    }

    let nextModerationStatus: "approved" | "hidden";
    let nextStatus: "active" | "draft" | "blocked";

    if (action === "approve") {
      nextModerationStatus = "approved";
      nextStatus = "active";
    } else {
      nextModerationStatus = "hidden";
      nextStatus = "draft";
    }

    // Fetch products prior to update to compile seller list
    const productsToModerate = await Product.find({ _id: { $in: oIds } })
      .populate("createdBy", "fullName email")
      .lean();

    if (productsToModerate.length === 0) {
      res.status(404).json({ success: false, message: "No matching products found to moderate." });
      return;
    }

    // Perform bulk status update
    await Product.updateMany(
      { _id: { $in: oIds } },
      {
        $set: {
          moderationStatus: nextModerationStatus,
          status: nextStatus,
          moderationReason: reason || "",
          moderatedBy: caller._id,
        },
      }
    );

    // Enqueue notification email to the seller for each moderated product asynchronously
    for (const prod of productsToModerate) {
      const creator = prod.createdBy as unknown as IUser;
      if (creator && creator.email) {
        // Enqueue directly to the email:stack in Redis to be batched and sent via BCC asynchronously
        enqueueSellerStatusEmail(
          creator.email,
          creator.fullName,
          prod.title, // Substitute product title as business reference
          action === "approve" ? "approved" : "rejected",
          reason || (action === "approve" ? "Your catalog item has been successfully approved." : "Catalog item does not meet standards.")
        );
      }
    }

    // Log bulk moderation to AuditLog
    const audit = new AuditLog({
      action: "BULK_PRODUCT_MODERATION",
      performedBy: caller._id,
      details: `Processed bulk catalog moderation (${action.toUpperCase()}) on ${productsToModerate.length} products. Moderation Reason: "${reason || "No details provided"}"`,
    });
    await audit.save();

    res.status(200).json({
      success: true,
      message: `Bulk moderation process (${action}) completed successfully for ${productsToModerate.length} products.`,
    });
  } catch (error: unknown) {
    console.error("Bulk moderate products error:", error);
    res.status(500).json({ success: false, message: "Internal server error performing bulk moderation." });
  }
}
