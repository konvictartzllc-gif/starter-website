// ── Dex v2: Tone Detection Prototype ─────────────────────────────────────────
// Lightweight keyword-based tone classifier for chat messages.
// In v3 this will be replaced with an ML model or OpenAI function-call.

const TONE_PATTERNS = [
  { tone: "angry", patterns: [/\b(angry|mad|furious|pissed|irritated|annoyed|fed up|wtf|ridiculous|unacceptable)\b/i, /!{2,}/, /\b(terrible|horrible|worst|awful|trash)\b/i] },
  { tone: "frustrated", patterns: [/\b(frustrated|stuck|ugh|keeps failing|not working|still broken|glitching)\b/i, /\b(why won'?t|what is wrong with)\b/i] },
  { tone: "urgent", patterns: [/\b(asap|urgent|emergency|right now|immediately|hurry)\b/i, /\b(need help|help me)\b/i] },
  { tone: "happy", patterns: [/\b(happy|excited|love|amazing|awesome|great|perfect|thank|thanks|appreciate|good news|proud)\b/i, /[\u{1F60A}\u{1F64F}\u{2764}\u{1F525}\u{1F4AF}\u{1F44F}]/u, /\b(you('re| are) the best)\b/i] },
  { tone: "playful", patterns: [/\b(lol|lmao|haha|\u{1F602}|\u{1F923}|bruh|bro|dawg|fam)\b/i, /\b(yo|what'?s good|what'?s up)\b/i] },
  { tone: "confused", patterns: [/\b(confused|don'?t understand|what do you mean|huh|wdym|lost)\b/i, /\?{2,}/] },
  { tone: "sad", patterns: [/\b(sad|down|depressed|lonely|miss|crying|heartbroken|hurt|overwhelmed|not okay|\u{1F622}|\u{1F61E}|\u{1F494})\b/i] },
  { tone: "anxious", patterns: [/\b(anxious|worried|scared|panic|panicking|nervous|stressed|stressful|afraid)\b/i] },
];

function scoreVoiceSignals(voiceSignals = {}) {
  const scores = {};
  const add = (tone, amount = 1) => {
    scores[tone] = (scores[tone] || 0) + amount;
  };

  const emotion = String(voiceSignals.emotion || voiceSignals.detectedEmotion || "").toLowerCase();
  if (["sad", "down", "crying"].includes(emotion)) add("sad", 3);
  if (["angry", "mad", "irritated"].includes(emotion)) add("angry", 3);
  if (["happy", "excited", "joy"].includes(emotion)) add("happy", 3);
  if (["anxious", "fear", "stressed"].includes(emotion)) add("anxious", 3);

  const volume = Number(voiceSignals.volume);
  const pitch = Number(voiceSignals.pitch);
  const pace = Number(voiceSignals.pace);
  const pauseMs = Number(voiceSignals.pauseMs);

  if (Number.isFinite(volume) && volume > 0.82) add("angry", 1);
  if (Number.isFinite(volume) && volume < 0.24) add("sad", 1);
  if (Number.isFinite(pace) && pace > 0.78) add("anxious", 1);
  if (Number.isFinite(pace) && pace < 0.28) add("sad", 1);
  if (Number.isFinite(pitch) && pitch > 0.78) add("happy", 1);
  if (Number.isFinite(pitch) && pitch < 0.24) add("sad", 1);
  if (Number.isFinite(pauseMs) && pauseMs > 1800) add("sad", 1);

  return scores;
}

/**
 * Detect the dominant tone of a message.
 * @param {string} message - The user's chat message
 * @param {object} voiceSignals - Optional voice emotion metadata from the app.
 * @returns {string|null} - Detected tone tag or null if neutral
 */
export function detectTone(message, voiceSignals = {}) {
  if ((!message || typeof message !== "string") && !voiceSignals) return null;

  let bestTone = null;
  let bestScore = 0;
  const scores = scoreVoiceSignals(voiceSignals);

  for (const { tone, patterns } of TONE_PATTERNS) {
    let score = scores[tone] || 0;
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
export function detectAllTones(message, voiceSignals = {}) {
  if ((!message || typeof message !== "string") && !voiceSignals) return [];

  const results = [];
  const voiceScores = scoreVoiceSignals(voiceSignals);
  for (const { tone, patterns } of TONE_PATTERNS) {
    let score = voiceScores[tone] || 0;
    for (const pattern of patterns) {
      if (pattern.test(message)) score++;
    }
    if (score > 0) results.push({ tone, score });
  }

  return results.sort((a, b) => b.score - a.score);
}

export default { detectTone, detectAllTones };
