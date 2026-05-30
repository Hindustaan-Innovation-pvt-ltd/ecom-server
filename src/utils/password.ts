import * as crypto from "node:crypto";

// Load encryption key from environment variable, ensuring it's 32 bytes
const keyEnv = process.env.ENCRYPTION_KEY;
let derivedKey: Buffer;
if (keyEnv) {
  if (keyEnv.length === 64 && /^[0-9a-fA-F]+$/.test(keyEnv)) {
    derivedKey = Buffer.from(keyEnv, "hex");
  } else {
    derivedKey = crypto.createHash("sha256").update(keyEnv).digest();
  }
} else {
  derivedKey = crypto.createHash("sha256").update("gThSW3SKowe1JATy3pFBfjj1Rji4Z9RlisTsaQrboxE=").digest();
}

const ENCRYPTION_KEY = derivedKey;
const IV_LENGTH = 16; // For AES, this is always 16

/**
 * Encrypts a password using SHA256 hashing.
 * Checks first to ensure we do not doubly encrypt/hash an already hashed/encrypted password.
 */
export function encryptPassword(password: string): string {
  // If it's already a SHA256 hash (64 hex characters), return it directly
  if (password.length === 64 && /^[0-9a-fA-F]+$/.test(password)) {
    return password;
  }
  // If it's already AES encrypted (contains a colon and is formatted correctly), return it directly
  if (password.includes(":")) {
    const [ivHex] = password.split(":");
    if (ivHex && ivHex.length === 32 && /^[0-9a-fA-F]+$/.test(ivHex)) {
      return password;
    }
  }

  return crypto.createHash("sha256").update(password).digest("hex");
}

/**
 * Decrypts an encrypted password (used for backward compatibility with old AES passwords)
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
 * Compares a plain text password with a stored password hash/encryption.
 * Supports:
 *   1. New SHA256 hash matching
 *   2. Old AES decryption matching (backward compatibility)
 *   3. Direct plain text matching (fail-safe fallback)
 */
export function comparePasswords(
  plainPassword: string,
  encryptedPassword: string,
): boolean {
  // 1. Try secure SHA256 hash comparison (default for newly registered users)
  const sha256Hash = crypto.createHash("sha256").update(plainPassword).digest("hex");
  if (sha256Hash === encryptedPassword) {
    return true;
  }

  // 2. Try old AES decryption comparison (backward compatibility)
  try {
    const decryptedPassword = decryptPassword(encryptedPassword);
    if (plainPassword === decryptedPassword) {
      return true;
    }
  } catch {
    // Ignore decryption failures (e.g., malformed string or key mismatch)
  }

  // 3. Fallback to direct plain text comparison (fail-safe for seeded/plain passwords)
  return plainPassword === encryptedPassword;
}
