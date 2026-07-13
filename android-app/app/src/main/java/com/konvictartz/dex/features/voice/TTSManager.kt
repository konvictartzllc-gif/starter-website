package com.konvictartz.dex.features.voice

interface TTSManager {
    fun speak(text: String)
    fun stop()
}
