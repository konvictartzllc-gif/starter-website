package com.konvictartz.dex.features.voice

class VoiceSessionManager(
    private val wakeWordService: WakeWordService,
    private val sttManager: STTManager,
    private val ttsManager: TTSManager,
) {
    fun begin() {
        wakeWordService.start()
        sttManager.startListening()
    }

    fun end() {
        sttManager.stopListening()
        ttsManager.stop()
        wakeWordService.stop()
    }
}
