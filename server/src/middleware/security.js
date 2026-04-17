import crypto from 'crypto';

const otaStore = new Map();
const OTA_EXPIRY_MS = 5 * 60 * 1000;

// Spam keywords for filtering
const SPAM_KEYWORDS = ['buy now', 'free money', 'click here', 'act now', 'limited time', 'winner', 'congratulations', 'viagra', 'crypto offer'];

/**
 * Spam filter middleware - blocks messages containing spam patterns
 * @param {Request} req
 * @param {Response} res
 * @param {Function} next
 */
export function spamFilter(req, res, next) {
        const message = (req.body?.message || '').toLowerCase();
        const isSpam = SPAM_KEYWORDS.some(keyword => message.includes(keyword));
        if (isSpam) {
                    return res.status(400).json({ error: 'Message flagged as spam' });
        }
        next();
}

/**
 * Generate a one-time authorization code
 * @param {string} userId
 * @param {string} actionType
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

/**
 * Remove expired OTA codes from the store
 */
export function cleanExpiredCodes() {
        const now = new Date();
        for (const [key, value] of otaStore.entries()) {
                    if (now > value.expiresAt) {
                                    otaStore.delete(key);
                    }
        }
}
