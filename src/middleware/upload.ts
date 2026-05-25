import multer from "multer";
import type { Request } from "express";
import path from "path";
import fs from "fs";

const UPLOAD_DIR = "./uploads/user_profile";

// Ensure directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Storage setup
const storage = multer.diskStorage({
  destination: (req: Request, file: any, cb: (error: Error | null, destination: string) => void) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req: Request, file: any, cb: (error: Error | null, filename: string) => void) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

// File filter (only permit images)
const fileFilter = (req: any, file: any, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only image files (.jpg, .jpeg, .png, .webp, .gif) are allowed!"));
  }
};

// Multer upload middleware
export const uploadProfilePic = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});
