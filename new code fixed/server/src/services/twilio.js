import twilio from "twilio";

let client = null;

export function initTwilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    console.warn("⚠️  Twilio not configured. Calls/SMS disabled.");
    return;
  }
  client = twilio(sid, token);
  console.log("✅ Twilio initialized");
}

export async function sendSms(to, body) {
  if (!client) return console.warn("⚠️  Twilio not ready, SMS skipped.");
  try {
    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
      body,
    });
    console.log(`📱 SMS sent to ${to}`);
  } catch (err) {
    console.error("SMS error:", err.message);
  }
}

export async function makeCall(to, message) {
  if (!client) return console.warn("⚠️  Twilio not ready, call skipped.");
  try {
    const twiml = `<Response><Say voice="alice">${message}</Say><Pause length="2"/><Say voice="alice">${message}</Say></Response>`;
    await client.calls.create({
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
      twiml,
    });
    console.log(`📞 Call placed to ${to}`);
  } catch (err) {
    console.error("Call error:", err.message);
  }
}

export async function triggerEmergencyAlert(userInfo, triggerPhrase) {
  const emergencyNumber = process.env.EMERGENCY_PHONE || "2057492403";
  const adminPhone = process.env.ADMIN_PHONE || "2056239541";

  const callMsg =
    `EMERGENCY ALERT from Konvict Artz Dex AI. ` +
    `A user has triggered a safety concern. ` +
    `The phrase detected was: ${triggerPhrase}. ` +
    `User information: ${userInfo}. ` +
    `Please respond immediately.`;

  const smsMsg =
    `🚨 EMERGENCY ALERT - Dex AI detected a safety concern.\n` +
    `User: ${userInfo}\nPhrase: "${triggerPhrase}"\nPlease respond immediately.`;

  await makeCall(`+1${emergencyNumber}`, callMsg);
  await sendSms(`+1${adminPhone}`, smsMsg);
}

export async function sendLowInventoryAlert(itemName, quantity) {
  const adminPhone = process.env.ADMIN_PHONE || "2056239541";
  const msg =
    `⚠️ LOW INVENTORY ALERT - Konvict Artz\n` +
    `Item: ${itemName}\nCurrent Stock: ${quantity} units\n` +
    `Please reorder soon.`;
  await sendSms(`+1${adminPhone}`, msg);
}
