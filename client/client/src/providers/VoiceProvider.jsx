import { createContext, useContext, useState, useEffect } from "react";

const VoiceContext = createContext();

export const VoiceProvider = ({ children }) => {
  const [voice, setVoice] = useState("google_en_us");
  const [engineReady, setEngineReady] = useState(false);

  useEffect(() => {
    fetch("/api/voice")
      .then(res => res.json())
      .then(data => {
        setVoice(data.voice || "google_en_us");
        setEngineReady(true);
      })
      .catch(() => setEngineReady(true));
  }, []);

  const updateVoice = (newVoice) => {
    setVoice(newVoice);

    fetch("/api/voice/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: newVoice }),
    }).catch(() => {});
  };

  const speak = (text) => {
    if (!engineReady) return;

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    speechSynthesis.speak(utter);
  };

  return (
    <VoiceContext.Provider value={{ voice, updateVoice, speak }}>
      {children}
    </VoiceContext.Provider>
  );
};

export const useVoice = () => useContext(VoiceContext);
