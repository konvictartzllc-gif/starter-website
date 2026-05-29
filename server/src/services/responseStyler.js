//  Dex v2: Response Styler 
// Adjusts Dex reply tone/style based on detected user mood.
// Works with toneDetection.js to create empathetic responses.

const STYLE_MAP = {
    angry: {
          prefix: "I hear the frustration.",
          emoji: "",
          style: "calm",
          maxLength: 420,
          instruction: "The user sounds angry. Stay calm, do not argue, acknowledge the frustration, lower the emotional temperature, and give one clear next step at a time.",
    },
    frustrated: {
          prefix: "I hear you, and I'm sorry for the trouble.",
          emoji: "",
          style: "empathetic",
          maxLength: 420,
          instruction: "The user sounds frustrated. Validate the friction, be practical, avoid blame, and move quickly into a fix.",
    },
    urgent: {
          prefix: "On it. Here's what you need right now:",
          emoji: "",
          style: "concise",
          maxLength: 360,
          instruction: "The user sounds urgent. Be brief, direct, and action-first. Put the immediate next step first.",
    },
    happy: {
          prefix: "",
          emoji: "",
          style: "warm",
          maxLength: 520,
          instruction: "The user sounds happy. Keep the momentum, match the positive energy, and help them build on the win without overdoing it.",
    },
    playful: {
          prefix: "",
          emoji: "",
          style: "casual",
          maxLength: 520,
          instruction: "The user sounds playful. Stay warm and casual while still being useful.",
    },
    confused: {
          prefix: "Let me break that down for you:",
          emoji: "",
          style: "structured",
          maxLength: 420,
          instruction: "The user sounds confused. Explain in simple steps, avoid jargon, and check that the next action is clear.",
    },
    sad: {
          prefix: "I'm here with you.",
          emoji: "",
          style: "gentle",
          maxLength: 420,
          instruction: "The user sounds sad. Be gentle and supportive, offer comfort first, then a small doable step. Do not sound robotic or dismissive.",
    },
    anxious: {
          prefix: "Let's slow it down together.",
          emoji: "",
          style: "grounding",
          maxLength: 420,
          instruction: "The user sounds anxious or stressed. Use a steady voice, reduce pressure, and give one grounding or organizing step before solving.",
    },
};

const DEFAULT_STYLE = {
    prefix: "",
    emoji: "",
    style: "neutral",
    maxLength: 300,
    instruction: "The user sounds neutral. Be natural, helpful, and concise.",
};

export function getToneInstruction(tone) {
    const config = STYLE_MAP[tone] || DEFAULT_STYLE;
    return config.instruction;
}

/**
 * Apply tone-aware styling to a response.
 * @param {string} response - The raw response text
 * @param {string|null} tone - Detected tone from toneDetection.js
 * @returns {{ text: string, meta: object }}
 */
export function styleResponse(response, tone) {
    const config = STYLE_MAP[tone] || DEFAULT_STYLE;
    let styled = response;

  if (config.prefix) {
        styled = `${config.prefix} ${styled}`;
  }
    if (config.emoji) {
          styled = `${styled} ${config.emoji}`;
    }
    if (styled.length > config.maxLength) {
          styled = styled.slice(0, config.maxLength).trimEnd() + "...";
    }

  return {
        text: styled,
        meta: {
                appliedStyle: config.style,
                detectedTone: tone || "neutral",
                truncated: styled.length > config.maxLength,
        },
  };
}

export default { styleResponse, getToneInstruction, STYLE_MAP, DEFAULT_STYLE };
