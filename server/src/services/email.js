export async function sendAdEmail(to, subject, ad) {
  if (!transporter) return console.warn("⚠️  Email skipped: not configured.");
  const from = `${process.env.SENDER_NAME || "Konvict Artz"} <${process.env.SENDER_EMAIL || process.env.SMTP_USER}>`;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;">
      <h2>${ad.title}</h2>
      <p>${ad.content}</p>
      ${ad.image ? `<img src="${ad.image}" alt="${ad.title}" style="max-width:100%;height:auto;" />` : ""}
    </div>
  `;
  try {
    await transporter.sendMail({ from, to, subject, html });
    console.log(`📧 Ad email sent to ${to}`);
  } catch (err) {
    console.error("Ad email error:", err.message);
  }
}
import nodemailer from "nodemailer";

let transporter = null;

export function initEmail() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn("⚠️  Email not configured.");
    return;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || "587", 10),
    secure: parseInt(SMTP_PORT || "587", 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  console.log("✅ Email initialized");
}

async function send(to, subject, html) {
  if (!transporter) return console.warn("⚠️  Email skipped: not configured.");
  const from = `${process.env.SENDER_NAME || "Konvict Artz"} <${process.env.SENDER_EMAIL || process.env.SMTP_USER}>`;
  try {
    await transporter.sendMail({ from, to, subject, html });
    console.log(`📧 Email sent to ${to}`);
  } catch (err) {
    console.error("Email error:", err.message);
  }
}

export async function sendWelcomeEmail(email, name) {
  await send(
    email,
    "Welcome to Konvict Artz — Your Dex AI Trial Has Started!",
    `<h2>Hey ${name || "there"}! 👋</h2>
     <p>Welcome to <strong>Konvict Artz</strong>! Your <strong>3-day free trial</strong> of Dex AI has started.</p>
     <p>Just say <strong>"Hey Dex"</strong> on our website and Dex will be ready to help you — no clicking needed.</p>
     <p>After your trial, continue for just <strong>$9.99/month</strong>.</p>
     <p>Visit us at <a href="https://www.konvict-artz.com">konvict-artz.com</a></p>`
  );
}

export async function sendPromoterNotification(email, name, referralCode, referralLink) {
  await send(
    email,
    "🎉 You're Now a Dex AI Promoter!",
    `<h2>Hey ${name || "there"}!</h2>
     <p>You've been added as a <strong>Dex AI Promoter</strong> for Konvict Artz!</p>
     <p>Your unique promo code: <strong>${referralCode}</strong></p>
     <p>Your referral link: <a href="${referralLink}">${referralLink}</a></p>
     <p>You earn <strong>$2.00</strong> for every person who subscribes using your code.</p>
     <p>You also get <strong>free access</strong> to Dex AI as a promoter!</p>`
  );
}

export async function sendSubscriptionConfirmation(email, name) {
  await send(
    email,
    "✅ Dex AI Subscription Confirmed — $9.99/month",
    `<h2>You're all set, ${name || "friend"}!</h2>
     <p>Your <strong>Dex AI subscription</strong> is now active at $9.99/month.</p>
     <p>Say <strong>"Hey Dex"</strong> anytime on <a href="https://www.konvict-artz.com">konvict-artz.com</a> to get started.</p>`
  );
}

export async function sendPromoCode(email, name, code) {
  await send(
    email,
    "🎁 Your Konvict Artz Promo Code",
    `<h2>Hey ${name || "there"}!</h2>
     <p>Here's your exclusive promo code for <strong>Konvict Artz</strong>:</p>
     <h1 style="color:#6d28d9">${code}</h1>
     <p>Use this code at <a href="https://www.konvict-artz.com">konvict-artz.com</a> to unlock access.</p>`
  );
}
