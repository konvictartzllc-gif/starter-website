package com.konvictartz.dex

import android.content.Context
import android.os.SystemClock
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
    private var lastWakeTriggeredAt = 0L
    private var lastPartialCandidate = ""
    private var repeatedPartialMatches = 0
    private var backgroundNoiseScore = 0
    private var lastNoiseDecayAt = 0L

    private enum class WakeMatchStrength {
        NONE,
        BARE,
        VARIANT,
        EXACT
    }

    private data class WakeMatch(
        val normalizedText: String,
        val strength: WakeMatchStrength
    )

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
        resetPassiveState()
    }

    fun isRunning(): Boolean = running

    private fun startRecognition(activeModel: Model): Boolean {
        return runCatching {
            val grammar = recognizedWakePhrases()
                .joinToString(prefix = "[", postfix = "]") { phrase ->
                    "\"${phrase.replace("\"", "\\\"")}\""
                }
            val activeRecognizer = Recognizer(activeModel, 16000.0f, grammar)
            val activeSpeechService = SpeechService(activeRecognizer, 16000.0f)
            recognizer = activeRecognizer
            speechService = activeSpeechService
            resetPassiveState()
            activeSpeechService.startListening(this)
            running = true
            true
        }.onFailure {
            running = false
            onWakeWordError?.invoke(it.message ?: "Dex could not start the offline wake engine.")
        }.getOrDefault(false)
    }

    private fun normalizedWakePhrase(): String = normalizeSpeechFragment(wakePhrase())

    private fun recognizedWakePhrases(): Set<String> {
        val phrase = normalizedWakePhrase()
        if (phrase.isBlank()) return emptySet()
        val variants = wakeVariants()
        val singleWordWake = phrase.split(" ").size == 1
        val bareDexVariants = if (singleWordWake) bareWakeVariants() else emptySet()
        return (setOf(phrase) + variants + bareDexVariants).filter { it.isNotBlank() }.toSet()
    }

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

    private fun bareWakeVariants(): Set<String> = setOf("dex", "decks", "deks", "decs", "dix")

    private fun evaluateWakeMatch(candidate: String): WakeMatch {
        val normalizedCandidate = normalizeSpeechFragment(candidate)
        if (normalizedCandidate.isBlank()) return WakeMatch(normalizedCandidate, WakeMatchStrength.NONE)
        val phrase = normalizedWakePhrase()
        if (phrase.isBlank()) return WakeMatch(normalizedCandidate, WakeMatchStrength.NONE)
        if (normalizedCandidate == phrase || normalizedCandidate.contains(phrase)) {
            return WakeMatch(normalizedCandidate, WakeMatchStrength.EXACT)
        }
        if (wakeVariants().any { variant -> normalizedCandidate == variant || normalizedCandidate.contains(variant) }) {
            return WakeMatch(normalizedCandidate, WakeMatchStrength.VARIANT)
        }
        if (normalizedCandidate in bareWakeVariants()) {
            return WakeMatch(normalizedCandidate, WakeMatchStrength.BARE)
        }
        return WakeMatch(normalizedCandidate, WakeMatchStrength.NONE)
    }

    private fun extractSpeechFragment(payload: String?, finalResult: Boolean): String {
        if (payload.isNullOrBlank()) return ""
        return runCatching {
            val json = JSONObject(payload)
            val preferred = if (finalResult) json.optString("text") else json.optString("partial")
            preferred.ifBlank { json.optString("text").ifBlank { json.optString("partial") } }
        }.getOrDefault(payload)
    }

    private fun resetPassiveState() {
        lastPartialCandidate = ""
        repeatedPartialMatches = 0
        backgroundNoiseScore = 0
        lastNoiseDecayAt = SystemClock.elapsedRealtime()
    }

    private fun decayNoiseScore(now: Long = SystemClock.elapsedRealtime()) {
        if (lastNoiseDecayAt == 0L) {
            lastNoiseDecayAt = now
            return
        }
        val decaySteps = ((now - lastNoiseDecayAt) / NOISE_DECAY_INTERVAL_MS).toInt()
        if (decaySteps <= 0) return
        backgroundNoiseScore = (backgroundNoiseScore - decaySteps).coerceAtLeast(0)
        lastNoiseDecayAt += decaySteps * NOISE_DECAY_INTERVAL_MS
    }

    private fun markBackgroundNoise() {
        decayNoiseScore()
        backgroundNoiseScore = (backgroundNoiseScore + 1).coerceAtMost(MAX_NOISE_SCORE)
        lastPartialCandidate = ""
        repeatedPartialMatches = 0
    }

    private fun canTriggerWake(now: Long = SystemClock.elapsedRealtime()): Boolean {
        return now - lastWakeTriggeredAt >= WAKE_TRIGGER_COOLDOWN_MS
    }

    private fun handleWakeCandidate(payload: String?, finalResult: Boolean) {
        val fragment = extractSpeechFragment(payload, finalResult)
        val match = evaluateWakeMatch(fragment)
        if (match.normalizedText.isBlank()) {
            return
        }
        if (match.strength == WakeMatchStrength.NONE) {
            markBackgroundNoise()
            return
        }

        decayNoiseScore()
        val now = SystemClock.elapsedRealtime()
        if (!canTriggerWake(now)) return

        if (finalResult) {
            val allowFinalTrigger =
                match.strength == WakeMatchStrength.EXACT ||
                    match.strength == WakeMatchStrength.VARIANT ||
                    (match.strength == WakeMatchStrength.BARE && backgroundNoiseScore <= QUIET_ROOM_NOISE_SCORE)
            if (allowFinalTrigger) {
                triggerWake(now)
            }
            return
        }

        if (lastPartialCandidate == match.normalizedText) {
            repeatedPartialMatches += 1
        } else {
            lastPartialCandidate = match.normalizedText
            repeatedPartialMatches = 1
        }

        val requiredRepeats = when {
            backgroundNoiseScore >= NOISY_ROOM_SCORE -> 3
            match.strength == WakeMatchStrength.BARE -> 3
            else -> 2
        }
        if (repeatedPartialMatches >= requiredRepeats && match.strength != WakeMatchStrength.BARE) {
            triggerWake(now)
        }
    }

    private fun triggerWake(now: Long = SystemClock.elapsedRealtime()) {
        lastWakeTriggeredAt = now
        lastPartialCandidate = ""
        repeatedPartialMatches = 0
        backgroundNoiseScore = 0
        onWakeWordDetected()
    }

    override fun onPartialResult(hypothesis: String?) {
        handleWakeCandidate(hypothesis, finalResult = false)
    }

    override fun onResult(hypothesis: String?) {
        handleWakeCandidate(hypothesis, finalResult = true)
    }

    override fun onFinalResult(hypothesis: String?) {
        handleWakeCandidate(hypothesis, finalResult = true)
    }

    override fun onError(e: Exception?) {
        running = false
        onWakeWordError?.invoke(e?.message ?: "Dex lost the offline wake engine.")
    }

    override fun onTimeout() = Unit

    private companion object {
        const val WAKE_TRIGGER_COOLDOWN_MS = 2200L
        const val NOISE_DECAY_INTERVAL_MS = 4500L
        const val MAX_NOISE_SCORE = 6
        const val QUIET_ROOM_NOISE_SCORE = 1
        const val NOISY_ROOM_SCORE = 3
    }
}
