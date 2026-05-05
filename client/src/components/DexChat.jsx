import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { api } from "../utils/api.js";
import { useDexVoice } from "../hooks/useDexVoice.js";
import { useAuth } from "../hooks/useAuth.jsx";

const DEX_AVATAR = "D";

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
  const messagesEndRef = useRef(null);

  const { status, isSupported, speak, stopSpeaking } = useDexVoice({
    enabled: true,
    onWakeWord: ({ spokenCommand } = {}) => {
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
      setOpen(true);
      sendMessage(text);
    },
  });

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

  function showToast(msg) {
    setToast(msg);
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => setToast(""), 3000);
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
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-brand text-white shadow-lg hover:bg-brand-light transition-colors"
        aria-label={open ? "Close Dex chat" : "Open Dex chat"}
      >
        <span className="text-lg font-bold">{DEX_AVATAR}</span>
      </button>

      {toast && (
        <div className="fixed bottom-24 right-5 z-40 max-w-xs rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 shadow-lg">
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

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
              Say "Hey Dex" once to wake voice mode, then keep talking naturally.
            </div>
          </form>
        </section>
      )}
    </>
  );
}
