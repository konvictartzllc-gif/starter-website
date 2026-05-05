import { useState, useEffect, useRef, useCallback } from "react";

const WAKE_WORD = "hey dex";
const VOICE_STORAGE_KEY = "dex_voice_name";

export function useDexVoice({ onWakeWord, onTranscript, enabled = true }) {
  const [status, setStatus] = useState("idle"); // idle | listening | active | speaking
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef(null);
  const listeningForCommandRef = useRef(false);
  const wakeTimeoutRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);
  const isSpeakingRef = useRef(false);
  const lastCommandRef = useRef({ text: "", at: 0 });

  const clearWakeTimeout = useCallback(() => {
    if (wakeTimeoutRef.current) {
      clearTimeout(wakeTimeoutRef.current);
      wakeTimeoutRef.current = null;
    }
  }, []);

  const shouldIgnoreCommand = useCallback((command) => {
    const now = Date.now();
    const isDuplicate =
      lastCommandRef.current.text === command &&
      now - lastCommandRef.current.at < 2500;
    if (isDuplicate) return true;
    lastCommandRef.current = { text: command, at: now };
    return false;
  }, []);

  useEffect(() => {
    synthRef.current = window.speechSynthesis;
  }, []);

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
      if (isSpeakingRef.current) return;

      const results = Array.from(event.results);
      const lastResult = results[results.length - 1];
      const transcript = lastResult[0].transcript.toLowerCase().trim();

      if (!listeningForCommandRef.current) {
        // Listening for wake word
        if (transcript.includes(WAKE_WORD)) {
          const spokenCommand = transcript.replace(WAKE_WORD, "").trim();
          listeningForCommandRef.current = true;
          setStatus("active");
          onWakeWord?.({ transcript, spokenCommand });

          // If the user says the wake phrase and command in the same utterance,
          // send it immediately instead of waiting for a second transcript.
          if (lastResult.isFinal && spokenCommand.length > 2) {
            if (shouldIgnoreCommand(spokenCommand)) return;
            clearWakeTimeout();
            listeningForCommandRef.current = false;
            setStatus("listening");
            onTranscript?.(spokenCommand);
            return;
          }

          // Reset after 10 seconds if no command
          clearWakeTimeout();
          wakeTimeoutRef.current = setTimeout(() => {
            listeningForCommandRef.current = false;
            setStatus("listening");
          }, 10000);
        }
      } else {
        // Listening for command after wake word
        if (lastResult.isFinal && transcript.trim()) {
          const command = transcript.replace(WAKE_WORD, "").trim();
          if (command.length > 2) {
            if (shouldIgnoreCommand(command)) return;
            clearWakeTimeout();
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
        if (event.error === "not-allowed") {
          alert(
            "Microphone access was blocked. Please enable microphone permissions in your browser settings to use voice features."
          );
        }
      }
    };

    recognition.onend = () => {
      // Auto-restart to keep listening
      if (enabled && !isSpeakingRef.current) {
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
      clearWakeTimeout();
      listeningForCommandRef.current = false;
      try { recognition.stop(); } catch {}
      recognitionRef.current = null;
      setStatus("idle");
    };
  }, [enabled, onWakeWord, onTranscript, clearWakeTimeout, shouldIgnoreCommand]);

  const speak = useCallback((text) => {
    const synth = synthRef.current;
    if (!synth || !text?.trim()) return;

    const speakNow = () => {
      isSpeakingRef.current = true;
      clearWakeTimeout();
      listeningForCommandRef.current = false;
      try { recognitionRef.current?.stop(); } catch {}
      synth.cancel();
      if (typeof synth.resume === "function") synth.resume();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 0.95;
      utterance.volume = 1.0;
      // Try to pick a natural voice
      const voices = synth.getVoices();
      const savedVoiceName = window.localStorage.getItem(VOICE_STORAGE_KEY);
      const preferred =
        voices.find((voice) => voice.name === savedVoiceName) ||
        voices.find(
          (voice) =>
            voice.name.includes("Google US English") ||
            voice.name.includes("Samantha") ||
            voice.lang === "en-US"
        );
      if (preferred) utterance.voice = preferred;
      setStatus("speaking");
      const resumeListening = () => {
        isSpeakingRef.current = false;
        setStatus("listening");
        try { recognitionRef.current?.start(); } catch {}
      };
      utterance.onend = resumeListening;
      utterance.onerror = resumeListening;
      synth.speak(utterance);
    };

    if (synth.getVoices().length === 0 && "onvoiceschanged" in synth) {
      synth.onvoiceschanged = () => {
        synth.onvoiceschanged = null;
        speakNow();
      };
    } else {
      speakNow();
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    const synth = synthRef.current;
    if (!synth) return;
    synth.cancel();
    isSpeakingRef.current = false;
    setStatus("listening");
    try { recognitionRef.current?.start(); } catch {}
  }, [clearWakeTimeout]);

  return { status, isSupported, speak, stopSpeaking };
}
