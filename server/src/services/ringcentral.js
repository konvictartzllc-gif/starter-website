let rc = null;
let SDKModule = null;

async function loadSdk() {
  if (SDKModule) return SDKModule;
  try {
    SDKModule = await import("@ringcentral/sdk");
    return SDKModule;
  } catch (err) {
    console.warn(`⚠️  RingCentral SDK unavailable. Calls/SMS disabled. ${err.message}`);
    SDKModule = null;
    return null;
  }
}

export async function initRingCentral() {
  const clientId = process.env.RC_CLIENT_ID;
  const clientSecret = process.env.RC_CLIENT_SECRET;
  const username = process.env.RC_USERNAME;
  const password = process.env.RC_PASSWORD;
  const server = process.env.RC_SERVER || "https://platform.ringcentral.com";

  if (!clientId || !clientSecret || !username || !password) {
    console.warn("⚠️  RingCentral not configured. Calls/SMS disabled.");
    return;
  }

  const imported = await loadSdk();
  if (!imported) return;

  try {
    const SDK = imported.default || imported.SDK || imported;
    const rcsdk = new SDK.SDK({
      server,
      clientId,
      clientSecret,
    });
    rc = rcsdk.platform();
    await rc.login({ username, password });
    console.log("✅ RingCentral initialized");
  } catch (err) {
    console.error("RingCentral init error:", err.message);
    rc = null;
  }
}

export async function sendSms(to, body) {
  if (!rc) return console.warn("⚠️  RingCentral not ready, SMS skipped.");
  try {
    const from = process.env.RC_PHONE_NUMBER;
    await rc.post("/restapi/v1.0/account/~/extension/~/sms", {
      from: { phoneNumber: from },
      to: [{ phoneNumber: to }],
      text: body,
    });
    console.log(`📱 SMS sent to ${to}`);
  } catch (err) {
    console.error("SMS error:", err.message);
  }
}

export async function makeCall(to, message) {
  if (!rc) return console.warn("⚠️  RingCentral not ready, call skipped.");
  try {
    const from = process.env.RC_PHONE_NUMBER;
    await rc.post("/restapi/v1.0/account/~/extension/~/ring-out", {
      from: { phoneNumber: from },
      to: { phoneNumber: to },
      playPrompt: true,
    });
    console.log(`📞 RingOut call placed to ${to} — message: ${message}`);
  } catch (err) {
    console.error("Call error:", err.message);
  }
}

export async function triggerEmergencyAlert(userInfo, triggerPhrase) {
  const emergencyNumber = process.env.EMERGENCY_PHONE || "2057492403";
  const adminPhone = process.env.ADMIN_PHONE || "2056239541";

  const smsMsg =
    `🚨 EMERGENCY ALERT - Dex AI detected a safety concern.\n` +
    `User: ${userInfo}\nPhrase: "${triggerPhrase}"\nPlease respond immediately.`;

  await makeCall(`+1${emergencyNumber}`, `Emergency alert from Konvict Artz Dex AI. User safety concern detected. Phrase: ${triggerPhrase}. User: ${userInfo}.`);
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
