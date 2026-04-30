import nodemailer from "nodemailer";

let transporter = null;
let emailStatus = {
  configured: false,
  ready: false,
  reason: "not_configured",
};

export function initEmail() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    emailStatus = {
      configured: false,
      ready: false,
      reason: "missing_credentials",
    };
    console.warn("Email not configured.");
    return;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || "587", 10),
    secure: parseInt(SMTP_PORT || "587", 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  emailStatus = {
    configured: true,
    ready: true,
    reason: "ok",
  };
  console.log("Email initialized");
}

async function send(to, subject, html) {
  if (!transporter) {
    console.warn("Email skipped: not configured.");
    return false;
  }

  const from = `${process.env.SENDER_NAME || "Konvict Artz"} <${process.env.SENDER_EMAIL || process.env.SMTP_USER}>`;
  try {
    await transporter.sendMail({ from, to, subject, html });
    console.log(`Email sent to ${to}`);
    return true;
  } catch (err) {
    console.error("Email error:", err.message);
    return false;
  }
}

export function getEmailStatus() {
  return { ...emailStatus };
}

export async function sendCustomEmail({ to, subject, body }) {
  const safeSubject = subject || "Message from Dex";
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;line-height:1.6;">
      <h2>${safeSubject}</h2>
      <p>${String(body || "").replace(/\n/g, "<br />")}</p>
    </div>
  `;
  return await send(to, safeSubject, html);
}

export async function sendWelcomeEmail(email, name) {
  return await send(
    email,
    "Welcome to Konvict Artz - Your Dex AI Trial Has Started!",
    `<h2>Hey ${name || "there"}!</h2>
     <p>Welcome to <strong>Konvict Artz</strong>! Your <strong>3-day free trial</strong> of Dex AI has started.</p>
     <p>Just say <strong>"Hey Dex"</strong> on our website and Dex will be ready to help you - no clicking needed.</p>
     <p>After your trial, continue for just <strong>$9.99/month</strong>.</p>
     <p>Visit us at <a href="https://www.konvict-artz.com">konvict-artz.com</a></p>`
  );
}

export async function sendPromoterNotification(email, name, referralCode, referralLink) {
  return await send(
    email,
    "You're now a Dex AI promoter!",
    `<h2>Hey ${name || "there"}!</h2>
     <p>You've been added as a <strong>Dex AI Promoter</strong> for Konvict Artz.</p>
     <p>Your unique promo code: <strong>${referralCode}</strong></p>
     <p>Your referral link: <a href="${referralLink}">${referralLink}</a></p>
     <p>You earn <strong>$2.00</strong> for every person who subscribes using your code.</p>
     <p>You also get <strong>free access</strong> to Dex AI as a promoter.</p>`
  );
}

export async function sendSubscriptionConfirmation(email, name) {
  return await send(
    email,
    "Dex AI subscription confirmed - $9.99/month",
    `<h2>You're all set, ${name || "friend"}!</h2>
     <p>Your <strong>Dex AI subscription</strong> is now active at $9.99/month.</p>
     <p>Say <strong>"Hey Dex"</strong> anytime on <a href="https://www.konvict-artz.com">konvict-artz.com</a> to get started.</p>`
  );
}

export async function sendPromoCode(email, name, code) {
  return await send(
    email,
    "Your Konvict Artz promo code",
    `<h2>Hey ${name || "there"}!</h2>
     <p>Here's your exclusive promo code for <strong>Konvict Artz</strong>:</p>
     <h1 style="color:#6d28d9">${code}</h1>
     <p>Use this code at <a href="https://www.konvict-artz.com">konvict-artz.com</a> to unlock access.</p>`
  );
}

export async function sendAffiliateInvite(email, name, inviteCode, registerLink) {
  return await send(
    email,
    "Your Dex affiliate invite is ready",
    `<h2>Hey ${name || "there"}!</h2>
     <p>You have been invited to become a <strong>Dex affiliate</strong> for Konvict Artz.</p>
     <p>Your one-time affiliate code is:</p>
     <h1 style="color:#38bdf8;letter-spacing:1px;">${inviteCode}</h1>
     <p>Use this signup link to create your affiliate account:</p>
     <p><a href="${registerLink}">${registerLink}</a></p>
     <p>Once inside, you will get your own referral code and can earn <strong>$2.00</strong> for each paid subscription that uses it.</p>`
  );
}

export async function sendAdEmail(to, subject, ad) {
  const safeSubject = subject || ad?.title || "Konvict Artz update";
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:auto;">
      <h2>${ad?.title || safeSubject}</h2>
      <p>${ad?.content || ""}</p>
      ${ad?.image ? `<img src="${ad.image}" alt="${ad.title || "Ad image"}" style="max-width:100%;height:auto;" />` : ""}
    </div>
  `;
  return await send(to, safeSubject, html);
}
