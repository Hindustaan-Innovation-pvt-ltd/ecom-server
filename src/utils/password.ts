import * as crypto from "node:crypto";
import bcrypt from "bcrypt";

const BCRYPT_SALT_ROUNDS = Number.parseInt(process.env.BCRYPT_SALT_ROUNDS || "12", 10);

function isBcryptHash(password: string): boolean {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(password);
}

/**
 * Hashes a password with bcrypt.
 * If the value already looks like a bcrypt hash, it is returned unchanged.
 */
export function encryptPassword(password: string): string {
  if (isBcryptHash(password)) {
    return password;
  }

  return bcrypt.hashSync(password, BCRYPT_SALT_ROUNDS);
}

function decryptPassword(encryptedPassword: string): string {
  const [ivHex, encryptedHex] = encryptedPassword.split(":");
  if (!ivHex || !encryptedHex) {
    throw new Error("Invalid encrypted password format");
  }

  const keyEnv = process.env.ENCRYPTION_KEY || "gThSW3SKowe1JATy3pFBfjj1Rji4Z9RlisTsaQrboxE=";
  const encryptionKey = keyEnv.length === 64 && /^[0-9a-fA-F]+$/.test(keyEnv)
    ? Buffer.from(keyEnv, "hex")
    : crypto.createHash("sha256").update(keyEnv.replace(/^['"]|['"]$/g, "")).digest();

  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", encryptionKey, iv);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Compares a plain text password with a stored hash.
 * Supports bcrypt first, then legacy SHA256/AES/plain-text compatibility.
 */
export function comparePasswords(
  plainPassword: string,
  encryptedPassword: string,
): boolean {
  // 1. Preferred path: bcrypt
  if (isBcryptHash(encryptedPassword)) {
    return bcrypt.compareSync(plainPassword, encryptedPassword);
  }

  // 2. Legacy SHA256 compatibility
  const sha256Hash = crypto.createHash("sha256").update(plainPassword).digest("hex");
  if (sha256Hash === encryptedPassword) {
    return true;
  }

  // 3. Old AES decryption comparison (backward compatibility)
  try {
    const decryptedPassword = decryptPassword(encryptedPassword);
    if (plainPassword === decryptedPassword) {
      return true;
    }
  } catch {
    // Ignore decryption failures (e.g., malformed string or key mismatch)
  }

  // 4. Fallback to direct plain text comparison (fail-safe for seeded/plain passwords)
  return plainPassword === encryptedPassword;
}
