import mongoose, { Schema, type Document } from "mongoose";
import crypto from "node:crypto";

export interface IWebhookSubscription extends Document {
  userId: mongoose.Types.ObjectId;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookSubscriptionSchema = new Schema<IWebhookSubscription>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    url: {
      type: String,
      required: [true, "Webhook destination URL is required"],
      trim: true,
      validate: {
        validator: (value: string) => /^https?:\/\/[^\s$.?#].[^\s]*$/i.test(value),
        message: "Please provide a valid HTTP/HTTPS destination URL",
      },
    },
    secret: {
      type: String,
      unique: true,
    },
    events: {
      type: [String],
      required: [true, "Subscribed events array is required"],
      validate: {
        validator: (events: string[]) => events.length > 0,
        message: "Must subscribe to at least one event type",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-generate a secure 32-character hexadecimal HMAC signing secret before saving
WebhookSubscriptionSchema.pre("validate", function (this: IWebhookSubscription) {
  if (!this.secret) {
    this.secret = crypto.randomBytes(16).toString("hex");
  }
});

// Indexes for high performance webhook discovery
WebhookSubscriptionSchema.index({ userId: 1 });
WebhookSubscriptionSchema.index({ events: 1 });

export const WebhookSubscription = mongoose.model<IWebhookSubscription>(
  "WebhookSubscription",
  WebhookSubscriptionSchema
);
export default WebhookSubscription;
