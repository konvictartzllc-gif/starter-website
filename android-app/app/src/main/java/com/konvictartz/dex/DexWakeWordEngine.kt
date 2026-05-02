package com.konvictartz.dex

import android.content.Context
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService
import java.io.IOException
import java.util.Locale

class DexWakeWordEngine(
    private val context: Context,
    private val onWakeWordDetected: () -> Unit
) : RecognitionListener {

    private val prefs by lazy { context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE) }
    private var model: Model? = null
    private var speechService: SpeechService? = null
    private var recognizer: Recognizer? = null
    private var running = false
    private var loading = false

    private fun modelAssetName(): String =
        prefs.getString(MainActivity.KEY_VOSK_MODEL_ASSET, "model-en-us").orEmpty().trim()

    private fun wakePhrase(): String =
        prefs.getString(MainActivity.KEY_VOSK_WAKE_PHRASE, "hey dex").orEmpty().trim().lowercase(Locale.US)

    fun isConfigured(): Boolean {
        return modelAssetName().isNotBlank() && wakePhrase().isNotBlank()
    }

    fun start(): Boolean {
        if (running || loading) return true
        if (!isConfigured()) return false

        val existingModel = model
        return if (existingModel != null) {
            startRecognition(existingModel)
        } else {
            loading = true
            StorageService.unpack(
                context,
                modelAssetName(),
                "dex-vosk-model",
                { unpackedModel ->
                    loading = false
                    model = unpackedModel
                    startRecognition(unpackedModel)
                },
                { _ ->
                    loading = false
                    running = false
                }
            )
            true
        }
    }

    fun stop() {
        runCatching { speechService?.stop() }
        runCatching { speechService?.shutdown() }
        runCatching { recognizer?.close() }
        speechService = null
        recognizer = null
        running = false
    }

    fun isRunning(): Boolean = running

    private fun startRecognition(activeModel: Model): Boolean {
        return runCatching {
            val grammar = "[\"${wakePhrase().replace("\"", "\\\"")}\"]"
            val activeRecognizer = Recognizer(activeModel, 16000.0f, grammar)
            val activeSpeechService = SpeechService(activeRecognizer, 16000.0f)
            recognizer = activeRecognizer
            speechService = activeSpeechService
            activeSpeechService.startListening(this)
            running = true
            true
        }.getOrDefault(false)
    }

    private fun matchesWakePhrase(payload: String?): Boolean {
        val phrase = wakePhrase()
        if (payload.isNullOrBlank() || phrase.isBlank()) return false
        val normalized = payload.trim().lowercase(Locale.US)
        if (normalized == phrase) return true
        return runCatching {
            val json = JSONObject(payload)
            val partial = json.optString("partial").trim().lowercase(Locale.US)
            val text = json.optString("text").trim().lowercase(Locale.US)
            partial == phrase || text == phrase
        }.getOrDefault(false)
    }

    override fun onPartialResult(hypothesis: String?) {
        if (matchesWakePhrase(hypothesis)) {
            onWakeWordDetected()
        }
    }

    override fun onResult(hypothesis: String?) {
        if (matchesWakePhrase(hypothesis)) {
            onWakeWordDetected()
        }
    }

    override fun onFinalResult(hypothesis: String?) {
        if (matchesWakePhrase(hypothesis)) {
            onWakeWordDetected()
        }
    }

    override fun onError(e: Exception?) {
        running = false
    }

    override fun onTimeout() = Unit
}
