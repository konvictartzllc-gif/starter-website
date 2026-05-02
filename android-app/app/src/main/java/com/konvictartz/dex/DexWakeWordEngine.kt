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
    private val onWakeWordDetected: () -> Unit,
    private val onWakeWordError: ((String) -> Unit)? = null
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
        if (!hasPackagedModel()) {
            onWakeWordError?.invoke("Dex could not find the offline wake model in the app package.")
            return false
        }

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
                    if (!startRecognition(unpackedModel)) {
                        onWakeWordError?.invoke("Dex could not start the offline wake engine.")
                    }
                },
                { error ->
                    loading = false
                    running = false
                    onWakeWordError?.invoke(error?.message ?: "Dex could not load the offline wake model.")
                }
            )
            true
        }
    }

    private fun hasPackagedModel(): Boolean {
        return runCatching {
            val children = context.assets.list(modelAssetName()).orEmpty()
            children.isNotEmpty()
        }.getOrDefault(false)
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
        }.onFailure {
            running = false
            onWakeWordError?.invoke(it.message ?: "Dex could not start the offline wake engine.")
        }.getOrDefault(false)
    }

    private fun normalizedWakePhrase(): String = normalizeSpeechFragment(wakePhrase())

    private fun normalizeSpeechFragment(value: String): String {
        return value
            .lowercase(Locale.US)
            .replace(Regex("[^a-z0-9 ]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun wakeVariants(): Set<String> {
        val phrase = normalizedWakePhrase()
        if (phrase.isBlank()) return emptySet()
        val tokens = phrase.split(" ").filter { it.isNotBlank() }
        if (tokens.size < 2) return setOf(phrase)
        if (tokens.last() != "dex") return setOf(phrase)
        val prefix = tokens.dropLast(1).joinToString(" ")
        val variants = listOf("dex", "decks", "deks", "decs", "dix", "dicks")
        return variants.map { "$prefix $it".trim() }.toSet()
    }

    private fun matchesNormalizedText(candidate: String): Boolean {
        val normalizedCandidate = normalizeSpeechFragment(candidate)
        if (normalizedCandidate.isBlank()) return false
        val phrase = normalizedWakePhrase()
        if (phrase.isBlank()) return false
        if (normalizedCandidate == phrase) return true
        if (normalizedCandidate.contains(phrase)) return true
        return wakeVariants().any { variant ->
            normalizedCandidate == variant || normalizedCandidate.contains(variant)
        }
    }

    private fun matchesWakePhrase(payload: String?): Boolean {
        if (payload.isNullOrBlank()) return false
        if (matchesNormalizedText(payload)) return true
        return runCatching {
            val json = JSONObject(payload)
            val partial = json.optString("partial")
            val text = json.optString("text")
            matchesNormalizedText(partial) || matchesNormalizedText(text)
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
        onWakeWordError?.invoke(e?.message ?: "Dex lost the offline wake engine.")
    }

    override fun onTimeout() = Unit
}
