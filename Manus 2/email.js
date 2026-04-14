// Dex AI email notification logic
// Source: server/src/email.js

import nodemailer from 'nodemailer';

let transporter = null;

export function initEmailTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
    console.warn('⚠️  Email configuration missing. Email notifications will be disabled.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(smtpPort, 10),
    secure: parseInt(smtpPort, 10) === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  console.log('✅ Email transporter initialized');
  return transporter;
}

export async function sendPromoterNotification(email, referralCode, referralLink) {
  if (!transporter) {
    console.warn('⚠️  Skipping email: transporter not initialized');
    return;
  }

  const senderEmail = process.env.SENDER_EMAIL || process.env.SMTP_USER;
  const senderName = process.env.SENDER_NAME || 'Konvict Artz';

  try {
    await transporter.sendMail({
      from: `${senderName} <${senderEmail}>`,
      to: email,
      subject: '🎉 You\'re Now a Dex Promoter!',
      html: `...`, // Truncated for brevity
    });
  } catch (err) {
    console.error('Failed to send promoter notification:', err);
  }
}
