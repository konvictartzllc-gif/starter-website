// Spam filter utility (stub)
// Replace with a real spam detection algorithm or API
export function isSpamRisk(phoneNumber, message) {
  // Example: Block known spam numbers or keywords
  const spamNumbers = ["+1234567890", "+1987654321"];
  const spamKeywords = ["free money", "prize", "winner", "urgent reply"];  
  if (spamNumbers.includes(phoneNumber)) return true;
  if (spamKeywords.some((kw) => message && message.toLowerCase().includes(kw))) return true;
  return false;
}
