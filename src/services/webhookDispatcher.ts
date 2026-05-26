import crypto from "node:crypto";
import type mongoose from "mongoose";
import { WebhookSubscription } from "../models/webhookSubscription.js";

interface WebhookPayload {
  id: string;
  event: string;
  timestamp: number;
  data: unknown;
}

/**
 * Dispatches an outgoing webhook event to all active subscribers.
 * This execution runs fully asynchronously in the background.
 *
 * @param event - The subscribed event name (e.g. 'order.created')
 * @param data - The data payload to send (will be converted to JSON)
 * @param ownerId - Optional owner ID. If provided, we only send to webhooks registered by this owner (or global admins).
 */
export function dispatchWebhookEvent(
  event: string,
  data: unknown,
  ownerId?: mongoose.Types.ObjectId
): void {
  // Execute fully asynchronously in the background (non-blocking)
  Promise.resolve().then(async () => {
    try {
      const query: Record<string, unknown> = {
        events: event,
        isActive: true,
      };

      // If ownerId is provided, filter:
      // Send to the owner's webhooks or to admin's webhooks
      if (ownerId) {
        const { User } = await import("../models/user.js");
        const admins = await User.find({ role: "admin" }).select("_id").lean();
        const adminIds = admins.map(admin => admin._id as mongoose.Types.ObjectId);
        
        query.userId = { $in: [ownerId, ...adminIds] };
      }

      const subscriptions = await WebhookSubscription.find(query).lean();
      if (subscriptions.length === 0) return;

      const webhookPayload: WebhookPayload = {
        id: `evt_${crypto.randomBytes(8).toString("hex")}`,
        event,
        timestamp: Date.now(),
        data,
      };

      const payloadString = JSON.stringify(webhookPayload);

      // Distribute payloads concurrently in background
      await Promise.allSettled(
        subscriptions.map(async (sub) => {
          try {
            // Generate standard HMAC-SHA256 signature
            const signature = crypto
              .createHmac("sha256", sub.secret)
              .update(payloadString)
              .digest("hex");

            // Perform non-blocking HTTP POST request
            const response = await fetch(sub.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-HMarketplace-Signature": signature,
                "X-HMarketplace-Event": event,
              },
              body: payloadString,
            });

            if (!response.ok) {
              console.warn(
                `[Webhook Dispatcher] Failed delivery to ${sub.url}. Status: ${response.status}`
              );
            }
          } catch (err: unknown) {
            const errMessage = err instanceof Error ? err.message : "Fetch connection failure";
            console.error(
              `[Webhook Dispatcher] Connection error to ${sub.url} for event ${event}:`,
              errMessage
            );
          }
        })
      );
    } catch (error: unknown) {
      console.error("[Webhook Dispatcher] Error resolving active webhook subscriptions:", error);
    }
  });
}
