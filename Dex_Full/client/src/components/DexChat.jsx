import { useState, useEffect, useRef } from "react";
import { api } from "../utils/api.js";
import { useDexVoice } from "../hooks/useDexVoice.js";
import { useAuth } from "../hooks/useAuth.jsx";

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

  // —— VOICE HOOKS ———————————————————————————————————————————————
  const { status, isSupported, speak, stopSpeaking } = useDexVoice({
    enabled: true,
    onWakeWord: ({ spokenCommand } = {}) => {
      setOpen(true);
      if (spokenCommand?.trim()) {
        showToast(`Heard: ${spokenCommand}`);
        return;
      }
      const wakeReply = "I'm here — what can I help you with?";
      showToast(wakeReply);
      speak(wakeReply);
    },
    onTranscript: (text) => {
      setOpen(true);
      sendMessage(text);
    },
  });

  // —— CALL EVENT POLLING WITH PROGRESSIVE UNLOCK —————————————————
  useEffect(() => {
    if (!user) return;
    let lastTimestamp = null;
    let unlocked = false;
    let interval = setInterval(async () => {
      try {
        // Check if call feature is unlocked
        const { memory } = await api.getMemory();
        unlocked = memory && memory.call_feature_unlocked === "1";
        if (!unlocked) {
          // If user has had 3+ calls, offer to unlock
          const { events } = await api.getCallEvents();
          const incomingCalls = events.filter(e => e.event === "incoming");
          if (incomingCalls.length >= 3 && (!memory || memory.call_feature_unlocked !== "1")) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "I've noticed you get a lot of calls. Would you like me to announce callers and help you accept or decline? (Go to Settings to enable)" },
            ]);
            await api.setMemory("call_feature_unlocked", "1");
          }
        } else {
          // Feature unlocked: announce calls
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
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [user, speak]);

  // —— USER MEMORY HOOKS ———————————————————————————————————————————
  useEffect(() => {
    if (!user) return;
    // On mount, load user memory (e.g., preferences)
    api.getMemory().then(({ memory }) => {
      // Example: show a welcome back message if a name is stored
      if (memory && memory.name) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Welcome back, ${memory.name}!` },
        ]);
      }
    }).catch(() => {});
  }, [user]);

  // Example: Dex learns user's name if provided
  async function handleLearnName(name) {
    if (!user) return;
    await api.setMemory("name", name);
    showToast(`I'll remember your name is ${name}.`);
  }
  const messagesEndRef = useRef(null);



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
      const guestReply = "Hey! You'll need to sign up or log in first to chat with me. It's free for 3 days — no credit card needed!";
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
        showToast("📅 Want me to add that to your calendar? Just confirm!");
      }
    } catch (err) {
      if (err.error === "trial_expired" || err.error === "subscription_expired") {
        setAccessError(err.message);
        setMessages((prev) => [...prev, { role: "assistant", content: err.message }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, something went wrong. Please try again later." },
        ]);
      }
    }
  }

  // ...existing code for the rest of the DexChat component...
}