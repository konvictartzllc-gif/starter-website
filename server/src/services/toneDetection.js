// ── Dex v2: Tone Detection Prototype ─────────────────────────────────────────
// Lightweight keyword-based tone classifier for chat messages.
// In v3 this will be replaced with an ML model or OpenAI function-call.

const TONE_PATTERNS = [
  { tone: "frustrated", patterns: [/\b(frustrated|annoyed|angry|mad|pissed|wtf|ugh|ridiculous|unacceptable)\b/i, /!{2,}/, /\b(terrible|horrible|worst|awful|trash)\b/i] },
  { tone: "urgent",     patterns: [/\b(asap|urgent|emergency|right now|immediately|hurry)\b/i, /\b(need help|help me)\b/i] },
  { tone: "happy",      patterns: [/\b(love|amazing|awesome|great|perfect|thank|thanks|appreciate)\b/i, /[\u{1F60A}\u{1F64F}\u{2764}\u{1F525}\u{1F4AF}\u{1F44F}]/u, /\b(you('re| are) the best)\b/i] },
  { tone: "playful",    patterns: [/\b(lol|lmao|haha|\u{1F602}|\u{1F923}|bruh|bro|dawg|fam)\b/i, /\b(yo|what'?s good|what'?s up)\b/i] },
  { tone: "confused",   patterns: [/\b(confused|don'?t understand|what do you mean|huh|wdym)\b/i, /\?{2,}/] },
  { tone: "sad",        patterns: [/\b(sad|down|depressed|lonely|miss|crying|\u{1F622}|\u{1F61E}|\u{1F494})\b/i] },
];

/**
 * Detect the dominant tone of a message.
 * @param {string} message - The user's chat message
 * @returns {string|null} - Detected tone tag or null if neutral
 */
export function detectTone(message) {
  if (!message || typeof message !== "string") return null;

  let bestTone = null;
  let bestScore = 0;

  for (const { tone, patterns } of TONE_PATTERNS) {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(message)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTone = tone;
    }
  }

  return bestScore > 0 ? bestTone : null;
}

/**
 * Get all matching tones (for analytics/logging).
 * @param {string} message
 * @returns {Array<{tone: string, score: number}>}
 */
export function detectAllTones(message) {
  if (!message || typeof message !== "string") return [];

  const results = [];
  for (const { tone, patterns } of TONE_PATTERNS) {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(message)) score++;
    }
    if (score > 0) results.push({ tone, score });
  }

  return results.sort((a, b) => b.score - a.score);
}

export default { detectTone, detectAllTones };
