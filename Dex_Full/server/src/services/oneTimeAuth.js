// One-time authorization utility (stub)
// In production, use a secure, expiring code/token system
const authorizedActions = new Map();

export function generateOneTimeCode(userId, action) {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  authorizedActions.set(`${userId}:${action}`, code);
  setTimeout(() => authorizedActions.delete(`${userId}:${action}`), 10 * 60 * 1000); // Expires in 10 min
  return code;
}

export function verifyOneTimeCode(userId, action, code) {
  const key = `${userId}:${action}`;
  if (authorizedActions.get(key) === code) {
    authorizedActions.delete(key);
    return true;
  }
  return false;
}