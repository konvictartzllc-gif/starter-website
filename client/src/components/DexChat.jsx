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
  const messagesEndRef = useRef(null);


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
