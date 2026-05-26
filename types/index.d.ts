import type { IUser } from "../src/models/user.js";
import type { ISeller } from "../src/models/seller.js";

declare global {
  namespace Express {
    // Globally merge the IUser mongoose document schema directly into Express.User
    interface User extends IUser {}

    // Globally extend the Express Request context to store populated Seller info
    interface Request {
      seller?: ISeller | null;
    }
  }

  // ─── Order & Payment Enum Types ────────────────────────────────────────────

  type OrderStatus =
    | "pending"
    | "confirmed"
    | "processing"
    | "shipped"
    | "delivered"
    | "cancelled"
    | "return_requested"
    | "returned";

  type PaymentStatus =
    | "pending"
    | "paid"
    | "failed"
    | "refunded"
    | "partially_refunded";

  type PaymentMethod = "cod";
}
