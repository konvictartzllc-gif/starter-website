export function initCommunications() {
  return {
    configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
    provider: "twilio",
  };
}

export async function triggerEmergencyAlert(userInfo, message) {
  console.warn(`Dex emergency alert for ${userInfo}: ${message}`);
  return false;
}

export async function sendLowInventoryAlert(itemName, quantity) {
  console.warn(`Low inventory alert: ${itemName} is at ${quantity}.`);
  return false;
}

export async function sendSms(to, body) {
  console.warn(`SMS transport is handled by the configured communications provider. Skipped ${to}: ${body}`);
  return false;
}

export async function makeCall(to) {
  console.warn(`Call transport is handled by the configured communications provider. Skipped ${to}.`);
  return false;
}
