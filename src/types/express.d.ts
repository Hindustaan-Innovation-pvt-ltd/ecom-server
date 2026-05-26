import type { IUser } from "../models/user.js";

declare global {
  namespace Express {
    // Merge the custom IUser model interface directly into Express.User
    interface User extends IUser {}
  }
}
