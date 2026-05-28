import mongoose, { Schema, type Document } from "mongoose";

export interface IAuditLog extends Document {
  action: 
    | "USER_STATUS_UPDATE"
    | "SELLER_STATUS_UPDATE"
    | "USER_DELETED"
    | "SELLER_DELETED"
    | "EXPENSE_CREATED"
    | "BULK_PRODUCT_MODERATION";
  performedBy: mongoose.Types.ObjectId;
  targetId?: mongoose.Types.ObjectId | null;
  details: string;
  createdAt: Date;
  updatedAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    action: {
      type: String,
      required: [true, "Action is required"],
      enum: [
        "USER_STATUS_UPDATE",
        "SELLER_STATUS_UPDATE",
        "USER_DELETED",
        "SELLER_DELETED",
        "EXPENSE_CREATED",
        "BULK_PRODUCT_MODERATION"
      ],
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "PerformedBy is required"],
    },
    targetId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    details: {
      type: String,
      required: [true, "Details description is required"],
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for high-performance administrative lookups
AuditLogSchema.index({ performedBy: 1, action: 1 });
AuditLogSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
export default AuditLog;
