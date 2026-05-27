import nodemailer from "nodemailer";
import { getWelcomeEmail, getSellerPendingEmail, getSellerStatusEmail } from "./emailTemplates.js";
import { redisClient, isRedisActive } from "../utils/redis.js";

const EMAIL_FROM = process.env.EMAIL_FROM || "HMarketplace Support <noreply@hmarketplace.com>";

/**
 * Key used in Redis to accumulate the pending email stack.
 * Each entry is a JSON-serialized IQueuedEmail object.
 */
const EMAIL_STACK_KEY = "email:stack";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmailType = "welcome" | "sellerPending" | "sellerStatus";

export interface IQueuedEmail {
  type: EmailType;
  to: string;
  name: string;
  businessName?: string | undefined;        // | undefined required by exactOptionalPropertyTypes
  status?: "approved" | "rejected" | undefined;
  reason?: string | undefined;
  queuedAt: number;  // Unix timestamp ms for debugging/ordering
}

// ─── Transporter ──────────────────────────────────────────────────────────────

let transporter: nodemailer.Transporter | null = null;
let isEthereal = false;

/**
 * Initializes the Nodemailer SMTP transporter (lazy singleton).
 * Falls back to Ethereal in dev, then to console dry-run if offline.
 */
async function getTransporter(): Promise<nodemailer.Transporter | null> {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "2525", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    console.log(`[Email] Initializing SMTP transporter: ${host}:${port}`);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    });
    isEthereal = false;
    return transporter;
  }

  console.log("[Email] No SMTP credentials. Attempting Ethereal test account...");
  try {
    const testAccount = await nodemailer.createTestAccount();
    console.log(`[Email] Ethereal account ready: ${testAccount.user}`);
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
      tls: { rejectUnauthorized: false },
    });
    isEthereal = true;
    return transporter;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[Email] Ethereal unavailable. Falling back to dry-run console mode:", msg);
    return null;
  }
}

// ─── Redis Email Stack ─────────────────────────────────────────────────────────

/**
 * Pushes an email job onto the Redis stack (RPUSH → tail append).
 * Falls back to immediate direct dispatch if Redis is unavailable.
 */
async function pushToEmailStack(entry: IQueuedEmail): Promise<void> {
  if (isRedisActive && redisClient) {
    try {
      await redisClient.rpush(EMAIL_STACK_KEY, JSON.stringify(entry));
      return;
    } catch (err) {
      console.warn("[Email Stack] Redis push failed, falling back to direct dispatch:", err);
    }
  }
  // Redis offline — fire immediately (individual send, no BCC batching)
  await dispatchSingle(entry);
}

/**
 * Pops ALL pending emails off the Redis stack atomically using GETDEL pattern.
 * Uses RENAME to isolate the batch (same pattern as the user write-back flush).
 */
export async function popEmailStack(): Promise<IQueuedEmail[]> {
  if (!isRedisActive || !redisClient) return [];

  const exists = await redisClient.exists(EMAIL_STACK_KEY);
  if (!exists) return [];

  const tempKey = `${EMAIL_STACK_KEY}:flushing:${Date.now()}`;
  try {
    await redisClient.rename(EMAIL_STACK_KEY, tempKey);
    const rawEntries = await redisClient.lrange(tempKey, 0, -1);
    await redisClient.del(tempKey);

    return rawEntries
      .map(raw => {
        try { return JSON.parse(raw) as IQueuedEmail; }
        catch { return null; }
      })
      .filter((e): e is IQueuedEmail => e !== null);
  } catch (err) {
    console.error("[Email Stack] Failed to pop email stack:", err);
    if (redisClient) await redisClient.del(tempKey).catch(() => { });
    return [];
  }
}

// ─── Core Dispatch ────────────────────────────────────────────────────────────

/**
 * Resolves an IQueuedEmail into rendered {subject, html, text} content.
 */
function renderEmail(entry: IQueuedEmail): { subject: string; html: string; text: string } {
  switch (entry.type) {
    case "welcome":
      return getWelcomeEmail(entry.name);
    case "sellerPending":
      return getSellerPendingEmail(entry.name, entry.businessName || "Your Business");
    case "sellerStatus":
      return getSellerStatusEmail(entry.name, entry.businessName || "Your Business", entry.status || "approved", entry.reason);
    default:
      return { subject: "HMarketplace Notification", html: "", text: "" };
  }
}

/**
 * Sends a single email directly (used as Redis-offline fallback).
 */
async function dispatchSingle(entry: IQueuedEmail): Promise<void> {
  const { subject, html, text } = renderEmail(entry);
  await sendRaw(entry.to, subject, html, text);
}

/**
 * Core SMTP sender. Handles dry-run console logging if transporter is null.
 */
async function sendRaw(
  to: string,
  subject: string,
  html: string,
  text: string,
  bcc?: string
): Promise<void> {
  const mailOptions = { from: EMAIL_FROM, to, subject, html, text, ...(bcc ? { bcc } : {}) };

  try {
    const activeTransporter = await getTransporter();
    if (!activeTransporter) {
      console.log("\n=======================================================");
      console.log(`>>> [DRY RUN EMAIL] To: ${to}${bcc ? ` | BCC: ${bcc}` : ""}`);
      console.log(`>>> Subject: ${subject}`);
      console.log("-------------------------------------------------------");
      console.log(`>>> Plain-text:\n${text}`);
      console.log("=======================================================\n");
      return;
    }

    const info = await activeTransporter.sendMail(mailOptions);
    console.log(`[Email] Dispatched ✓ Message ID: ${info.messageId} | To: ${to}${bcc ? ` | BCC recipients: ${bcc.split(",").length}` : ""}`);

    if (isEthereal) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log(`[Email] Ethereal preview: \x1b[36m${previewUrl}\x1b[0m`);
    }
  } catch (err) {
    console.error("[Email] SMTP error:", err);
    console.log("\n=======================================================");
    console.log(`>>> [EMERGENCY CONSOLE BACKUP] To: ${to}`);
    console.log(`>>> Subject: ${subject}`);
    console.log(`>>> Plain-text:\n${text}`);
    console.log("=======================================================\n");
  }
}

// ─── BCC Batch Dispatch ───────────────────────────────────────────────────────

/**
 * Flushes the entire email stack in one SMTP call per email type using BCC.
 *
 * Strategy:
 *  1. Group all queued emails by type (welcome / sellerPending / sellerStatus).
 *  2. For each group:
 *     - Use the FIRST recipient as the `to` (primary/visible).
 *     - Pass ALL other recipients as `bcc` (hidden from each other).
 *     - Use the generic template content (not personalized per recipient — BCC limitation).
 *     - This collapses N SMTP calls into 1 per email type.
 *
 * Note: BCC recipients all receive the same HTML body. For personalized emails
 * (e.g., "Hi John"), individual sends are still used when the batch size is 1.
 */
export async function flushEmailStack(): Promise<void> {
  const emails = await popEmailStack();
  if (emails.length === 0) return;

  console.log(`[Email Queue] Flushing ${emails.length} queued email(s)...`);

  // Group by type key — emails with same type share template content
  const groups = new Map<string, IQueuedEmail[]>();
  for (const email of emails) {
    // Group welcome emails together; seller emails by type+status combo
    const key =
      email.type === "sellerStatus"
        ? `${email.type}:${email.status ?? "approved"}`
        : email.type;

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(email);
  }

  for (const [groupKey, group] of groups) {
    if (group.length === 0) continue;

    if (group.length === 1) {
      // Single recipient — send personalized email directly
      // Use group[0]! — length === 1 guarantees it exists; TS can't narrow through destructuring
      const entry = group[0]!;
      const { subject, html, text } = renderEmail(entry);
      await sendRaw(entry.to, subject, html, text);
      console.log(`[Email Queue] Sent 1 '${groupKey}' email to: ${entry.to}`);
      continue;
    }

    // Multiple recipients — BCC batch send
    // Use a generic "Hello there" template for the shared BCC body
    const representativeEntry = { ...group[0]!, name: "there" };
    const { subject, html, text } = renderEmail(representativeEntry);

    const emails = group.map(e => e.to);
    const primary = emails[0]!;               // Safe: group.length > 1 guaranteed above
    const bccRecipients = emails.slice(1);
    const bccList = bccRecipients.join(",");

    await sendRaw(primary, subject, html, text, bccList);
    console.log(`[Email Queue] BCC batch sent ${group.length} '${groupKey}' emails — Primary: ${primary} | BCC: ${bccRecipients.length} recipients`);
  }
}

// ─── Public Enqueue API ───────────────────────────────────────────────────────
// These replace the old sendWelcomeEmail / sendSellerPendingEmail / sendSellerStatusEmail
// direct-dispatch functions. All callers now enqueue; the worker flushes in batches.

/**
 * Enqueues a welcome email for a newly registered customer.
 */
export function enqueueWelcomeEmail(to: string, name: string): void {
  pushToEmailStack({ type: "welcome", to, name, queuedAt: Date.now() })
    .catch(err => console.error("[Email Stack] Failed to enqueue welcome email:", err));
}

/**
 * Enqueues a seller-pending review notification email.
 */
export function enqueueSellerPendingEmail(to: string, name: string, businessName: string): void {
  pushToEmailStack({ type: "sellerPending", to, name, businessName, queuedAt: Date.now() })
    .catch(err => console.error("[Email Stack] Failed to enqueue seller pending email:", err));
}

/**
 * Enqueues a seller approval/rejection decision email.
 */
export function enqueueSellerStatusEmail(
  to: string,
  name: string,
  businessName: string,
  status: "approved" | "rejected",
  reason?: string
): void {
  pushToEmailStack({ type: "sellerStatus", to, name, businessName, status, reason, queuedAt: Date.now() })
    .catch(err => console.error("[Email Stack] Failed to enqueue seller status email:", err));
}

// ─── Legacy Compat Aliases (keep old call sites working) ─────────────────────

/** @deprecated Use enqueueWelcomeEmail instead */
export const sendWelcomeEmail = enqueueWelcomeEmail;
/** @deprecated Use enqueueSellerPendingEmail instead */
export const sendSellerPendingEmail = enqueueSellerPendingEmail;
/** @deprecated Use enqueueSellerStatusEmail instead */
export const sendSellerStatusEmail = enqueueSellerStatusEmail;
