import nodemailer from "nodemailer";

let transporter = null;
let emailStatus = {
  configured: false,
  ready: false,
  reason: "not_configured",
  lastError: null,
};

function readableEmailError(err) {
  return err?.response || err?.message || String(err || "Unknown email error");
}

export function initEmail() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    emailStatus = {
      configured: false,
      ready: false,
      reason: "missing_credentials",
      lastError: "SMTP_HOST, SMTP_USER, or SMTP_PASS is missing.",
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
    ready: false,
    reason: "verifying",
    lastError: null,
  };
  console.log("Email initialized");

  transporter.verify()
    .then(() => {
      emailStatus = {
        configured: true,
        ready: true,
        reason: "ok",
        lastError: null,
      };
      console.log("Email SMTP connection verified");
    })
    .catch((err) => {
      const lastError = readableEmailError(err);
      emailStatus = {
        configured: true,
        ready: false,
        reason: "verify_failed",
        lastError,
      };
      console.error("Email verify error:", lastError);
    });
}

async function send(to, subject, html) {
  if (!transporter) {
    console.warn("Email skipped: not configured.");
    emailStatus = {
      ...emailStatus,
      ready: false,
      reason: "not_configured",
      lastError: "Email transporter is not configured.",
    };
    return false;
  }

  const from = `${process.env.SENDER_NAME || "Konvict Artz"} <${process.env.SENDER_EMAIL || process.env.SMTP_USER}>`;
  try {
    await transporter.sendMail({ from, to, subject, html });
    console.log(`Email sent to ${to}`);
    emailStatus = {
      ...emailStatus,
      ready: true,
      reason: "ok",
      lastError: null,
    };
    return true;
  } catch (err) {
    const lastError = readableEmailError(err);
    emailStatus = {
      ...emailStatus,
      ready: false,
      reason: "send_failed",
      lastError,
    };
    console.error("Email error:", lastError);
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

export async function sendPasswordResetEmail(email, name, resetLink) {
  return await send(
    email,
    "Reset Your Dex Password",
    `<div style="font-family:sans-serif;max-width:600px;margin:auto;line-height:1.6;">
      <h2>Hey ${name || "there"},</h2>
      <p>We received a request to reset your <strong>Konvict Artz</strong> password.</p>
      <p>Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${resetLink}" style="background:#7c3aed;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset My Password</a>
      </p>
      <p style="color:#888;font-size:13px;">If you didn't request this, you can safely ignore this email. Your password will not change.</p>
      <p style="color:#888;font-size:13px;">Or copy this link: <a href="${resetLink}">${resetLink}</a></p>
    </div>`
  );
}

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
