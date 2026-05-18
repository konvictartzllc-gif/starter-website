import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../utils/api.js";
import { useDexVoice } from "../hooks/useDexVoice.js";
import { useAuth } from "../hooks/useAuth.jsx";

const DEX_AVATAR = "D";
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
];
const GAME_TYPES = ["Riddle", "Trivia", "Memory", "Would You Rather", "Guess"];

function isAccessBlocked(errorCode) {
  return errorCode === "trial_expired" || errorCode === "subscription_expired" || errorCode === "no_access";
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
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [gamePrompt, setGamePrompt] = useState(GAME_PROMPTS[0]);
  const [gameAnswer, setGameAnswer] = useState("");
  const [gameFeedback, setGameFeedback] = useState("");
  const [mascotLineIndex, setMascotLineIndex] = useState(0);
  const messagesEndRef = useRef(null);

  const { status, isSupported, lastHeard, error: voiceError, speak, stopSpeaking, sleep } = useDexVoice({
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

  function pickGame(type) {
    const options = type ? GAME_PROMPTS.filter((game) => game.type === type) : GAME_PROMPTS;
    const next = options[Math.floor(Math.random() * options.length)] || GAME_PROMPTS[0];
    setGamePrompt(next);
    setGameAnswer("");
    setGameFeedback("");
    setGameOpen(true);
    setOpen(true);
  }

  function enableWakeMode() {
    setWakeEnabled(true);
    setOpen(true);
    const message = "Wake mode is on. Say Hey Dex once, then keep talking naturally.";
    showToast(message);
    speak(message);
  }

  function submitGameAnswer(e) {
    e.preventDefault();
    const answer = gameAnswer.trim().toLowerCase();
    if (!answer && gamePrompt.answer) return;
    const correct =
      !gamePrompt.answer ||
      answer.includes(gamePrompt.answer) ||
      gamePrompt.answer.split(" ").every((token) => answer.includes(token)) ||
      (gamePrompt.answer === "six" && answer.includes("6"));
    const feedback = correct ? gamePrompt.reply : `Good try. I was looking for: ${gamePrompt.answer}.`;
    setGameFeedback(feedback);
    speak(feedback);
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
      showToast(`Voice error: ${event.error}`);
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
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
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
      <div className="dex-mascot fixed bottom-5 right-5 z-40">
        <div className="dex-mascot-bubble" aria-live="polite">{mascotLine}</div>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={`dex-companion dex-robot-button text-white shadow-lg transition-colors ${status === "listening" ? "dex-pulse" : ""}`}
          aria-label={open ? "Close Dex chat" : "Open Dex chat"}
        >
          <span className="dex-robot-antenna" aria-hidden="true" />
          <span className="dex-robot-ear dex-robot-ear-left" aria-hidden="true" />
          <span className="dex-robot-ear dex-robot-ear-right" aria-hidden="true" />
          <span className="dex-face relative z-10 text-lg font-bold">{DEX_AVATAR}</span>
          <span className="dex-robot-body" aria-hidden="true">
            <span />
            <span />
          </span>
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-32 right-5 z-40 max-w-xs rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 shadow-lg">
          {toast}
        </div>
      )}

      {open && (
        <section className="fixed bottom-24 right-5 z-40 flex h-[34rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-gray-800 bg-gray-950 shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-white">Dex</div>
              <div className="text-xs text-gray-400">
                {isSupported ? `Voice ${status}` : "Voice not supported here"}
              </div>
              {voiceError && (
                <div className="text-xs text-red-300">Voice error: {voiceError}</div>
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
              onClick={enableWakeMode}
              disabled={wakeEnabled}
              className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-100 hover:border-brand disabled:opacity-60"
            >
              {wakeEnabled ? "Wake On" : "Wake"}
            </button>
            <button
              type="button"
              onClick={() => pickGame()}
              className="rounded-md border border-gray-700 px-3 py-2 text-xs font-semibold text-gray-100 hover:border-brand"
            >
              Play
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
            {gameOpen && (
              <div className="rounded-lg border border-brand/40 bg-brand/10 p-3 text-sm text-gray-100">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="font-medium text-white">Dex Game: {gamePrompt.type}</p>
                  <button
                    type="button"
                    onClick={() => pickGame(gamePrompt.type)}
                    className="text-xs text-brand hover:text-brand-light"
                  >
                    New
                  </button>
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
                <form onSubmit={submitGameAnswer} className="mt-3 flex gap-2">
                  <input
                    value={gameAnswer}
                    onChange={(e) => setGameAnswer(e.target.value)}
                    placeholder={gamePrompt.answer ? "Your answer..." : "Your choice..."}
                    className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white outline-none focus:border-brand"
                  />
                  <button
                    type="submit"
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
