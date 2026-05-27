import nodemailer from "nodemailer";
import { getWelcomeEmail, getSellerPendingEmail, getSellerStatusEmail } from "./emailTemplates.js";
import { redisClient, isRedisActive } from "../utils/redis.js";

const EMAIL_FROM = process.env.EMAIL_FROM || "HMarketplace Support <noreply@hmarketplace.com>";

/**
 * Key used in Redis to accumulate the pending email stack.
 * Each entry is a JSON-serialized IQueuedEmail object.
 */
const EMAIL_STACK_KEY = "email:stack";

// ─── Daily Quota Guard (Brevo free tier: 300 emails/day) ─────────────────────
// Set EMAIL_DAILY_LIMIT in .env to override. Uses a 10-email safety buffer by default.
// Counts total recipients (to + bcc) since Brevo charges per recipient, not per send.
const EMAIL_DAILY_LIMIT = parseInt(process.env.EMAIL_DAILY_LIMIT || "290", 10); // 290 = buffer below 300
const QUOTA_KEY = "email:quota:daily";

/**
 * Returns how many emails can still be sent to Brevo today.
 * Falls back to full limit if Redis is unavailable.
 */
async function getRemainingQuota(): Promise<number> {
  if (!isRedisActive || !redisClient) return EMAIL_DAILY_LIMIT;
  try {
    const used = await redisClient.get(QUOTA_KEY);
    return Math.max(0, EMAIL_DAILY_LIMIT - (used ? parseInt(used, 10) : 0));
  } catch {
    return EMAIL_DAILY_LIMIT;
  }
}

/**
 * Increments the daily Brevo send counter by `count` recipients.
 * The Redis key auto-expires at midnight so the quota resets each day.
 */
async function incrementQuota(count: number): Promise<void> {
  if (!isRedisActive || !redisClient || count <= 0) return;
  try {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const ttlSeconds = Math.ceil((midnight.getTime() - now.getTime()) / 1000);

    const newTotal = await redisClient.incrby(QUOTA_KEY, count);
    if (newTotal === count) {
      // First send of the day — set expiry so it resets at midnight automatically
      await redisClient.expire(QUOTA_KEY, ttlSeconds);
    }
    console.log(`[Email Quota] Used ${newTotal}/${EMAIL_DAILY_LIMIT} today (+${count} this send, resets in ${Math.round(ttlSeconds / 3600)}h).`);
  } catch (err) {
    console.warn("[Email Quota] Failed to update quota counter:", err);
  }
}

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

let brevoTransporter: nodemailer.Transporter | null = null;
let etherealTransporter: nodemailer.Transporter | null = null;

/**
 * Returns the primary Brevo SMTP transporter (lazy singleton).
 * Only created when SMTP_HOST/USER/PASS are set in env.
 * Returns null if credentials are missing — caller must fall back to Ethereal.
 */
async function getBrevoTransporter(): Promise<nodemailer.Transporter | null> {
  if (brevoTransporter) return brevoTransporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  console.log(`[Email] Brevo SMTP transporter ready: ${host}:${port}`);
  brevoTransporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
  return brevoTransporter;
}

/**
 * Returns a dedicated Ethereal test transporter (lazy singleton).
 * Always routes to Ethereal — used when:
 *   - Brevo quota is exhausted for the day
 *   - SMTP credentials are not configured
 * Preview URLs are logged to console so emails are visible during development.
 */
async function getEtherealTransporter(): Promise<nodemailer.Transporter | null> {
  if (etherealTransporter) return etherealTransporter;

  console.log("[Email] Connecting to Ethereal test mail server...");
  try {
    const testAccount = await nodemailer.createTestAccount();
    console.log(`[Email] Ethereal test account ready ✅ User: ${testAccount.user}`);
    etherealTransporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: { user: testAccount.user, pass: testAccount.pass },
      tls: { rejectUnauthorized: false },
    });
    return etherealTransporter;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[Email] Ethereal unavailable (offline?). Console dry-run active:", msg);
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
 * Always routes through Brevo quota — falls back to Ethereal if exhausted.
 */
async function dispatchSingle(entry: IQueuedEmail): Promise<void> {
  const { subject, html, text } = renderEmail(entry);
  const recipientCount = 1;
  const remaining = await getRemainingQuota();

  if (remaining >= recipientCount) {
    const t = await getBrevoTransporter();
    await sendRaw(t, false, entry.to, subject, html, text);
    await incrementQuota(recipientCount);
  } else {
    console.warn(`[Email Quota] Brevo quota exhausted. Routing to Ethereal: ${entry.to}`);
    const t = await getEtherealTransporter();
    await sendRaw(t, true, entry.to, subject, html, text);
  }
}

/**
 * Core SMTP sender. Accepts an explicit transporter + isPreview flag.
 * If transporter is null, falls back to console dry-run.
 *
 * @param xport      - The nodemailer transporter to use (Brevo or Ethereal)
 * @param isPreview  - When true, logs the Ethereal preview URL after sending
 */
async function sendRaw(
  xport: nodemailer.Transporter | null,
  isPreview: boolean,
  to: string,
  subject: string,
  html: string,
  text: string,
  bcc?: string
): Promise<void> {
  const mailOptions = { from: EMAIL_FROM, to, subject, html, text, ...(bcc ? { bcc } : {}) };

  if (!xport) {
    // No transporter available — console dry-run
    console.log("\n=======================================================");
    console.log(`>>> [DRY RUN EMAIL] To: ${to}${bcc ? ` | BCC: ${bcc}` : ""}`);
    console.log(`>>> Subject: ${subject}`);
    console.log("-------------------------------------------------------");
    console.log(`>>> Plain-text:\n${text}`);
    console.log("=======================================================\n");
    return;
  }

  try {
    const info = await xport.sendMail(mailOptions);
    const bccCount = bcc ? bcc.split(",").length : 0;
    console.log(`[Email] ✓ Sent | ID: ${info.messageId} | To: ${to}${bccCount ? ` | +${bccCount} BCC` : ""}`);

    if (isPreview) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log(`[Email] 📧 Ethereal preview: \x1b[36m${previewUrl}\x1b[0m`);
    }
  } catch (err) {
    console.error("[Email] SMTP error:", err);
    // Emergency console fallback so the content is never silently lost
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
 * Quota-aware routing:
 *   - Checks remaining Brevo daily quota (default cap: 290 of 300).
 *   - If the group fits within the quota → sends via Brevo, increments counter.
 *   - If the group would exceed the quota → routes to Ethereal test server instead,
 *     so you still see the emails during development without burning Brevo quota.
 *
 * Grouping strategy:
 *   - Groups by email type so one BCC call handles all "welcome" emails,
 *     one handles all "sellerPending", etc.
 *   - BCC recipients are hidden from each other.
 *   - When a group has only 1 recipient, sends a personalized email directly.
 */
export async function flushEmailStack(): Promise<void> {
  const emails = await popEmailStack();
  if (emails.length === 0) return;

  const remaining = await getRemainingQuota();
  console.log(`[Email Queue] Flushing ${emails.length} queued email(s). Brevo quota remaining today: ${remaining}/${EMAIL_DAILY_LIMIT}`);

  // Resolve transporters once (lazy singletons — no extra network calls on repeat flushes)
  const brevoT = await getBrevoTransporter();
  const etherealT = await getEtherealTransporter();

  // Track quota spend across groups in this flush run
  let quotaUsedThisFlush = 0;

  // Group by type key
  const groups = new Map<string, IQueuedEmail[]>();
  for (const email of emails) {
    const key =
      email.type === "sellerStatus"
        ? `${email.type}:${email.status ?? "approved"}`
        : email.type;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(email);
  }

  for (const [groupKey, group] of groups) {
    if (group.length === 0) continue;

    // Calculate how many Brevo quota slots this group needs (1 per recipient)
    const recipientCount = group.length; // 1 primary + (N-1) BCC = N total

    // Determine if this group fits within the remaining Brevo quota
    const quotaLeft = remaining - quotaUsedThisFlush;
    const useEthereal = !brevoT || quotaLeft < recipientCount;

    if (useEthereal) {
      console.warn(
        `[Email Queue] 🟡 Group '${groupKey}' (${recipientCount} recipients) routed to Ethereal` +
        (brevoT ? ` — Brevo quota too low (${quotaLeft} left, need ${recipientCount})` : " — no Brevo credentials")
      );
    }

    const xport = useEthereal ? etherealT : brevoT;
    const isPreview = useEthereal;

    if (group.length === 1) {
      const entry = group[0]!;
      const { subject, html, text } = renderEmail(entry);
      await sendRaw(xport, isPreview, entry.to, subject, html, text);
      if (!useEthereal) {
        quotaUsedThisFlush += 1;
        await incrementQuota(1);
      }
      console.log(`[Email Queue] Sent 1 '${groupKey}' email to: ${entry.to} via ${useEthereal ? "Ethereal" : "Brevo"}`);
      continue;
    }

    // Multiple recipients — BCC batch
    const representativeEntry = { ...group[0]!, name: "there" };
    const { subject, html, text } = renderEmail(representativeEntry);

    const allEmails = group.map(e => e.to);
    const primary = allEmails[0]!;
    const bccRecipients = allEmails.slice(1);
    const bccList = bccRecipients.join(",");

    await sendRaw(xport, isPreview, primary, subject, html, text, bccList);

    if (!useEthereal) {
      quotaUsedThisFlush += recipientCount;
      await incrementQuota(recipientCount);
    }

    console.log(
      `[Email Queue] BCC batch: ${group.length} '${groupKey}' emails via ${useEthereal ? "Ethereal 🚫" : "Brevo ✅"} — Primary: ${primary} | BCC: ${bccRecipients.length}`
    );
  }

  if (quotaUsedThisFlush > 0) {
    console.log(`[Email Queue] Flush complete. Used ${quotaUsedThisFlush} Brevo quota slots this run.`);
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
