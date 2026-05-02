const DISTRESS_PATTERNS = [
  /\b(i feel numb|i feel empty|i feel hopeless)\b/i,
  /\b(i'?m not okay|im not okay|i am not okay)\b/i,
  /\b(i can'?t do this|i cant do this|i don'?t know how much more i can take)\b/i,
  /\b(i feel alone|i feel lonely|nobody cares|no one cares)\b/i,
  /\b(i'?m overwhelmed|im overwhelmed|too much right now)\b/i,
  /\b(i'?m breaking down|im breaking down|falling apart)\b/i,
  /\b(i need comfort|i need support|please stay with me)\b/i,
  /\b(i feel depressed|i feel really down|i feel very sad)\b/i,
];

const SELF_HARM_PATTERNS = [
  /\b(suicide|kill myself|end it all|self[- ]?harm|hurt myself|don'?t want to live|want to die)\b/i,
  /\b(i want to disappear forever|i should not be here|i don'?t want to be here)\b/i,
];

const HARM_OTHERS_PATTERNS = [
  /\b(hurt|kill|attack|shoot|harm|injure) (someone|others|them|him|her|people|person|my (mom|dad|family|friend|boss|teacher))\b/i,
  /\b(i want to hurt someone|i want to kill someone|i might hurt someone)\b/i,
];

const PANIC_PATTERNS = [
  /\b(can'?t breathe|cant breathe|panic attack|i am panicking|i'?m panicking)\b/i,
  /\b(my chest hurts and i'?m scared|my chest hurts and im scared)\b/i,
];

export function detectSafetySignal(message = "") {
  const text = String(message || "").trim();
  if (!text) return { level: "none", type: null };

  if (SELF_HARM_PATTERNS.some((pattern) => pattern.test(text))) {
    return { level: "emergency", type: "self_harm" };
  }

  if (HARM_OTHERS_PATTERNS.some((pattern) => pattern.test(text))) {
    return { level: "emergency", type: "harm_others" };
  }

  if (PANIC_PATTERNS.some((pattern) => pattern.test(text))) {
    return { level: "urgent_support", type: "panic" };
  }

  if (DISTRESS_PATTERNS.some((pattern) => pattern.test(text))) {
    return { level: "support", type: "distress" };
  }

  return { level: "none", type: null };
}

export function buildSupportReply(signal, preferences = {}) {
  const comfortStyle = (preferences.comfort_style || "calm").toLowerCase();
  const groundingPreference = (preferences.grounding_preference || "gentle").toLowerCase();

  const calmIntro =
    comfortStyle === "direct"
      ? "I hear you."
      : comfortStyle === "faith"
        ? "I hear you, and I am here with you."
        : "I hear you, and I am here with you.";

  if (signal.level === "support") {
    if (groundingPreference === "step_by_step") {
      return `${calmIntro} Let's slow this down together. Take one slow breath in, one slow breath out, and tell me the hardest part of this moment in one sentence.`;
    }
    return `${calmIntro} It sounds like you are carrying a lot right now. Take one slow breath with me. If you want, tell me what feels heaviest and I will stay with you one step at a time.`;
  }

  if (signal.level === "urgent_support") {
    return `${calmIntro} I want to help you steady this moment. Put both feet on the ground if you can. Breathe in for four, hold for four, and breathe out for six. If you are in immediate physical danger or feel unsafe medically, call 911 now.`;
  }

  if (signal.type === "self_harm") {
    return "I am really glad you said something. Your safety matters right now. Please call or text 988 right now for immediate support. If you are in immediate danger, call 911 now. I can stay focused on getting you through the next moment.";
  }

  if (signal.type === "harm_others") {
    return "I am concerned about safety right now. Please put distance between yourself and anyone you might hurt, and call 911 or your local emergency number immediately if there is immediate danger. I need to keep this focused on safety.";
  }

  return null;
}

export default {
  detectSafetySignal,
  buildSupportReply,
};
