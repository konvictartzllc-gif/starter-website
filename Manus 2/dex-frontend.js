// Dex AI Frontend Integration
// This file contains only the Dex AI-related frontend logic.

// Dex AI voice module import
import { dexVoice } from './voice.js';

// Dex AI chat state
const state = {
  dexChatOpen: false,
  dexMessages: [],
};

// Wake word listener for "Hey Dex"
if (dexVoice.isRecognitionSupported()) {
  dexVoice.on('onWakeWordDetected', () => {
    if (!state.dexChatOpen) {
      openDexChat();
    }
    showDexToast('Hey Dex! 🎤 Say your command now...');
    dexVoice.startUserInput();
  });

  dexVoice.on('onTranscript', (transcript) => {
    if (transcript && transcript.trim()) {
      sendDexMessage(transcript);
      dexVoice.startWakeWordListener();
    }
  });

  dexVoice.on('onStatusChange', (status) => {
    const statusEl = document.getElementById("dexVoiceStatus");
    if (statusEl) {
      statusEl.textContent = status;
    }
  });

  dexVoice.startWakeWordListener();
}

// Dex AI chat API integration (example)
async function sendDexMessage(message) {
  // Implement API call to /api/dex/chat here
}

function openDexChat() {
  state.dexChatOpen = true;
  // Show Dex chat UI
}

function showDexToast(msg) {
  // Show a toast or notification for Dex events
}
