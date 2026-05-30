import type { Request, Response } from "express";
import mongoose from "mongoose";
import { WebhookSubscription } from "../models/webhookSubscription.js";
import type { IUser } from "../models/user.js";

// ─── [POST] /api/webhooks — Register Webhook Subscription ────────────────────

export async function createSubscription(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const { url, events } = req.body as {
      url: string;
      events: string[];
    };

    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      res.status(400).json({
        success: false,
        message: "url (string) and events (non-empty string array) are required.",
      });
      return;
    }

    // Verify duplicate URL subscription for this user
    const existing = await WebhookSubscription.findOne({
      userId: caller._id,
      url,
    });
    if (existing) {
      res.status(409).json({
        success: false,
        message: "A webhook subscription for this URL already exists under your profile.",
      });
      return;
    }

    // Create the subscription (HMAC secret is auto-generated inside model pre-validate hook)
    const subscription = new WebhookSubscription({
      userId: caller._id,
      url,
      events,
    });
    await subscription.save();

    res.status(201).json({
      success: true,
      message: "Webhook subscription registered successfully.",
      subscription,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to register subscription.";
    console.error("Create webhook subscription error:", error);
    res.status(500).json({ success: false, message });
  }
}

// ─── [GET] /api/webhooks — List My Subscriptions ─────────────────────────────

export async function getMySubscriptions(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;

    const query =
      caller.role === "admin"
        ? {} // Admins can audit all webhooks
        : { userId: caller._id };

    const subscriptions = await WebhookSubscription.find(query).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      subscriptions,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch subscriptions.";
    console.error("Get my webhook subscriptions error:", error);
    res.status(500).json({ success: false, message });
  }
}

// ─── [DELETE] /api/webhooks/:id — Delete Subscription ────────────────────────

export async function deleteSubscription(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const { id } = req.params;

    if (typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: "Invalid subscription ID." });
      return;
    }

    const subscription = await WebhookSubscription.findById(id);
    if (!subscription) {
      res.status(404).json({ success: false, message: "Subscription not found." });
      return;
    }

    // Enforce ownership: users may only delete their own webhooks (unless they are admin)
    if (caller.role !== "admin" && subscription.userId.toString() !== caller._id.toString()) {
      res.status(403).json({
        success: false,
        message: "You are not authorized to delete this subscription.",
      });
      return;
    }

    await WebhookSubscription.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: "Webhook subscription deleted successfully.",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to delete subscription.";
    console.error("Delete webhook subscription error:", error);
    res.status(500).json({ success: false, message });
  }
}

// ─── [PUT] /api/webhooks/:id — Update Subscription ───────────────────────────

/**
 * [UPDATE] Updates URL, event list, or active status of an existing webhook subscription. (Seller/Admin)
 */
export async function updateSubscription(req: Request, res: Response): Promise<void> {
  try {
    const caller = req.user as IUser;
    const id = req.params.id as string;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: "Invalid subscription ID." });
      return;
    }

    const subscription = await WebhookSubscription.findById(id);
    if (!subscription) {
      res.status(404).json({ success: false, message: "Subscription not found." });
      return;
    }

    if (caller.role !== "admin" && subscription.userId.toString() !== caller._id.toString()) {
      res.status(403).json({ success: false, message: "Forbidden. You do not own this subscription." });
      return;
    }

    const { url, events, isActive } = req.body as { url?: string; events?: string[]; isActive?: boolean };

    if (url !== undefined) subscription.url = url;
    if (events !== undefined) {
      if (!Array.isArray(events) || events.length === 0) {
        res.status(400).json({ success: false, message: "events must be a non-empty array of strings." });
        return;
      }
      subscription.events = events;
    }
    if (typeof isActive === "boolean") subscription.isActive = isActive;

    await subscription.save();

    res.status(200).json({ success: true, message: "Webhook subscription updated successfully.", subscription });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update subscription.";
    console.error("Update webhook subscription error:", error);
    res.status(500).json({ success: false, message });
  }
}
