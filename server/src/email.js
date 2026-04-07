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
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to the Dex Promoter Program!</h2>
          <p>Hi,</p>
          <p>Congratulations! You've been added as a promoter for Dex AI. This means you have <strong>free unlimited access</strong> to Dex while you're promoting it.</p>
          
          <h3>Your Referral Code:</h3>
          <p style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; font-family: monospace; font-size: 18px; font-weight: bold;">
            ${referralCode}
          </p>
          
          <h3>Share This Link:</h3>
          <p><a href="${referralLink}" style="color: #007bff; text-decoration: none;">${referralLink}</a></p>
          
          <h3>How It Works:</h3>
          <ul>
            <li>Share your referral link with friends and contacts</li>
            <li>When they sign up using your code, they get <strong>3 days free trial</strong></li>
            <li>After the trial, they can subscribe for $9.99/month</li>
            <li>You maintain unlimited free access to Dex for as long as you're an active promoter</li>
          </ul>
          
          <p>Start sharing your code and help grow the Dex community!</p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
          <p style="color: #666; font-size: 12px;">
            Best regards,<br>
            The Konvict Artz Team
          </p>
        </div>
      `,
    });
    console.log(`✅ Promoter notification sent to ${email}`);
  } catch (error) {
    console.error('❌ Failed to send promoter email:', error.message);
  }
}

export async function sendTrialExpiringNotification(email, username) {
  if (!transporter) {
    console.warn('⚠️  Skipping email: transporter not initialized');
    return;
  }

  const senderEmail = process.env.SENDER_EMAIL || process.env.SMTP_USER;
  const senderName = process.env.SENDER_NAME || 'Konvict Artz';
  const clientOrigin = process.env.CLIENT_ORIGIN || 'https://konvict-artz.com';

  try {
    await transporter.sendMail({
      from: `${senderName} <${senderEmail}>`,
      to: email,
      subject: '⏰ Your Dex Trial Expires Tomorrow',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Your Dex Trial Expires Soon</h2>
          <p>Hi ${username},</p>
          <p>Your 3-day free trial of Dex AI expires tomorrow. Don't lose access to your AI assistant!</p>
          
          <h3>Subscribe Now to Continue</h3>
          <a href="${clientOrigin}" style="display: inline-block; background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0;">
            Subscribe for $9.99/month
          </a>
          
          <p>Subscribe today to maintain continuous access to Dex and all its features.</p>
          
          <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
          <p style="color: #666; font-size: 12px;">
            Best regards,<br>
            The Konvict Artz Team
          </p>
        </div>
      `,
    });
    console.log(`✅ Trial expiring notification sent to ${email}`);
  } catch (error) {
    console.error('❌ Failed to send trial expiring email:', error.message);
  }
}
