import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../utils/api.js";
import { useDexVoice } from "../hooks/useDexVoice.js";
import { useAuth } from "../hooks/useAuth.jsx";

const DEX_AVATAR = "D";
const WAKE_ENABLED_STORAGE_KEY = "dex_wake_enabled";
const MASCOT_LINES = [
  "Say Hey Dex",
  "Need help?",
  "I can teach, plan, or play.",
  "Tap me anytime.",
];
const GAME_PROMPTS = [
  {
    type: "Riddle",
    prompt: "What has to be broken before you can use it?",
    answer: "egg",
    reply: "Yep. An egg. Dex approves that breakfast logic.",
  },
  {
    type: "Riddle",
    prompt: "What gets wetter the more it dries?",
    answer: "towel",
    reply: "Correct. A towel. Low drama, high utility.",
  },
  {
    type: "Riddle",
    prompt: "What has hands but can not clap?",
    answer: "clock",
    reply: "Correct. A clock has hands, but no applause.",
  },
  {
    type: "Riddle",
    prompt: "What has a face and two hands but no arms or legs?",
    answer: "clock",
    reply: "Right. A clock. Dex likes a clean solve.",
  },
  {
    type: "Trivia",
    prompt: "Trivia time. Which planet is known as the Red Planet?",
    answer: "mars",
    reply: "Correct. Mars is the Red Planet.",
  },
  {
    type: "Trivia",
    prompt: "What is the largest ocean on Earth?",
    answer: "pacific",
    reply: "Correct. The Pacific Ocean is the largest.",
  },
  {
    type: "Trivia",
    prompt: "How many sides does a hexagon have?",
    answer: "six",
    reply: "Right. A hexagon has six sides.",
  },
  {
    type: "Would You Rather",
    prompt: "Would you rather explore space for a week or the deep ocean for a week?",
    answer: "",
    reply: "That says a lot about your vibe.",
  },
  {
    type: "Would You Rather",
    prompt: "Would you rather have the perfect playlist for every mood or always know the best food spot nearby?",
    answer: "",
    reply: "Solid choice. Dex can work with that vibe.",
  },
  {
    type: "Would You Rather",
    prompt: "Would you rather have one extra day every weekend or one extra hour every morning?",
    answer: "",
    reply: "That is a strong life choice.",
  },
  {
    type: "Memory",
    prompt: "Memory round. Remember these words, then type them back: moon, star, cloud.",
    answer: "moon star cloud",
    reply: "Nice. You kept the pattern together.",
  },
  {
    type: "Memory",
    prompt: "Memory round. Remember these words, then type them back: river, peach, drum.",
    answer: "river peach drum",
    reply: "Clean recall. Dex is impressed.",
  },
  {
    type: "Guess",
    prompt: "Guess my number from 1 to 5.",
    answer: "3",
    reply: "You got it. Dex picked 3.",
  },
  {
    type: "Quick Math",
    prompt: "Quick math. What is 8 + 7?",
    answer: "15",
    reply: "Sharp. Fifteen it is.",
  },
  {
    type: "Quick Math",
    prompt: "Quick math. If you have 3 orders and each has 4 items, how many items is that?",
    answer: "12",
    reply: "Correct. Twelve items. Clean count.",
  },
  {
    type: "Word Scramble",
    prompt: "Unscramble this word: T R A Z",
    answer: "artz",
    reply: "Nice. Artz was hiding in plain sight.",
  },
  {
    type: "Word Scramble",
    prompt: "Unscramble this word: X E D",
    answer: "dex",
    reply: "Exactly. Dex knows his own name.",
  },
  {
    type: "This or That",
    prompt: "This or That: studio session or live show?",
    answer: "",
    reply: "That choice has a whole personality.",
  },
  {
    type: "This or That",
    prompt: "This or That: build the plan first or freestyle and adjust?",
    answer: "",
    reply: "I can work with that mode.",
  },
  {
    type: "Mini Challenge",
    prompt: "Mini challenge: type one goal you want done today in 5 words or less.",
    answer: "",
    reply: "Locked in. Small goal, real momentum.",
  },
  {
    type: "Mini Challenge",
    prompt: "Mini challenge: name one thing you are grateful for today.",
    answer: "",
    reply: "Good. That keeps the day grounded.",
  },
];
const GAME_TYPES = ["Riddle", "Trivia", "Memory", "Would You Rather", "Guess", "Quick Math", "Word Scramble", "This or That", "Mini Challenge"];
const COIN_PACKS = [
  { id: "starter", label: "100 coins", price: "$1.99" },
  { id: "popular", label: "300 coins", price: "$4.99" },
  { id: "mega", label: "750 coins", price: "$9.99" },
];
const SHOP_SLOT_LABELS = {
  size: "Size",
  height: "Height",
  hair: "Hair",
  hat: "Hats",
  face: "Eyes",
  mouth: "Mouth",
  cheeks: "Cheeks",
  body: "Body",
};
const DEFAULT_DEX_COLORS = {
  bodyPrimary: "#dbeafe",
  bodySecondary: "#8b5cf6",
  face: "#070817",
  accent: "#a78bfa",
  hatPrimary: "#22d3ee",
  hatSecondary: "#facc15",
};
const DEX_COLOR_LABELS = [
  ["bodyPrimary", "Body"],
  ["bodySecondary", "Shadow"],
  ["face", "Face"],
  ["accent", "Eyes"],
  ["hatPrimary", "Hat"],
  ["hatSecondary", "Brim"],
];
const MEMORY_WORD_SETS = [
  ["moon", "star", "cloud"],
  ["river", "peach", "drum"],
  ["purple", "ticket", "studio"],
  ["crown", "mirror", "coin"],
  ["music", "paint", "spark"],
  ["window", "planet", "button"],
];
const SCRAMBLE_WORDS = ["artz", "dex", "music", "paint", "studio", "purple", "canvas", "rhythm"];
const QUICK_MATH_BUILDERS = [
  () => {
    const a = 4 + Math.floor(Math.random() * 14);
    const b = 3 + Math.floor(Math.random() * 12);
    return { prompt: `Quick math. What is ${a} + ${b}?`, answer: String(a + b) };
  },
  () => {
    const b = 2 + Math.floor(Math.random() * 7);
    const answer = 2 + Math.floor(Math.random() * 8);
    return { prompt: `Quick math. ${b} groups with ${answer} items each equals how many items?`, answer: String(b * answer) };
  },
  () => {
    const b = 2 + Math.floor(Math.random() * 8);
    const answer = 4 + Math.floor(Math.random() * 9);
    return { prompt: `Quick math. What is ${answer + b} - ${b}?`, answer: String(answer) };
  },
];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffledLetters(word) {
  const letters = word.toUpperCase().split("");
  for (let index = letters.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [letters[index], letters[swapIndex]] = [letters[swapIndex], letters[index]];
  }
  return letters.join(" ");
}

function buildGameRound(type, previous) {
  const roundType = type || randomItem(GAME_TYPES);
  if (roundType === "Memory") {
    let words = randomItem(MEMORY_WORD_SETS);
    if (previous?.type === "Memory" && MEMORY_WORD_SETS.length > 1) {
      while (words.join(" ") === previous.answer) words = randomItem(MEMORY_WORD_SETS);
    }
    return {
      type: "Memory",
      prompt: "Memory round. Study these words, then they will hide.",
      answer: words.join(" "),
      reply: "Nice. You kept the pattern together.",
      memoryWords: words,
    };
  }
  if (roundType === "Quick Math") {
    const next = randomItem(QUICK_MATH_BUILDERS)();
    return { type: "Quick Math", ...next, reply: "Sharp. You solved that one." };
  }
  if (roundType === "Guess") {
    const answer = String(1 + Math.floor(Math.random() * 5));
    return { type: "Guess", prompt: "Guess my number from 1 to 5.", answer, reply: `You got it. Dex picked ${answer}.` };
  }
  if (roundType === "Word Scramble") {
    let answer = randomItem(SCRAMBLE_WORDS);
    if (previous?.type === "Word Scramble" && SCRAMBLE_WORDS.length > 1) {
      while (answer === previous.answer) answer = randomItem(SCRAMBLE_WORDS);
    }
    return { type: "Word Scramble", prompt: `Unscramble this word: ${shuffledLetters(answer)}`, answer, reply: "Nice. You found it." };
  }
  const options = GAME_PROMPTS.filter((game) => game.type === roundType);
  let next = randomItem(options.length ? options : GAME_PROMPTS);
  if (options.length > 1) {
    while (next.prompt === previous?.prompt) next = randomItem(options);
  }
  return next;
}

function isAccessBlocked(errorCode) {
  return errorCode === "trial_expired" || errorCode === "subscription_expired" || errorCode === "no_access";
}

function cleanMediaQuery(value = "") {
  return String(value || "")
    .replace(/^.*?\b(?:and\s+)?(?:play|run|start)\b/i, "")
    .replace(/\b(?:on\s+)?(?:youtube|yt|music|song|track|video)\b/gi, " ")
    .replace(/\b(?:please|for me|right now|now)\b/gi, " ")
    .replace(/^(?:the\s+)?app\s+and\s+/i, "")
    .replace(/^(?:and\s+)?(?:open|play|run|start)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlayConfirmation(message = "") {
  return /\b(?:yes|yeah|yep|ok|okay|sure)?\s*(?:play|open|run|start)\s+(?:it|that|this)\b/i.test(String(message || "").trim());
}

function getLocalOpenAction(message = "") {
  const text = String(message || "").trim();
  if (!text) return null;

  if (/\b(open|pull up|launch)\s+(?:the\s+)?(?:youtube|yt)\b/i.test(text) && !/\b(play|run|start)\b/i.test(text)) {
    return {
      reply: "Opening YouTube.",
      webAction: { type: "youtube", query: "", url: "https://www.youtube.com", autoOpen: true, intent: "open" },
    };
  }

  const mediaMatch =
    text.match(/\b(?:play|run|start)\s+(?:the\s+)?(?:song|track|music|video)?\s*(.+)/i) ||
    text.match(/\b(?:open|pull up|launch)\s+(.+?)\s+(?:on\s+)?(?:youtube|yt)\b/i);
  const query = cleanMediaQuery(mediaMatch?.[1]);
  if (!query || /^(?:a\s+)?(?:game|games|riddle|trivia|quiz)$/i.test(query)) return null;

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return {
    reply: `Opening YouTube for "${query}".`,
    webAction: { type: "youtube", query, url, autoOpen: true, intent: "play" },
  };
}

function openReturnedAction(action) {
  if (!action?.url || !action.autoOpen) return false;
  const opened = window.open(action.url, "_blank", "noopener,noreferrer");
  if (opened) return true;
  window.location.assign(action.url);
  return true;
}

export default function DexChat() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hey! I'm Dex, your Konvict Artz assistant. What can I help you with today?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [accessError, setAccessError] = useState(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [wakeEnabled, setWakeEnabled] = useState(() => window.localStorage.getItem(WAKE_ENABLED_STORAGE_KEY) !== "0");
  const [gameOpen, setGameOpen] = useState(false);
  const [gamePrompt, setGamePrompt] = useState(() => buildGameRound("Riddle"));
  const [gameAnswer, setGameAnswer] = useState("");
  const [gameFeedback, setGameFeedback] = useState("");
  const [gameStats, setGameStats] = useState({ streak: 0, played: 0 });
  const [memoryVisible, setMemoryVisible] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [shop, setShop] = useState({ coins: 0, owned: {}, equipped: {}, colors: DEFAULT_DEX_COLORS, items: [] });
  const [mascotLineIndex, setMascotLineIndex] = useState(0);
  const messagesEndRef = useRef(null);
  const memoryTimerRef = useRef(null);
  const chatInputRef = useRef(null);
  const launcherTapRef = useRef(0);
  const lastPlayableActionRef = useRef(null);

  const { status, isSupported, lastHeard, error: voiceError, speak, stopSpeaking, startListening, sleep } = useDexVoice({
    enabled: wakeEnabled,
    stayAwake: true,
    onWakeWord: ({ spokenCommand } = {}) => {
      clearSleepHint();
      setOpen(true);
      if (spokenCommand?.trim()) {
        showToast(`Heard: ${spokenCommand}`);
        return;
      }
      const wakeReply = "I'm here. What can I help you with?";
      showToast(wakeReply);
      speak(wakeReply);
    },
    onTranscript: (text) => {
      clearSleepHint();
      setOpen(true);
      sendMessage(text);
    },
    onIdlePrompt: () => {
      const message = "I'm still here. Anything else?";
      showToast(message);
      speak(message);
      window.clearTimeout(showToast.sleepHintTimeoutId);
      showToast.sleepHintTimeoutId = window.setTimeout(() => {
        sleep();
        showToast("Dex is back to wake mode. Say Hey Dex when you need me.");
      }, 7200);
    },
  });
  const mascotLine =
    toast ||
    (loading ? "Thinking..." : status === "speaking" ? "Talking..." : status === "active" ? "I'm listening." : MASCOT_LINES[mascotLineIndex]);
  const dexSizeClass = shop.equipped?.size === "size-small" ? "dex-size-small" : shop.equipped?.size === "size-big" ? "dex-size-big" : "";
  const dexHeightClass = shop.equipped?.height === "height-short" ? "dex-height-short" : shop.equipped?.height === "height-tall" ? "dex-height-tall" : "";
  const dexColors = { ...DEFAULT_DEX_COLORS, ...(shop.colors || {}) };
  const dexColorStyle = {
    "--dex-body-primary": dexColors.bodyPrimary,
    "--dex-body-secondary": dexColors.bodySecondary,
    "--dex-face-color": dexColors.face,
    "--dex-accent-color": dexColors.accent,
    "--dex-hat-primary": dexColors.hatPrimary,
    "--dex-hat-secondary": dexColors.hatSecondary,
  };

  useEffect(() => {
    if (!user) return;
    let lastTimestamp = null;
    let unlocked = false;
    const interval = setInterval(async () => {
      try {
        const { memory } = await api.getMemory();
        unlocked = memory && memory.call_feature_unlocked === "1";
        if (!unlocked) {
          const { events } = await api.getCallEvents();
          const incomingCalls = events.filter((e) => e.event === "incoming");
          if (incomingCalls.length >= 3 && (!memory || memory.call_feature_unlocked !== "1")) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "I've noticed you get a lot of calls. Would you like me to announce callers and help you accept or decline? Go to Settings to enable it." },
            ]);
            await api.setMemory("call_feature_unlocked", "1");
          }
        } else {
          const { events } = await api.getCallEvents();
          if (events && events.length > 0) {
            const latest = events[0];
            if (latest.event === "incoming" && latest.timestamp !== lastTimestamp) {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: `Incoming call from ${latest.caller}. Would you like to accept or decline?` },
              ]);
              speak(`Incoming call from ${latest.caller}. Would you like to accept or decline?`);
              lastTimestamp = latest.timestamp;
            }
          }
        }
      } catch {
        // Ignore background polling failures in the widget.
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [user, speak]);

  useEffect(() => {
    if (!user) return;
    api.getDexShop()
      .then(setShop)
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.getMemory()
      .then(({ memory }) => {
        if (memory && memory.name) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Welcome back, ${memory.name}!` },
          ]);
        }
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, accessError]);

  useEffect(() => () => window.clearTimeout(memoryTimerRef.current), []);

  useEffect(() => {
    window.localStorage.setItem(WAKE_ENABLED_STORAGE_KEY, wakeEnabled ? "1" : "0");
  }, [wakeEnabled]);

  useEffect(() => {
    if (open || toast) return;
    const interval = window.setInterval(() => {
      setMascotLineIndex((index) => (index + 1) % MASCOT_LINES.length);
    }, 5200);
    return () => window.clearInterval(interval);
  }, [open, toast]);

  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => setToast(""), 3000);
  }

  function clearSleepHint() {
    window.clearTimeout(showToast.sleepHintTimeoutId);
    showToast.sleepHintTimeoutId = null;
  }

  function startGameRound(next) {
    window.clearTimeout(memoryTimerRef.current);
    setGamePrompt(next);
    setGameAnswer("");
    setGameFeedback("");
    setMemoryVisible(Boolean(next.memoryWords));
    setGameOpen(true);
    setOpen(true);
    if (next.memoryWords) {
      memoryTimerRef.current = window.setTimeout(() => setMemoryVisible(false), 3200);
    }
  }

  function pickGame(type) {
    startGameRound(buildGameRound(type, gamePrompt));
  }

  async function loadShop() {
    if (!user) return;
    try {
      setShop(await api.getDexShop());
    } catch {}
  }

  function shuffleGame() {
    startGameRound(buildGameRound(null, gamePrompt));
  }

  function enableWakeMode() {
    setWakeEnabled(true);
    setOpen(true);
    window.setTimeout(() => startListening(), 25);
    const message = isSupported
      ? "Wake mode is on. Keep this page open and say Hey Dex."
      : "Wake mode needs browser speech support. Tap Talk or use the Android app for always-ready wake word.";
    showToast(message);
  }

  function openDexQuickActions(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const now = Date.now();
    if (now - launcherTapRef.current < 350) return;
    launcherTapRef.current = now;
    setOpen(true);
    setGameOpen(false);
    setShopOpen(false);
    showToast("Dex is open. Tap Talk, Wake, Games, or Store.");
  }

  function openDexPanel() {
    setWakeEnabled(true);
    setGameOpen(false);
    setShopOpen(false);
    setOpen(true);
    window.setTimeout(() => startListening(), 50);
    if (!isSupported) {
      showToast("Voice is not supported in this browser. You can still type to Dex.");
    }
  }

  function openDexTextPanel() {
    setOpen(true);
    setGameOpen(false);
    setShopOpen(false);
    window.setTimeout(() => chatInputRef.current?.focus(), 80);
  }

  function openDexGamesPanel() {
    setWakeEnabled(true);
    setShopOpen(false);
    setOpen(true);
    pickGame();
  }

  function openDexStorePanel() {
    setWakeEnabled(true);
    setGameOpen(false);
    setShopOpen(true);
    setOpen(true);
    loadShop();
  }

  function submitGameAnswer(e) {
    e.preventDefault();
    if (gameFeedback || memoryVisible) return;
    const answer = gameAnswer.trim().toLowerCase();
    if (!answer && gamePrompt.answer) return;
    const correct =
      !gamePrompt.answer ||
      answer.includes(gamePrompt.answer) ||
      gamePrompt.answer.split(" ").every((token) => answer.includes(token)) ||
      (gamePrompt.answer === "six" && answer.includes("6"));
    setGameStats((prev) => ({
      played: prev.played + 1,
      streak: correct ? prev.streak + 1 : 0,
    }));
    const nextStreak = correct ? gameStats.streak + 1 : 0;
    const feedback = correct
      ? `${gamePrompt.reply} Streak: ${nextStreak}.`
      : gamePrompt.answer
        ? `Good try. I was looking for: ${gamePrompt.answer}. Streak reset, but we run it back.`
        : gamePrompt.reply;
    setGameFeedback(feedback);
    speak(feedback);
    if (correct) {
      api.rewardDexCoins({ won: true })
        .then((nextShop) => {
          setShop(nextShop);
          showToast(`+${nextShop.awarded || 5} Dex coins`);
        })
        .catch(() => {});
    }
    window.setTimeout(() => startGameRound(buildGameRound(gamePrompt.type, gamePrompt)), correct ? 1500 : 2100);
  }

  async function buyAccessory(itemId) {
    try {
      const nextShop = await api.purchaseDexAccessory(itemId);
      setShop(nextShop);
      showToast("Dex accessory equipped.");
    } catch (err) {
      showToast(err?.message || "Not enough coins yet.");
    }
  }

  function updateDexColor(key, value) {
    setShop((prev) => ({
      ...prev,
      colors: { ...DEFAULT_DEX_COLORS, ...(prev.colors || {}), [key]: value },
    }));
  }

  async function saveDexColors() {
    try {
      const nextShop = await api.saveDexColors(dexColors);
      setShop(nextShop);
      showToast("Dex colors saved.");
    } catch (err) {
      showToast(err?.message || "Could not save Dex colors.");
    }
  }

  async function buyCoins(packId) {
    try {
      const data = await api.createCoinCheckout(packId);
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
    } catch (err) {
      showToast(err?.message || "Could not open coin checkout.");
    }
  }

  function startVoiceCommand() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Voice dictation is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let latestTranscript = "";

    recognition.onstart = () => {
      setVoiceBusy(true);
      setOpen(true);
      showToast("Listening now...");
    };
    recognition.onresult = (event) => {
      const results = Array.from(event.results);
      const lastResult = results[results.length - 1];
      latestTranscript = lastResult[0].transcript.trim();
      if (latestTranscript) showToast(`Heard: ${latestTranscript}`);
      if (lastResult.isFinal && latestTranscript) {
        recognition.stop();
        sendMessage(latestTranscript);
      }
    };
    recognition.onerror = (event) => {
      setVoiceBusy(false);
      if (event.error === "network" || event.error === "aborted" || event.error === "no-speech") {
        showToast("Listening had a quick hiccup. Try again.");
        return;
      }
      showToast(`Listening issue: ${event.error}`);
    };
    recognition.onend = () => {
      setVoiceBusy(false);
      if (latestTranscript) return;
      showToast("I did not catch anything. Tap Talk and try again.");
    };

    try {
      recognition.start();
    } catch {
      setVoiceBusy(false);
      showToast("Voice could not start. Try refreshing the page.");
    }
  }

  async function handleCheckout() {
    setBillingBusy(true);
    try {
      const data = await api.createCheckoutSession();
      if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      throw new Error("Stripe checkout URL was missing.");
    } catch (err) {
      const message =
        err?.error === "payment_provider_unreachable"
          ? "I couldn't reach Stripe right now. Please try again in a moment."
          : (err?.message || "I couldn't open checkout right now.");
      setMessages((prev) => [...prev, { role: "assistant", content: message }]);
      showToast(message);
      setBillingBusy(false);
    }
  }

  async function sendMessage(text) {
    const trimmed = (text || input).trim();
    if (!trimmed || loading) return;
    setInput("");
    setAccessError(null);

    if (isPlayConfirmation(trimmed) && lastPlayableActionRef.current?.url) {
      const webAction = { ...lastPlayableActionRef.current, autoOpen: true, intent: "play" };
      const reply = webAction.query ? `Opening YouTube for "${webAction.query}".` : "Opening YouTube.";
      setOpen(true);
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: reply, webAction },
      ]);
      openReturnedAction(webAction);
      showToast("Opening YouTube...");
      speak(reply);
      return;
    }

    const localAction = getLocalOpenAction(trimmed);
    if (localAction) {
      lastPlayableActionRef.current = localAction.webAction;
      setOpen(true);
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: localAction.reply, webAction: localAction.webAction },
      ]);
      openReturnedAction(localAction.webAction);
      showToast(localAction.webAction.type === "youtube" ? "Opening YouTube..." : "Opening link...");
      speak(localAction.reply);
      return;
    }

    if (!user) {
      const guestReply = "Hey! You'll need to sign up or log in first to chat with me. It's free for 3 days with no card needed.";
      setOpen(true);
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: guestReply },
      ]);
      speak(guestReply);
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setLoading(true);

    try {
      const data = await api.chat(trimmed);
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply, webAction: data.webAction || null }]);
      if (data.webAction?.type === "youtube" && data.webAction?.url) {
        lastPlayableActionRef.current = data.webAction;
      }
      const actionOpened = openReturnedAction(data.webAction);
      if (actionOpened) {
        showToast(data.webAction?.type === "youtube" ? "Opening YouTube..." : "Opening link...");
      }
      speak(data.reply);

      if (data.appointmentIntent) {
        showToast("Want me to add that to your calendar? Just confirm.");
      }
    } catch (err) {
      if (isAccessBlocked(err.error)) {
        const message = err.message || "You'll need an active Dex subscription to keep going.";
        setAccessError({ code: err.error, message });
        setMessages((prev) => [...prev, { role: "assistant", content: message }]);
        speak(message);
      } else {
        const fallback = "Sorry, something went wrong. Please try again later.";
        setMessages((prev) => [...prev, { role: "assistant", content: fallback }]);
        showToast(err?.message || fallback);
        speak(fallback);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage();
  }

  return (
    <>
      <div className="dex-mascot fixed bottom-5 right-5 z-[9999]">
        <button
          type="button"
          onClick={openDexQuickActions}
          onPointerUp={openDexQuickActions}
          onTouchEnd={openDexQuickActions}
          className="dex-mascot-bubble text-left"
          aria-live="polite"
        >
          {mascotLine}
        </button>
        <button
          type="button"
          onClick={openDexQuickActions}
          onPointerUp={openDexQuickActions}
          onTouchEnd={openDexQuickActions}
          className={`dex-companion dex-robot-button ${dexSizeClass} ${dexHeightClass} text-white shadow-lg transition-colors ${status === "listening" ? "dex-pulse" : ""}`}
          style={dexColorStyle}
          aria-label="Open Dex quick actions"
        >
          <span className="dex-robot-antenna" aria-hidden="true" />
          <span className="dex-robot-ear dex-robot-ear-left" aria-hidden="true" />
          <span className="dex-robot-ear dex-robot-ear-right" aria-hidden="true" />
          {shop.equipped?.hat === "cap" && <span className="dex-accessory dex-hat-cap" aria-hidden="true" />}
          {shop.equipped?.hat === "crown" && <span className="dex-accessory dex-hat-crown" aria-hidden="true" />}
          {shop.equipped?.hair === "curls" && <span className="dex-accessory dex-hair-curls" aria-hidden="true" />}
          {shop.equipped?.hair === "mohawk" && <span className="dex-accessory dex-hair-mohawk" aria-hidden="true" />}
          {shop.equipped?.face === "glasses" && <span className="dex-accessory dex-glasses" aria-hidden="true" />}
          {shop.equipped?.face === "visor" && <span className="dex-accessory dex-visor" aria-hidden="true" />}
          <span className="dex-face relative z-10 text-lg font-bold">{DEX_AVATAR}</span>
          <span className="dex-default-smile" aria-hidden="true" />
          {shop.equipped?.mouth === "smile" && <span className="dex-accessory dex-mouth-smile" aria-hidden="true" />}
          {shop.equipped?.mouth === "cool" && <span className="dex-accessory dex-mouth-cool" aria-hidden="true" />}
          {shop.equipped?.cheeks === "blush" && <span className="dex-accessory dex-cheeks-blush" aria-hidden="true" />}
          {shop.equipped?.body === "bowtie" && <span className="dex-accessory dex-bowtie" aria-hidden="true" />}
          {shop.equipped?.body === "chain" && <span className="dex-accessory dex-chain" aria-hidden="true" />}
          <span className="dex-robot-body" aria-hidden="true">
            <span />
            <span />
          </span>
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-32 right-5 z-[9999] max-w-xs rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 shadow-lg">
          {toast}
        </div>
      )}

      {open && (
        <section className="dex-chat-panel fixed bottom-24 right-5 z-[9999] flex h-[34rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-white">Dex</div>
              <div className="text-xs text-gray-400">
                {isSupported ? `Voice ${status}` : "Voice not supported here"}
              </div>
              {voiceError && (
                <div className="text-xs text-amber-300">Listening issue: {voiceError}</div>
              )}
              {lastHeard && (
                <div className="max-w-[16rem] truncate text-xs text-gray-500">
                  Heard: {lastHeard}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                stopSpeaking();
                setOpen(false);
              }}
              className="text-sm text-gray-400 hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2 border-b border-gray-800 px-3 py-2 sm:flex">
            <button
              type="button"
              onClick={openDexTextPanel}
              className="rounded-md bg-gray-800 px-3 py-2 text-xs font-semibold text-white hover:bg-gray-700"
            >
              Text
            </button>
            <button
              type="button"
              onClick={enableWakeMode}
              disabled={wakeEnabled}
              className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-100 hover:border-brand disabled:opacity-60"
            >
              {wakeEnabled ? "Wake On" : "Wake"}
            </button>
            <button
              type="button"
              onClick={openDexGamesPanel}
              className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-100 hover:border-brand"
            >
              Games
            </button>
            <button
              type="button"
              onClick={openDexStorePanel}
              className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-100 hover:border-brand"
            >
              Store
            </button>
          </div>

          <div className="flex gap-2 border-b border-gray-800 px-3 py-2">
            <button
              type="button"
              onClick={startVoiceCommand}
              disabled={voiceBusy}
              className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-light disabled:opacity-60"
            >
              {voiceBusy ? "Listening..." : "Talk"}
            </button>
            <button
              type="button"
              onClick={() => speak("Hey, I'm Dex. Tap Talk and ask me anything, or tap Play for a quick game.")}
              className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-100 hover:border-brand"
            >
              Test Voice
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {shopOpen && (
              <div className="rounded-lg border border-brand/40 bg-gray-900 p-3 text-sm text-gray-100">
                <div className="mb-3 flex items-center justify-between">
                  <p className="font-medium text-white">Dex Shop</p>
                  <span className="rounded-full bg-brand/20 px-3 py-1 text-xs font-bold text-brand">{shop.coins || 0} coins</span>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  {COIN_PACKS.map((pack) => (
                    <button key={pack.id} type="button" onClick={() => buyCoins(pack.id)} className="rounded-md border border-gray-700 px-2 py-2 text-xs hover:border-brand">
                      <span className="block font-semibold text-white">{pack.label}</span>
                      <span className="text-gray-400">{pack.price}</span>
                    </button>
                  ))}
                </div>
                <div className="mb-3 rounded-md border border-gray-700 bg-gray-950 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-300">Dex Colors</p>
                    <button
                      type="button"
                      onClick={saveDexColors}
                      className="rounded-md border border-brand px-2 py-1 text-xs font-semibold text-white hover:bg-brand/20"
                    >
                      Save
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {DEX_COLOR_LABELS.map(([key, label]) => (
                      <label key={key} className="rounded-md border border-gray-800 bg-gray-900 px-2 py-2 text-xs text-gray-300">
                        <span className="mb-1 block">{label}</span>
                        <input
                          type="color"
                          value={dexColors[key]}
                          onChange={(e) => updateDexColor(key, e.target.value)}
                          className="h-8 w-full cursor-pointer rounded border border-gray-700 bg-transparent"
                          aria-label={`Dex ${label} color`}
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(shop.items || []).map((item) => {
                    const owned = Boolean(shop.owned?.[item.id]);
                    const equipped = shop.equipped?.[item.slot] === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => buyAccessory(item.id)}
                        className={`rounded-md border px-2 py-2 text-left text-xs ${equipped ? "border-brand bg-brand/20" : "border-gray-700 hover:border-brand"}`}
                      >
                        <span className="block text-[0.65rem] uppercase tracking-wide text-gray-500">{SHOP_SLOT_LABELS[item.slot] || item.slot}</span>
                        <span className="block font-semibold text-white">{item.name}</span>
                        <span className="text-gray-400">{owned ? (equipped ? "Equipped" : "Equip") : `${item.price} coins`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {gameOpen && (
              <div className="rounded-lg border border-brand/40 bg-brand/10 p-3 text-sm text-gray-100">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">Dex Game: {gamePrompt.type}</p>
                    <p className="text-xs text-gray-400">Played {gameStats.played} / Streak {gameStats.streak}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={shuffleGame}
                      className="text-xs text-brand hover:text-brand-light"
                    >
                      Shuffle
                    </button>
                    <button
                      type="button"
                      onClick={() => pickGame(gamePrompt.type)}
                      className="text-xs text-brand hover:text-brand-light"
                    >
                      New
                    </button>
                  </div>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  {GAME_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => pickGame(type)}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        gamePrompt.type === type
                          ? "border-brand bg-brand/20 text-white"
                          : "border-gray-700 text-gray-300 hover:border-brand"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <p className="text-gray-200">{gamePrompt.prompt}</p>
                {gamePrompt.memoryWords && (
                  <div className="mt-3 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-center">
                    {memoryVisible ? (
                      <p className="text-lg font-bold tracking-wide text-white">{gamePrompt.memoryWords.join("  |  ")}</p>
                    ) : (
                      <p className="text-sm text-gray-300">Words hidden. Type what you remember.</p>
                    )}
                  </div>
                )}
                <form onSubmit={submitGameAnswer} className="mt-3 flex gap-2">
                  <input
                    value={gameAnswer}
                    onChange={(e) => setGameAnswer(e.target.value)}
                    disabled={memoryVisible || Boolean(gameFeedback)}
                    placeholder={memoryVisible ? "Study first..." : gamePrompt.answer ? "Your answer..." : "Your choice..."}
                    className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-brand"
                  />
                  <button
                    type="submit"
                    disabled={memoryVisible || Boolean(gameFeedback)}
                    className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light"
                  >
                    Answer
                  </button>
                </form>
                {gameFeedback && <p className="mt-2 text-gray-300">{gameFeedback}</p>}
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "ml-auto bg-brand text-white"
                    : "bg-gray-900 text-gray-100 border border-gray-800"
                }`}
              >
                  {message.content}
                  {message.webAction?.url && (
                    <a
                      href={message.webAction.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block rounded-md border border-brand/60 px-3 py-2 text-center text-xs font-semibold text-brand hover:bg-brand/10"
                    >
                      {message.webAction.type === "youtube"
                        ? message.webAction.intent === "play" ? "Play on YouTube" : "Open YouTube"
                        : "Open Search"}
                    </a>
                  )}
              </div>
            ))}

            {accessError && (
              <div className="rounded-lg border border-brand/40 bg-brand/10 p-3 text-sm text-gray-100">
                <p className="font-medium text-white">Keep Dex going</p>
                <p className="mt-1 text-gray-300">{accessError.message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCheckout}
                    disabled={billingBusy}
                    className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
                  >
                    {billingBusy ? "Opening Stripe..." : "Subscribe Now"}
                  </button>
                  <Link
                    to={`/settings?billing=recovery&reason=${encodeURIComponent(accessError.code)}`}
                    className="rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-100 hover:border-gray-500"
                  >
                    Billing Settings
                  </Link>
                </div>
              </div>
            )}

            {loading && (
              <div className="max-w-[85%] rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-300">
                Dex is thinking...
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={handleSubmit} className="border-t border-gray-800 p-3">
            <div className="flex gap-2">
              <input
                ref={chatInputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={user ? "Ask Dex anything..." : "Log in to chat with Dex"}
                className="flex-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none placeholder:text-gray-500 focus:border-brand"
              />
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-light disabled:opacity-60"
              >
                Send
              </button>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Tap Talk for one command, or tap Wake once before saying "Hey Dex."
            </div>
          </form>
        </section>
      )}
    </>
  );
}
