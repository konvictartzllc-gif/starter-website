import crypto from 'crypto';

// In-memory OTA store (replace with DB in production)
const otaStore = new Map();

// OTA code expiry in milliseconds (10 minutes)
const OTA_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Generate a one-time authorization code for a user action
 * @param {string} userId - The user's unique identifier
 * @param {string} actionType - The type of action requiring authorization
 * @returns {Promise>{code: string, expiresAt: Date}>}
 */
export async function generateOta(userId, actionType) {
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + OTA_EXPIRY_MS);
    const key = `${userId}:${actionType}`;

  otaStore.set(key, {
        code,
        expiresAt,
        attempts: 0,
        maxAttempts: 3
  });

  // Clean up expired codes periodically
  cleanExpiredCodes();

  return { code, expiresAt };
}

/**
 * Verify a one-time authorization code
 * @param {string} userId
 * @param {string} actionType
 * @param {string} code
 * @returns {Promise>boolean>}
 */
export async function verifyOta(userId, actionType, code) {
    const key = `${userId}:${actionType}`;
    const stored = otaStore.get(key);

  if (!stored) return false;
    if (new Date() > stored.expiresAt) {
          otaStore.delete(key);
          return false;
    }
    if (stored.attempts >= stored.maxAttempts) {
          otaStore.delete(key);
          return false;
    }

  stored.attempts++;

  if (stored.code === code) {
        otaStore.delete(key);
        return true;
  }

  return false;
}

function cleanExpiredCodes() {
    const now = new Date();
    for (const [key, value] of otaStore.entries()) {
          if (now > value.expiresAt) {
                  otaStore.delete(key);
          }
    }
}

export default { generateOta, verifyOta };
