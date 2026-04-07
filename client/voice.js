// Voice recognition and synthesis module for Dex AI

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SpeechSynthesisUtterance = window.SpeechSynthesisUtterance;

export class DexVoice {
  constructor() {
    this.recognition = SpeechRecognition ? new SpeechRecognition() : null;
    this.isListening = false;
    this.isProcessing = false;
    this.listeningForWakeWord = false;
    this.transcript = '';
    this.callbacks = {
      onWakeWordDetected: null,
      onTranscript: null,
      onError: null,
      onStatusChange: null,
    };

    if (this.recognition) {
      this.recognition.continuous = false;
      this.recognition.interimResults = true;
      this.recognition.language = 'en-US';

      this.recognition.addEventListener('start', () => {
        this.isListening = true;
        this._updateStatus('Listening...');
      });

      this.recognition.addEventListener('result', (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            this.transcript += transcript + ' ';
          } else {
            interim += transcript;
          }
        }

        const fullTranscript = (this.transcript + interim).toLowerCase().trim();
        
        // Check for wake word if in listening-for-wake-word mode
        if (this.listeningForWakeWord && fullTranscript.includes('hey dex')) {
          this.stop();
          if (this.callbacks.onWakeWordDetected) {
            this.callbacks.onWakeWordDetected();
          }
        } else if (event.results[event.results.length - 1].isFinal) {
          // Final result - transcript complete
          if (this.callbacks.onTranscript) {
            this.callbacks.onTranscript(fullTranscript);
          }
        }
      });

      this.recognition.addEventListener('error', (event) => {
        this._updateStatus(`Error: ${event.error}`);
        if (this.callbacks.onError) {
          this.callbacks.onError(event.error);
        }
      });

      this.recognition.addEventListener('end', () => {
        this.isListening = false;
        this._updateStatus('');
      });
    }
  }

  // Start listening for wake word "Hey Dex"
  startWakeWordListener() {
    if (!this.recognition) {
      this._updateStatus('Speech recognition not supported');
      return false;
    }

    this.listeningForWakeWord = true;
    this.transcript = '';
    this._updateStatus('🎤 Listening for "Hey Dex"...');
    
    try {
      this.recognition.start();
      return true;
    } catch (e) {
      console.warn('Speech recognition already started', e);
      return false;
    }
  }

  // Start listening for user voice input (after wake word detected)
  startUserInput() {
    if (!this.recognition) {
      this._updateStatus('Speech recognition not supported');
      return false;
    }

    this.listeningForWakeWord = false;
    this.transcript = '';
    this._updateStatus('🎤 Recording...');
    
    try {
      this.recognition.start();
      return true;
    } catch (e) {
      console.warn('Speech recognition already started', e);
      return false;
    }
  }

  // Stop listening
  stop() {
    if (this.recognition && this.isListening) {
      this.recognition.abort();
      this.isListening = false;
      this._updateStatus('');
    }
  }

  // Read text aloud
  speak(text) {
    if (!SpeechSynthesisUtterance) {
      console.warn('Speech synthesis not supported');
      return false;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    window.speechSynthesis.cancel(); // Cancel any previous speech
    window.speechSynthesis.speak(utterance);
    return true;
  }

  // Stop speech synthesis
  stopSpeaking() {
    window.speechSynthesis.cancel();
  }

  // Check if voice features are supported
  isSupported() {
    return Boolean(this.recognition && SpeechSynthesisUtterance);
  }

  // Register callbacks
  on(event, callback) {
    if (event in this.callbacks) {
      this.callbacks[event] = callback;
    }
  }

  _updateStatus(message) {
    if (this.callbacks.onStatusChange) {
      this.callbacks.onStatusChange(message);
    }
  }
}

// Global instance
export const dexVoice = new DexVoice();
