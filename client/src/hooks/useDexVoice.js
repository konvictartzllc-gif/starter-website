import { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../utils/api.js";

const WAKE_WORD = "hey dex";
const WAKE_VARIANTS = [
  "hey dex",
  "hi dex",
  "hey decks",
  "hi decks",
  "hey deks",
  "hey dix",
  "hey dicks",
  "hey dick s",
  "hey text",
  "hi text",
];
const VOICE_STORAGE_KEY = "dex_voice_name";
const CONVERSATION_IDLE_MS = 12000;
const SLEEP_GRACE_MS = 7000;

function normalizeTranscript(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findWakeVariant(transcript) {
  return WAKE_VARIANTS.find((variant) => transcript.includes(variant)) || "";
}

export function useDexVoice({ onWakeWord, onTranscript, onIdlePrompt, enabled = true, stayAwake = false }) {
  const [status, setStatus] = useState("idle"); // idle | listening | active | speaking
  const [isSupported, setIsSupported] = useState(false);
  const [lastHeard, setLastHeard] = useState("");
  const [error, setError] = useState("");
  const recognitionRef = useRef(null);
  const listeningForCommandRef = useRef(false);
  const wakeTimeoutRef = useRef(null);
  const commandTimeoutRef = useRef(null);
  const conversationTimeoutRef = useRef(null);
  const sleepTimeoutRef = useRef(null);
  const pendingCommandRef = useRef("");
  const conversationActiveRef = useRef(false);
  const idlePromptActiveRef = useRef(false);
  const synthRef = useRef(window.speechSynthesis);
  const isSpeakingRef = useRef(false);
  const audioRef = useRef(null);
  const lastCommandRef = useRef({ text: "", at: 0 });
  const onWakeWordRef = useRef(onWakeWord);
  const onTranscriptRef = useRef(onTranscript);
  const onIdlePromptRef = useRef(onIdlePrompt);

  useEffect(() => {
    onWakeWordRef.current = onWakeWord;
    onTranscriptRef.current = onTranscript;
    onIdlePromptRef.current = onIdlePrompt;
  }, [onWakeWord, onTranscript, onIdlePrompt]);

  const clearWakeTimeout = useCallback(() => {
    if (wakeTimeoutRef.current) {
      clearTimeout(wakeTimeoutRef.current);
      wakeTimeoutRef.current = null;
    }
  }, []);

  const clearCommandTimeout = useCallback(() => {
    if (commandTimeoutRef.current) {
      clearTimeout(commandTimeoutRef.current);
      commandTimeoutRef.current = null;
    }
  }, []);

  const clearConversationTimers = useCallback(() => {
    if (conversationTimeoutRef.current) {
      clearTimeout(conversationTimeoutRef.current);
      conversationTimeoutRef.current = null;
    }
    if (sleepTimeoutRef.current) {
      clearTimeout(sleepTimeoutRef.current);
      sleepTimeoutRef.current = null;
    }
  }, []);

  const scheduleIdlePrompt = useCallback(() => {
    clearConversationTimers();
    if (!stayAwake || !conversationActiveRef.current) return;
    conversationTimeoutRef.current = setTimeout(() => {
      idlePromptActiveRef.current = true;
      onIdlePromptRef.current?.();
      sleepTimeoutRef.current = setTimeout(() => {
        idlePromptActiveRef.current = false;
        conversationActiveRef.current = false;
        listeningForCommandRef.current = false;
        pendingCommandRef.current = "";
        setStatus("listening");
      }, SLEEP_GRACE_MS);
    }, CONVERSATION_IDLE_MS);
  }, [clearConversationTimers, stayAwake]);

  const shouldIgnoreCommand = useCallback((command) => {
    const now = Date.now();
    const isDuplicate =
      lastCommandRef.current.text === command &&
      now - lastCommandRef.current.at < 2500;
    if (isDuplicate) return true;
    lastCommandRef.current = { text: command, at: now };
    return false;
  }, []);

  const submitCommand = useCallback((command) => {
    const cleaned = normalizeTranscript(command);
    if (cleaned.length <= 2 || shouldIgnoreCommand(cleaned)) return;
    setError("");
    clearWakeTimeout();
    clearCommandTimeout();
    clearConversationTimers();
    pendingCommandRef.current = "";
    conversationActiveRef.current = stayAwake;
    idlePromptActiveRef.current = false;
    listeningForCommandRef.current = stayAwake;
    setStatus("listening");
    onTranscriptRef.current?.(cleaned);
  }, [clearCommandTimeout, clearConversationTimers, clearWakeTimeout, shouldIgnoreCommand, stayAwake]);

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
      const transcript = normalizeTranscript(lastResult[0].transcript);
      if (transcript) {
        setError("");
        setLastHeard(transcript);
      }

      if (!listeningForCommandRef.current && !conversationActiveRef.current) {
        // Listening for wake word
        const wakeVariant = findWakeVariant(transcript);
        if (wakeVariant) {
          const spokenCommand = transcript.replace(wakeVariant, "").trim();
          listeningForCommandRef.current = true;
          conversationActiveRef.current = stayAwake;
          idlePromptActiveRef.current = false;
          clearConversationTimers();
          setStatus("active");
          onWakeWordRef.current?.({ transcript, spokenCommand });

          // If the user says the wake phrase and command in the same utterance,
          // send it immediately instead of waiting for a second transcript.
          if (spokenCommand.length > 2) {
            pendingCommandRef.current = spokenCommand;
            clearCommandTimeout();
            commandTimeoutRef.current = setTimeout(() => {
              submitCommand(pendingCommandRef.current);
            }, lastResult.isFinal ? 0 : 700);
            return;
          }

          // Reset after 10 seconds if no command
          clearWakeTimeout();
          wakeTimeoutRef.current = setTimeout(() => {
            listeningForCommandRef.current = stayAwake && conversationActiveRef.current;
            setStatus("listening");
          }, 10000);
        }
      } else {
        // Listening for command after wake word. Chrome sometimes never marks
        // speech final, so send the latest stable interim command after a pause.
        const wakeVariant = findWakeVariant(transcript);
        const command = wakeVariant ? transcript.replace(wakeVariant, "").trim() : transcript;
        if (command.length > 2) {
          clearConversationTimers();
          pendingCommandRef.current = command;
          clearCommandTimeout();
          commandTimeoutRef.current = setTimeout(() => {
            submitCommand(pendingCommandRef.current);
          }, lastResult.isFinal ? 0 : 900);
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "network" || event.error === "aborted" || event.error === "no-speech") {
        if (event.error === "network") {
          console.warn("Speech recognition network hiccup; retrying.");
          window.setTimeout(() => {
            if (enabled && !isSpeakingRef.current) {
              try { recognition.start(); } catch {}
            }
          }, 900);
        }
        setError("");
        return;
      }
      if (event.error !== "no-speech") {
        console.warn("Speech recognition error:", event.error);
        setError(event.error);
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
      setError("");
      setStatus("listening");
    } catch (err) {
      console.warn("Could not start speech recognition:", err);
    }

    return () => {
      clearWakeTimeout();
      clearCommandTimeout();
      clearConversationTimers();
      pendingCommandRef.current = "";
      conversationActiveRef.current = false;
      idlePromptActiveRef.current = false;
      listeningForCommandRef.current = false;
      try { recognition.stop(); } catch {}
      recognitionRef.current = null;
      setStatus("idle");
    };
  }, [enabled, clearWakeTimeout, clearCommandTimeout, clearConversationTimers, submitCommand, stayAwake]);

  const speak = useCallback((text) => {
    const synth = synthRef.current;
    if (!text?.trim()) return;

    const resumeListening = () => {
      isSpeakingRef.current = false;
      setError("");
      setStatus("listening");
      try { recognitionRef.current?.start(); } catch {}
      if (conversationActiveRef.current && !idlePromptActiveRef.current) {
        scheduleIdlePrompt();
      }
    };

    const speakWithBrowser = () => {
      if (!synth) { resumeListening(); return; }
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
      utterance.onend = resumeListening;
      utterance.onerror = resumeListening;
      synth.speak(utterance);
      setError("");
    };

    const speakNow = () => {
      if (synth?.getVoices().length === 0 && "onvoiceschanged" in synth) {
        synth.onvoiceschanged = () => {
          synth.onvoiceschanged = null;
          speakWithBrowser();
        };
      } else {
        speakWithBrowser();
      }
    };

    const token = localStorage.getItem("dex_token");
    if (!token) { speakNow(); return; }

    isSpeakingRef.current = true;
    clearWakeTimeout();
    listeningForCommandRef.current = false;
    try { recognitionRef.current?.stop(); } catch {}
    setStatus("speaking");

    api.speakTts(text)
      .then(async (res) => {
        if (!res.ok) throw new Error("tts_failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          resumeListening();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          resumeListening();
        };
        audio.play().catch(() => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          speakNow();
        });
      })
      .catch(() => {
        speakNow();
      });
  }, [clearWakeTimeout, scheduleIdlePrompt]);

  const stopSpeaking = useCallback(() => {
    const synth = synthRef.current;
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.src = "";
      } catch {}
      audioRef.current = null;
    }
    if (synth) synth.cancel();
    clearConversationTimers();
    conversationActiveRef.current = false;
    idlePromptActiveRef.current = false;
    listeningForCommandRef.current = false;
    isSpeakingRef.current = false;
    setStatus("listening");
    try { recognitionRef.current?.start(); } catch {}
  }, [clearConversationTimers]);

  const startListening = useCallback(() => {
    if (!enabled) return;
    if (isSpeakingRef.current) return;
    try {
      recognitionRef.current?.start();
      setError("");
      setStatus("listening");
    } catch {
      // The recognizer throws if it is already running; that state is fine.
    }
  }, [enabled]);

  const sleep = useCallback(() => {
    clearWakeTimeout();
    clearCommandTimeout();
    clearConversationTimers();
    pendingCommandRef.current = "";
    conversationActiveRef.current = false;
    idlePromptActiveRef.current = false;
    listeningForCommandRef.current = false;
    setStatus(enabled ? "listening" : "idle");
  }, [clearCommandTimeout, clearConversationTimers, clearWakeTimeout, enabled]);

  return { status, isSupported, lastHeard, error, speak, stopSpeaking, startListening, sleep };
}
