import { Storage } from "megajs";
import fs from "fs";

let storageInstance: any = null;

/**
 * Initializes and retrieves the MEGA.nz storage instance if credentials are provided.
 */
async function getMegaStorage(): Promise<any> {
  const email = process.env.MEGA_EMAIL;
  const password = process.env.MEGA_PASSWORD;

  if (!email || !password) {
    console.log("MEGA.nz credentials are not set. Profile uploads will remain local.");
    return null;
  }

  if (storageInstance) {
    return storageInstance;
  }

  try {
    console.log("Initializing MEGA.nz storage connection...");
    const storage = new Storage({
      email,
      password,
      keepalive: true,
    });

    await storage.ready;
    storageInstance = storage;
    console.log("Connected to MEGA.nz cloud storage successfully.");
    return storageInstance;
  } catch (error) {
    console.error("MEGA.nz initialization error:", error);
    return null;
  }
}

/**
 * Uploads a local file to MEGA.nz and returns the shareable link.
 * Falls back to returning null if MEGA is unconfigured or upload fails.
 */
export async function uploadToMega(localFilePath: string, originalName: string): Promise<string | null> {
  try {
    const storage = await getMegaStorage();
    if (!storage) {
      return null;
    }

    if (!fs.existsSync(localFilePath)) {
      console.error(`Local upload file not found for MEGA streaming: ${localFilePath}`);
      return null;
    }

    const stats = fs.statSync(localFilePath);
    const fileName = `${Date.now()}-${originalName}`;
    const fileStream = fs.createReadStream(localFilePath);

    console.log(`Streaming ${fileName} (${stats.size} bytes) to MEGA.nz...`);
    const upload = storage.upload(
      {
        name: fileName,
        size: stats.size,
      },
      fileStream
    );

    const file = await upload.complete;
    console.log("MEGA.nz upload complete. Generating public link...");

    // Generate public link
    const link = await file.link();
    console.log("Generated MEGA link:", link);
    return link;
  } catch (error) {
    console.error("Failed uploading file to MEGA.nz:", error);
    return null;
  }
}
export default uploadToMega;
