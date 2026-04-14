import { useState, useEffect, useRef, useCallback } from "react";

const WAKE_WORD = "hey dex";

export function useDexVoice({ onWakeWord, onTranscript, enabled = true }) {
  const [status, setStatus] = useState("idle"); // idle | listening | active | speaking
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef(null);
  const listeningForCommandRef = useRef(false);
  const synthRef = useRef(window.speechSynthesis);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    setIsSupported(!!SpeechRecognition);
    if (!SpeechRecognition || !enabled) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      const results = Array.from(event.results);
      const lastResult = results[results.length - 1];
      const transcript = lastResult[0].transcript.toLowerCase().trim();

      if (!listeningForCommandRef.current) {
        // Listening for wake word
        if (transcript.includes(WAKE_WORD)) {
          listeningForCommandRef.current = true;
          setStatus("active");
          onWakeWord?.();
          // Reset after 10 seconds if no command
          setTimeout(() => {
            listeningForCommandRef.current = false;
            setStatus("listening");
          }, 10000);
        }
      } else {
        // Listening for command after wake word
        if (lastResult.isFinal && transcript.trim()) {
          const command = transcript.replace(WAKE_WORD, "").trim();
          if (command.length > 2) {
            listeningForCommandRef.current = false;
            setStatus("listening");
            onTranscript?.(command);
          }
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== "no-speech") {
        console.warn("Speech recognition error:", event.error);
      }
    };

    recognition.onend = () => {
      // Auto-restart to keep listening
      if (enabled) {
        try { recognition.start(); } catch {}
      }
    };

    try {
      recognition.start();
      setStatus("listening");
    } catch (err) {
      console.warn("Could not start speech recognition:", err);
    }

    return () => {
      try { recognition.stop(); } catch {}
    };
  }, [enabled]);

  const speak = useCallback((text) => {
    const synth = synthRef.current;
    if (!synth) return;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    // Try to pick a natural voice
    const voices = synth.getVoices();
    const preferred = voices.find(
      (v) => v.name.includes("Google US English") || v.name.includes("Samantha") || v.lang === "en-US"
    );
    if (preferred) utterance.voice = preferred;
    setStatus("speaking");
    utterance.onend = () => setStatus("listening");
    synth.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    synthRef.current?.cancel();
    setStatus("listening");
  }, []);

  return { status, isSupported, speak, stopSpeaking };
}
