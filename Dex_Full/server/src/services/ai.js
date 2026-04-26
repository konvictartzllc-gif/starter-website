import OpenAI from "openai";

let aiClient = null;
let aiProvider = null;

export async function initAI() {
  const provider = process.env.AI_PROVIDER || "openai";
  aiProvider = provider.toLowerCase();

  try {
    if (aiProvider === "groq") {
      aiClient = new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: "https://api.groq.com/openai/v1",
      });
      console.log("✅ AI Provider: Groq (Free & Fast)");
    } else if (aiProvider === "ollama") {
      aiClient = new OpenAI({
        apiKey: "ollama", // Ollama doesn't require a real key
        baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
      });
      console.log("✅ AI Provider: Ollama (Self-Hosted)");
    } else {
      // Default to OpenAI
      aiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      console.log("✅ AI Provider: OpenAI");
    }
  } catch (err) {
    console.error("AI initialization error:", err.message);
    aiClient = null;
  }
}

export function getAIClient() {
  if (!aiClient) {
    throw new Error("AI client not initialized. Call initAI() first.");
  }
  return aiClient;
}

export function getAIProvider() {
  return aiProvider || "openai";
}

export async function chat(messages, options = {}) {
  if (!aiClient) throw new Error("AI client not initialized");

  const model = options.model || getModelForProvider();
  const temperature = options.temperature || 0.85;
  const maxTokens = options.maxTokens || 500;

  try {
    const response = await aiClient.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error(`AI error (${aiProvider}):`, err.message);
    throw err;
  }
}

function getModelForProvider() {
  switch (aiProvider) {
    case "groq":
      return "mixtral-8x7b-32768"; // Fast and free on Groq
    case "ollama":
      return "llama2"; // Or "mistral", "neural-chat", etc.
    default:
      return process.env.OPENAI_MODEL || "gpt-4.1-mini";
  }
}