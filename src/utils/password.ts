import * as crypto from "crypto";

// In a real application, store this securely in environment variables (e.g. process.env.ENCRYPTION_KEY)
const ENCRYPTION_KEY = crypto.randomBytes(32); // Must be 256 bits (32 bytes)
const IV_LENGTH = 16; // For AES, this is always 16

/**
 * Encrypts a password
 * Note: For storing user passwords, hashing (e.g., using scrypt, bcrypt, or argon2)
 * is generally recommended over two-way encryption.
 */
export function encryptPassword(password: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(password, "utf8", "hex");
  encrypted += cipher.final("hex");

  // Return IV and encrypted data joined by a colon so we can extract the IV for decryption
  return `${iv.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts an encrypted password
 */
export function decryptPassword(encryptedPassword: string): string {
  const [ivHex, encryptedHex] = encryptedPassword.split(":");
  if (!ivHex || !encryptedHex) {
    throw new Error("Invalid encrypted password format");
  }

  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", ENCRYPTION_KEY, iv);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Compares a plain text password with an encrypted password
 */
export function comparePasswords(
  plainPassword: string,
  encryptedPassword: string,
): boolean {
  try {
    const decryptedPassword = decryptPassword(encryptedPassword);
    return plainPassword === decryptedPassword;
  } catch (error) {
    // If decryption fails (e.g. malformed string), the passwords do not match
    return false;
  }
}
