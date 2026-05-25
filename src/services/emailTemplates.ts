/**
 * Helper to wrap the HTML in a premium responsive e-commerce template.
 */
export function getHtmlTemplate(title: string, bodyContent: string, ctaText?: string, ctaUrl?: string): string {
  const ctaButton = (ctaText && ctaUrl)
    ? `
      <table border="0" cellpadding="0" cellspacing="0" style="margin: 30px auto; text-align: center;">
        <tr>
          <td align="center" style="background-color: #6366f1; border-radius: 6px;">
            <a href="${ctaUrl}" target="_blank" style="display: inline-block; padding: 14px 28px; font-family: 'Outfit', 'Inter', sans-serif; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 6px;">
              ${ctaText}
            </a>
          </td>
        </tr>
      </table>
    `
    : "";

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Inter:wght@400;500;600&display=swap');
        body {
          margin: 0;
          padding: 0;
          background-color: #f8fafc;
          font-family: 'Inter', sans-serif;
          color: #334155;
          -webkit-font-smoothing: antialiased;
        }
        .wrapper {
          width: 100%;
          table-layout: fixed;
          background-color: #f8fafc;
          padding: 40px 0;
        }
        .main-card {
          width: 100%;
          max-width: 600px;
          margin: 0 auto;
          background-color: #ffffff;
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.03);
          border: 1px solid #e2e8f0;
          overflow: hidden;
        }
        .header {
          background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
          padding: 40px 30px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-family: 'Outfit', sans-serif;
          color: #ffffff;
          font-size: 28px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }
        .content {
          padding: 40px 30px;
          line-height: 1.6;
        }
        .content h2 {
          margin-top: 0;
          font-family: 'Outfit', sans-serif;
          font-size: 22px;
          color: #0f172a;
          font-weight: 600;
        }
        .content p {
          font-size: 15px;
          margin: 0 0 16px;
        }
        .footer {
          background-color: #f1f5f9;
          padding: 30px;
          text-align: center;
          border-top: 1px solid #e2e8f0;
        }
        .footer p {
          margin: 0 0 8px;
          font-size: 13px;
          color: #64748b;
        }
        .footer a {
          color: #4f46e5;
          text-decoration: none;
        }
      </style>
    </head>
    <body>
      <div class="wrapper">
        <div class="main-card">
          <div class="header">
            <h1>HMarketplace</h1>
          </div>
          <div class="content">
            ${bodyContent}
            ${ctaButton}
          </div>
          <div class="footer">
            <p>&copy; 2026 HMarketplace Innovations. All rights reserved.</p>
            <p>Need support? Contact us at <a href="mailto:support@hmarketplace.com">support@hmarketplace.com</a></p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generates the welcome email template for successful Customer registration.
 */
export function getWelcomeEmail(name: string): { subject: string; html: string; text: string } {
  const subject = "Welcome to HMarketplace! 🎉";
  const bodyContent = `
    <h2>Hi ${name},</h2>
    <p>Welcome to HMarketplace! We are absolutely thrilled to have you join our vibrant e-commerce ecosystem.</p>
    <p>Your customer account has been created successfully. You now have full access to browse catalog offerings, secure items in your cart, and add Indian shipping addresses for fast and reliable shipping.</p>
    <p>Get ready to explore premium brands, verified products, and robust checkout pipelines.</p>
  `;
  const text = `Hi ${name},\n\nWelcome to HMarketplace! Your customer account has been created successfully. Explore premium brands and enjoy robust checkouts.\n\nBest regards,\nThe HMarketplace Team`;
  const html = getHtmlTemplate(subject, bodyContent, "Explore Products", "http://localhost:8080/api/product");

  return { subject, html, text };
}

/**
 * Generates the pending review email template for newly registered Sellers.
 */
export function getSellerPendingEmail(name: string, businessName: string): { subject: string; html: string; text: string } {
  const subject = "Seller Registration Received - Pending Review ⏳";
  const bodyContent = `
    <h2>Dear ${name},</h2>
    <p>Thank you for registering as a Seller on HMarketplace!</p>
    <p>Your business profile for <strong>${businessName}</strong> has been successfully uploaded and is currently pending review by our administrative moderation team.</p>
    <p>Our team is verifying your Indian GST details and business credentials. Once approved, we will notify you immediately by email, and you will be able to unlock full inventory postings, variant catalogings, and array photo uploads.</p>
    <p>Verification normally takes less than 24-48 business hours.</p>
  `;
  const text = `Dear ${name},\n\nThank you for registering as a Seller on HMarketplace! Your business profile for "${businessName}" is pending review. We will notify you once approved.\n\nBest regards,\nThe HMarketplace Team`;
  const html = getHtmlTemplate(subject, bodyContent, "View Business Profile", "http://localhost:8080/api/seller/profile");

  return { subject, html, text };
}

/**
 * Generates the application decision email template (Approved or Rejected) for moderated Sellers.
 */
export function getSellerStatusEmail(
  name: string,
  businessName: string,
  status: "approved" | "rejected",
  reason?: string
): { subject: string; html: string; text: string } {
  const subject = status === "approved"
    ? "Congratulations! Your HMarketplace Seller Profile is Approved! 🚀"
    : "Update regarding your HMarketplace Seller Application 📝";

  const statusColor = status === "approved" ? "#22c55e" : "#ef4444";
  const statusLabel = status.toUpperCase();

  const decisionBlock = `
    <div style="margin: 24px 0; padding: 20px; border-left: 5px solid ${statusColor}; background-color: #f8fafc; border-radius: 4px;">
      <h3 style="margin: 0 0 8px; color: ${statusColor}; font-size: 18px; font-weight: 700;">APPLICATION STATUS: ${statusLabel}</h3>
      ${status === "rejected" ? `<p style="margin: 0; font-size: 14px; color: #475569;"><strong>Reason for denial:</strong> ${reason || "No details provided."}</p>` : ""}
    </div>
  `;

  const bodyContent = status === "approved"
    ? `
      <h2>Dear ${name},</h2>
      <p>We have spectacular news! Your seller onboarding application for <strong>${businessName}</strong> has been fully **APPROVED** by our moderation team.</p>
      ${decisionBlock}
      <p>You can now immediately log in, list categories, post products with Paise integer pricing, register unique SKUs, add variations, and upload multiple high-definition photos directly to Cloudinary.</p>
      <p>We are excited to partner with you to grow your business!</p>
    `
    : `
      <h2>Dear ${name},</h2>
      <p>Thank you for your interest in selling on HMarketplace.</p>
      <p>Our administrative moderation team has reviewed your application for <strong>${businessName}</strong>. Regrettably, at this time, your onboarding request has been **DENIED** due to the reason specified below:</p>
      ${decisionBlock}
      <p>Please log in to your profile and review your business registration credentials or contact support if you believe this was an error.</p>
    `;

  const text = status === "approved"
    ? `Dear ${name},\n\nWe have spectacular news! Your seller onboarding application for "${businessName}" has been fully APPROVED. Log in now to post inventory.\n\nBest regards,\nThe HMarketplace Team`
    : `Dear ${name},\n\nThank you for your interest in HMarketplace. Regrettably, your seller onboarding request for "${businessName}" was rejected for: ${reason || "No details provided"}.\n\nBest regards,\nThe HMarketplace Team`;

  const ctaText = status === "approved" ? "Launch Seller Dashboard" : "Contact Support";
  const ctaUrl = status === "approved" ? "http://localhost:8080/api/seller/profile" : "mailto:support@hmarketplace.com";

  const html = getHtmlTemplate(subject, bodyContent, ctaText, ctaUrl);

  return { subject, html, text };
}
