import nodemailer from "nodemailer";
import { getWelcomeEmail, getSellerPendingEmail, getSellerStatusEmail } from "./emailTemplates.js";

const EMAIL_FROM = process.env.EMAIL_FROM || "HMarketplace Support <noreply@hmarketplace.com>";

let transporter: nodemailer.Transporter | null = null;
let isEthereal = false;

/**
 * Initializes the Nodemailer SMTP transporter.
 * Falls back to Ethereal dynamic test accounts in development/missing credential environments,
 * and falls back to a safe console-log dry-run mode if offline.
 */
async function getTransporter(): Promise<nodemailer.Transporter | null> {
  if (transporter) {
    return transporter;
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "2525", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    // 1. Production / Configured SMTP
    console.log(`Initializing Nodemailer with custom SMTP: ${host}:${port}`);
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "true" || port === 465, // Use SSL for 465 or if explicitly requested, otherwise STARTTLS
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false, // Bypasses local self-signed certificate issues
      },
    });
    isEthereal = false;
    return transporter;
  }

  // 2. Development: Ethereal dynamic test account
  console.log("No SMTP credentials configured. Attempting to create an Ethereal SMTP test account...");
  try {
    const testAccount = await nodemailer.createTestAccount();
    console.log(`Generated Ethereal Test Account: User: ${testAccount.user}, Host: ${testAccount.smtp.host}`);
    transporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
      tls: {
        rejectUnauthorized: false, // Bypasses local self-signed certificate issues
      },
    });
    isEthereal = true;
    return transporter;
  } catch (err: any) {
    console.warn("Failed to create Ethereal test account (probably offline). Fallback to console dry-run mode active:", err.message || err);
    transporter = null;
    isEthereal = false;
    return null;
  }
}


/**
 * Centered core dispatch engine to send emails.
 * Safely prints outputs to console logs if offline or if no transporter is ready.
 */
async function sendMail(to: string, subject: string, html: string, text: string): Promise<void> {
  const mailOptions = {
    from: EMAIL_FROM,
    to,
    subject,
    text,
    html,
  };

  try {
    const activeTransporter = await getTransporter();
    if (!activeTransporter) {
      // 3. Fallback: Dry-run console output
      console.log("\n=======================================================");
      console.log(`>>> [DRY RUN EMAIL DISPATCH] To: ${to}`);
      console.log(`>>> Subject: ${subject}`);
      console.log("-------------------------------------------------------");
      console.log(`>>> Plain-text:\n${text}`);
      console.log("=======================================================\n");
      return;
    }

    const info = await activeTransporter.sendMail(mailOptions);
    console.log(`Email dispatched successfully! Message ID: ${info.messageId}`);

    if (isEthereal) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log(`[ETHEREAL PREVIEW URL]: ✉️ \x1b[36m${previewUrl}\x1b[0m`);
    }
  } catch (err: any) {
    console.error("Nodemailer transporter error:", err);
    console.log("\n=======================================================");
    console.log(`>>> [EMERGENCY CONSOLE BACKUP] To: ${to}`);
    console.log(`>>> Subject: ${subject}`);
    console.log("-------------------------------------------------------");
    console.log(`>>> Plain-text:\n${text}`);
    console.log("=======================================================\n");
  }
}

/**
 * Sends a welcome email upon successful Customer registration.
 */
export async function sendWelcomeEmail(to: string, name: string): Promise<void> {
  const { subject, html, text } = getWelcomeEmail(name);

  // Fire asynchronously
  sendMail(to, subject, html, text)
    .catch(err => console.error("Error sending welcome email:", err));
}

/**
 * Sends a confirmation email to a newly signed up Seller.
 */
export async function sendSellerPendingEmail(to: string, name: string, businessName: string): Promise<void> {
  const { subject, html, text } = getSellerPendingEmail(name, businessName);

  // Fire asynchronously
  sendMail(to, subject, html, text)
    .catch(err => console.error("Error sending seller pending email:", err));
}

/**
 * Sends a decision update email (Approved or Rejected) to a moderated Seller.
 */
export async function sendSellerStatusEmail(
  to: string,
  name: string,
  businessName: string,
  status: "approved" | "rejected",
  reason?: string
): Promise<void> {
  const { subject, html, text } = getSellerStatusEmail(name, businessName, status, reason);

  // Fire asynchronously
  sendMail(to, subject, html, text)
    .catch(err => console.error("Error sending seller decision email:", err));
}
