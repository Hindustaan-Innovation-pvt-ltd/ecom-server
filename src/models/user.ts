import mongoose, { Schema, type Document, Model } from "mongoose";
import { encryptPassword, comparePasswords } from "../utils/password.js";

export interface IUser extends Document {
  fullName: string;
  email: string;
  phone: string;
  passwordHash: string;
  avatarUrl: string;
  role: "customer" | "seller" | "admin";
  isActive: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(password: string): boolean;
}

const UserSchema = new Schema<IUser>(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      minlength: [2, "Full name must be at least 2 characters long"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      trim: true,
      match: [/^\+?[0-9\s-]{7,15}$/, "Please provide a valid phone number"],
    },
    passwordHash: {
      type: String,
      required: [true, "Password is required"],
    },
    avatarUrl: {
      type: String,
      default: "",
    },
    role: {
      type: String,
      enum: ["customer", "seller", "admin"],
      default: "customer",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
UserSchema.index({ role: 1 });

// Automatically encrypt password before saving
UserSchema.pre("save", async function () {
  if (this.isModified("passwordHash")) {
    this.passwordHash = encryptPassword(this.passwordHash);
  }
});

// Compare password method
UserSchema.methods.comparePassword = function (password: string): boolean {
  return comparePasswords(password, this.passwordHash);
};

export const User = mongoose.model<IUser>("User", UserSchema);
export default User;
