//  Dex v2: Response Styler 
// Adjusts Dex reply tone/style based on detected user mood.
// Works with toneDetection.js to create empathetic responses.

const STYLE_MAP = {
    frustrated: {
          prefix: "I hear you, and I'm sorry for the trouble.",
          emoji: "",
          style: "empathetic",
          maxLength: 200,
    },
    urgent: {
          prefix: "On it  here's what you need right now:",
          emoji: "",
          style: "concise",
          maxLength: 150,
    },
    happy: {
          prefix: "",
          emoji: "",
          style: "warm",
          maxLength: 300,
    },
    playful: {
          prefix: "",
          emoji: "",
          style: "casual",
          maxLength: 300,
    },
    confused: {
          prefix: "Let me break that down for you:",
          emoji: "",
          style: "structured",
          maxLength: 250,
    },
    sad: {
          prefix: "I understand this is tough.",
          emoji: "",
          style: "gentle",
          maxLength: 200,
    },
};

const DEFAULT_STYLE = {
    prefix: "",
    emoji: "",
    style: "neutral",
    maxLength: 300,
};

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

export default { styleResponse, STYLE_MAP, DEFAULT_STYLE };
