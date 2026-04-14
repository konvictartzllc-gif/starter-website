import { useState, useEffect, useRef } from "react";
import { api } from "../utils/api.js";
import { useDexVoice } from "../hooks/useDexVoice.js";
import { useAuth } from "../hooks/useAuth.js";

const DEX_AVATAR = "🤖";

export default function DexChat() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hey! I'm Dex — your Konvict Artz assistant. What can I help you with today?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [accessError, setAccessError] = useState(null);
  const messagesEndRef = useRef(null);

  const { status, isSupported, speak, stopSpeaking } = useDexVoice({
    enabled: true,
    onWakeWord: () => {
      setOpen(true);
      showToast("Hey! I'm listening — go ahead 🎤");
    },
    onTranscript: (text) => {
      sendMessage(text);
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function sendMessage(text) {
    const trimmed = (text || input).trim();
    if (!trimmed) return;
    setInput("");

    if (!user) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed },
        { role: "assistant", content: "Hey! You'll need to sign up or log in first to chat with me. It's free for 3 days — no credit card needed!" },
      ]);
      return;
    }

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setLoading(true);

    try {
      const data = await api.chat(trimmed);
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      speak(data.reply);

      if (data.appointmentIntent) {
        showToast("📅 Want me to add that to your calendar? Just confirm!");
      }
    } catch (err) {
      if (err.error === "trial_expired" || err.error === "subscription_expired") {
        setAccessError(err.message);
        setMessages((prev) => [...prev, { role: "assistant", content: err.message }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Hmm, something went wrong on my end. Give me a sec and try again!" },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const statusColor = {
    idle: "bg-gray-500",
    listening: "bg-green-500",
    active: "bg-brand animate-pulse",
    speaking: "bg-blue-500",
  }[status] || "bg-gray-500";

  return (
    <>
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-brand text-white px-4 py-2 rounded-full shadow-lg text-sm fade-in">
          {toast}
        </div>
      )}

      {/* Voice status indicator */}
      {isSupported && (
        <div className="fixed bottom-24 right-6 z-40 flex items-center gap-2 text-xs text-gray-400">
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          {status === "listening" && "Listening for Hey Dex..."}
          {status === "active" && "Go ahead, I'm listening!"}
          {status === "speaking" && "Dex is speaking..."}
        </div>
      )}

      {/* Chat toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-brand shadow-lg flex items-center justify-center text-2xl hover:bg-brand-light transition-all relative"
        aria-label="Open Dex AI Chat"
      >
        {open ? "✕" : DEX_AVATAR}
        {status === "active" && (
          <span className="absolute inset-0 rounded-full border-2 border-brand animate-ping" />
        )}
      </button>

      {/* Chat window */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-80 sm:w-96 bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 flex flex-col fade-in" style={{ height: "480px" }}>
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700 bg-brand rounded-t-2xl">
            <span className="text-2xl">{DEX_AVATAR}</span>
            <div>
              <p className="font-bold text-white text-sm">Dex AI</p>
              <p className="text-xs text-purple-200">Konvict Artz Assistant</p>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${statusColor}`} />
              <span className="text-xs text-purple-200 capitalize">{status}</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} fade-in`}>
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-brand text-white rounded-br-sm"
                      : "bg-gray-800 text-gray-100 rounded-bl-sm"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 text-gray-400 px-3 py-2 rounded-2xl rounded-bl-sm text-sm">
                  <span className="animate-pulse">Dex is typing...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Subscribe CTA if access expired */}
          {accessError && (
            <div className="px-4 py-2 bg-yellow-900/50 border-t border-yellow-700 text-xs text-yellow-300 text-center">
              <a href="/subscribe" className="underline font-semibold">Subscribe for $9.99/month</a> to keep chatting with Dex
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-gray-700 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type or say Hey Dex..."
              className="flex-1 bg-gray-800 text-white text-sm rounded-xl px-3 py-2 outline-none border border-gray-600 focus:border-brand"
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="bg-brand hover:bg-brand-light disabled:opacity-40 text-white rounded-xl px-3 py-2 text-sm font-semibold transition-all"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
