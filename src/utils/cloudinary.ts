import { v2 as cloudinary } from "cloudinary";
import fs from "node:fs";

// Configure Cloudinary SDK
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "",
  api_key: process.env.CLOUDINARY_API_KEY || "",
  api_secret: process.env.CLOUDINARY_API_SECRET || "",
});

/**
 * Uploads a local file to Cloudinary and returns the secure HTTPS URL.
 * Returns null if Cloudinary credentials are not configured or the upload fails.
 */
export async function uploadToCloudinary(localFilePath: string, folderName = "hmarketplace/user_profile"): Promise<string | null> {
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      console.error("Cloudinary credentials are not set. Cloud uploads are mandatory.");
      return null;
    }

    if (!fs.existsSync(localFilePath)) {
      console.error(`Local upload file not found for Cloudinary: ${localFilePath}`);
      return null;
    }

    console.log(`Uploading ${localFilePath} to Cloudinary folder: ${folderName}...`);
    
    // Perform upload
    const result = await cloudinary.uploader.upload(localFilePath, {
      folder: folderName,
      resource_type: "auto",
    });

    console.log("Cloudinary upload success. Secure URL:", result.secure_url);
    return result.secure_url;
  } catch (error) {
    console.error("Cloudinary upload operation failed:", error);
    return null;
  } finally {
    // ALWAYS delete the local temporary file to free disk space and keep uploads clear
    try {
      if (fs.existsSync(localFilePath)) {
        fs.unlinkSync(localFilePath);
        console.log(`Successfully cleared local temp upload: ${localFilePath}`);
      }
    } catch (unlinkErr) {
      console.error(`Failed to delete local temp file ${localFilePath}:`, unlinkErr);
    }
  }
}

export default uploadToCloudinary;
