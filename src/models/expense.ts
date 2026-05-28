import mongoose, { Schema, type Document } from "mongoose";

export interface IExpense extends Document {
  title: string;
  amountPaise: number;
  category: "promotions" | "marketing" | "shipping" | "hosting" | "others";
  description?: string;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>(
  {
    title: {
      type: String,
      required: [true, "Expense title is required"],
      trim: true,
    },
    amountPaise: {
      type: Number,
      required: [true, "Expense amount in Paise is required"],
      min: [0, "Amount cannot be negative"],
    },
    category: {
      type: String,
      required: [true, "Expense category is required"],
      enum: ["promotions", "marketing", "shipping", "hosting", "others"],
      default: "others",
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "CreatedBy admin ID is required"],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for administrative finance lookups
ExpenseSchema.index({ category: 1 });
ExpenseSchema.index({ createdAt: -1 });

export const Expense = mongoose.model<IExpense>("Expense", ExpenseSchema);
export default Expense;
