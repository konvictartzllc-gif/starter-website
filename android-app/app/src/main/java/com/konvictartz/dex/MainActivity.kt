package com.konvictartz.dex

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.media.AudioManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.ContactsContract
import android.provider.ContactsContract.Intents.Insert
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.konvictartz.dex.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.DayOfWeek
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.max
import java.net.URI

private enum class PendingActionKind {
    SMS_DRAFT,
    EMAIL_DRAFT,
    APPOINTMENT_CREATE,
    CONTACT_SAVE,
}

private enum class CallVoiceAction {
    ANSWER,
    DECLINE,
    ANSWER_ON_SPEAKER,
    TAKE_MESSAGE,
}

private data class PendingAction(
    val kind: PendingActionKind,
    val summary: String,
    val detail: String,
    val targetName: String? = null,
    val targetValue: String? = null,
    val subject: String? = null,
    val body: String? = null,
    val appointmentTitle: String? = null,
    val appointmentStartIso: String? = null,
    val appointmentEndIso: String? = null,
    val serverDraftId: Int? = null,
)

private data class ContactMatch(
    val displayName: String,
    val value: String,
)

private data class DirectCallRequest(
    val displayName: String,
    val phoneNumber: String,
)

class MainActivity : AppCompatActivity(), TextToSpeech.OnInitListener {
    private lateinit var binding: ActivityMainBinding
    private val client = OkHttpClient()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var isRegisterMode = false
    private var authToken: String? = null
    private var phoneBackendEnabled = false
    private var telephonyManager: TelephonyManager? = null
    private var telecomManager: TelecomManager? = null
    private var phoneStateListener: PhoneStateListener? = null
    private var lastCallState = TelephonyManager.CALL_STATE_IDLE
    private var lastCaller = "Unknown caller"
    private var lastIncomingNumber: String? = null
    private var lastIncomingNeedsSave = false
    private var currentCallWasAnswered = false
    private var enableSpeakerAfterAnswer = false
    private var textToSpeech: TextToSpeech? = null
    private var ttsReady = false
    private var ttsStatusMessage: String? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var isListeningForCallCommand = false
    private var shouldResumeCallListeningAfterSpeech = false
    private var wakeModeEnabled = false
    private var awaitingWakeCommand = false
    private var conversationActive = false
    private var resumeWakeListeningAfterSpeech = false
    private var pendingAction: PendingAction? = null
    private var autoWakeStarted = false
    private var relationshipAliases: Map<String, String> = emptyMap()
    private var lastWakeListenStartedAt = 0L

    private val resetWakeWindowRunnable = Runnable {
        awaitingWakeCommand = false
        conversationActive = false
        if (wakeModeEnabled) {
            binding.conversationStatus.text = getString(R.string.wake_mode_session_ended)
            scheduleWakeListeningRestart()
        }
    }

    private val restartWakeListeningRunnable = Runnable {
        if (wakeModeEnabled && !isListeningForCallCommand && lastCallState != TelephonyManager.CALL_STATE_RINGING) {
            startWakeWordListening()
        }
    }

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            updateAndroidPermissionStatus()
            refreshCallMonitorState()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        telecomManager = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
        textToSpeech = TextToSpeech(this, this)
        textToSpeech?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit

            override fun onDone(utteranceId: String?) {
                runOnUiThread {
                    if (resumeWakeListeningAfterSpeech && wakeModeEnabled) {
                        resumeWakeListeningAfterSpeech = false
                        scheduleWakeListeningRestart(1200)
                    }
                    if (shouldResumeCallListeningAfterSpeech && lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                        shouldResumeCallListeningAfterSpeech = false
                        mainHandler.postDelayed({ startListeningForCallCommand() }, CALL_COMMAND_PROMPT_GUARD_DELAY_MS)
                    }
                }
            }

            override fun onError(utteranceId: String?) {
                runOnUiThread {
                    if (resumeWakeListeningAfterSpeech && wakeModeEnabled) {
                        resumeWakeListeningAfterSpeech = false
                        scheduleWakeListeningRestart(1200)
                    }
                    if (shouldResumeCallListeningAfterSpeech && lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                        shouldResumeCallListeningAfterSpeech = false
                        mainHandler.postDelayed({ startListeningForCallCommand() }, CALL_COMMAND_PROMPT_GUARD_DELAY_MS)
                    }
                }
            }
        })
        setupSpeechRecognizer()

        loadStoredState()
        clearStaleBackgroundState()
        setupUi()
        updateAndroidPermissionStatus()
        refreshLoggedInState()
        if (!authToken.isNullOrBlank()) {
            fetchPermissions()
            fetchLearningReminderPreferences()
            fetchRelationshipAliases()
        }
    }

    override fun onResume() {
        super.onResume()
        clearStaleBackgroundState()
        updateAndroidPermissionStatus()
        refreshCallMonitorState()
        autoStartWakeModeIfReady()
        if (!authToken.isNullOrBlank()) {
            fetchLearningReminderPreferences()
            fetchRelationshipAliases()
        }
    }

    override fun onStart() {
        super.onStart()
        setAppForegroundState(true)
        maintainBackgroundService()
    }

    override fun onStop() {
        setAppForegroundState(false)
        maintainBackgroundService()
        super.onStop()
    }

    override fun onDestroy() {
        stopCallMonitoring()
        stopListeningForCallCommand()
        wakeModeEnabled = false
        awaitingWakeCommand = false
        resumeWakeListeningAfterSpeech = false
        mainHandler.removeCallbacks(resetWakeWindowRunnable)
        mainHandler.removeCallbacks(restartWakeListeningRunnable)
        speechRecognizer?.destroy()
        textToSpeech?.stop()
        textToSpeech?.shutdown()
        super.onDestroy()
    }

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) {
            ttsReady = false
            ttsStatusMessage = getString(R.string.voice_not_ready)
            refreshVoiceStatus()
            return
        }

        textToSpeech?.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build()
        )
        textToSpeech?.setSpeechRate(1.0f)
        textToSpeech?.setPitch(1.0f)

        val languageResult = textToSpeech?.setLanguage(Locale.US) ?: TextToSpeech.ERROR
        ttsReady = languageResult != TextToSpeech.LANG_MISSING_DATA &&
            languageResult != TextToSpeech.LANG_NOT_SUPPORTED &&
            languageResult != TextToSpeech.ERROR
        pickPreferredDexVoice()
        ttsStatusMessage =
            if (ttsReady) getString(R.string.voice_ready)
            else getString(R.string.voice_setup_needed)
        refreshVoiceStatus()
    }

    private fun pickPreferredDexVoice() {
        val tts = textToSpeech ?: return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return
        val voices = tts.voices.orEmpty()
        if (voices.isEmpty()) return
        val preferred = voices
            .filter { it.locale?.language == Locale.US.language || it.locale?.language == Locale.ENGLISH.language }
            .sortedWith(
                compareBy<Voice> { it.isNetworkConnectionRequired }
                    .thenBy { it.quality }
                    .thenBy { it.latency }
            )
            .lastOrNull { voice ->
                val lowerName = voice.name.lowercase(Locale.US)
                !voice.isNetworkConnectionRequired &&
                    !lowerName.contains("legacy") &&
                    !lowerName.contains("robot") &&
                    !lowerName.contains("espeak")
            }
            ?: voices.firstOrNull { !it.isNetworkConnectionRequired }
            ?: return
        runCatching { tts.voice = preferred }
    }

    private fun setupSpeechRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    when {
                        isListeningForCallCommand -> binding.callMonitorStatus.text = getString(R.string.call_listening)
                        wakeModeEnabled -> binding.conversationStatus.text =
                            if (awaitingWakeCommand || conversationActive) getString(R.string.wake_mode_command_ready)
                            else getString(R.string.wake_mode_listening)
                    }
                }

                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit

                override fun onError(error: Int) {
                    if (isListeningForCallCommand) {
                        isListeningForCallCommand = false
                        if (lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                            binding.callMonitorStatus.text = getString(R.string.call_listening_retry)
                            mainHandler.postDelayed({ startListeningForCallCommand() }, CALL_COMMAND_RETRY_DELAY_MS)
                        } else {
                            binding.callMonitorStatus.text = getString(R.string.call_voice_unavailable)
                        }
                    } else if (wakeModeEnabled) {
                        handleWakeRecognitionError(error)
                    }
                }

                override fun onResults(results: Bundle?) {
                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                    val transcript = matches.firstOrNull()?.trim().orEmpty().lowercase(Locale.US)
                    if (isListeningForCallCommand) {
                        isListeningForCallCommand = false
                        val action = parseCallVoiceAction(transcript)
                        when {
                            action == CallVoiceAction.ANSWER -> answerRingingCall()
                            action == CallVoiceAction.ANSWER_ON_SPEAKER -> {
                                enableSpeakerAfterAnswer = true
                                answerRingingCall()
                            }
                            action == CallVoiceAction.DECLINE -> declineRingingCall()
                            action == CallVoiceAction.TAKE_MESSAGE -> takeMessageForCurrentCaller()
                            lastCallState == TelephonyManager.CALL_STATE_RINGING -> {
                                binding.callMonitorStatus.text = getString(R.string.call_voice_unavailable)
                            }
                        }
                    } else if (wakeModeEnabled) {
                        handleWakeTranscript(transcript)
                    }
                }
            })
        }
    }

    private fun setupUi() {
        binding.authModeToggle.check(binding.loginModeButton.id)
        binding.authModeToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            isRegisterMode = checkedId == binding.registerModeButton.id
            renderAuthMode()
        }

        binding.authActionButton.setOnClickListener {
            if (isRegisterMode) register() else login()
        }

        binding.logoutButton.setOnClickListener {
            clearSession()
            Toast.makeText(this, "Signed out of Dex.", Toast.LENGTH_SHORT).show()
        }

        binding.requestAndroidPermissionsButton.setOnClickListener {
            requestAndroidPermissions()
        }

        binding.testVoiceButton.setOnClickListener {
            speakDex(getString(R.string.voice_test_phrase))
        }

        binding.setupVoiceButton.setOnClickListener {
            openVoiceSetup()
        }

        binding.wakeModeButton.setOnClickListener {
            if (wakeModeEnabled) stopWakeMode() else startWakeMode()
        }

        binding.approveActionButton.setOnClickListener {
            approvePendingAction()
        }

        binding.cancelActionButton.setOnClickListener {
            cancelPendingAction()
        }

        binding.answerCallButton.setOnClickListener {
            answerRingingCall()
        }

        binding.declineCallButton.setOnClickListener {
            declineRingingCall()
        }

        binding.phonePermissionSwitch.setOnCheckedChangeListener { _, isChecked ->
            if (!binding.phonePermissionSwitch.isPressed) return@setOnCheckedChangeListener
            updatePermissions("phone", isChecked)
        }
        binding.calendarPermissionSwitch.setOnCheckedChangeListener { _, isChecked ->
            if (!binding.calendarPermissionSwitch.isPressed) return@setOnCheckedChangeListener
            updatePermissions("calendar", isChecked)
        }
        binding.notificationsPermissionSwitch.setOnCheckedChangeListener { _, isChecked ->
            if (!binding.notificationsPermissionSwitch.isPressed) return@setOnCheckedChangeListener
            updatePermissions("notifications", isChecked)
        }

        renderAuthMode()
        updateCallActionVisibility(false)
        refreshVoiceStatus()
        updateWakeUi()
        updatePendingActionUi()
    }

    private fun renderAuthMode() {
        binding.authActionButton.text = if (isRegisterMode) getString(R.string.register) else getString(R.string.login)
        binding.nameInput.visibility = if (isRegisterMode) View.VISIBLE else View.GONE
    }

    private fun loadStoredState() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val restoredServerUrl = normalizeServerUrl(prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL))
        binding.serverUrlInput.setText(restoredServerUrl)
        authToken = prefs.getString(KEY_TOKEN, null)
        binding.emailInput.setText(prefs.getString(KEY_EMAIL, ""))
    }

    private fun saveServerUrl(serverUrl: String) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, serverUrl)
            .commit()
    }

    private fun saveSession(token: String, email: String) {
        authToken = token
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_EMAIL, email)
            .putString(KEY_SERVER_URL, currentServerUrl())
            .putBoolean(KEY_AUTO_START_ASSISTANT, true)
            .commit()
        refreshLoggedInState()
        fetchPermissions()
        maintainBackgroundService()
    }

    private fun clearSession() {
        authToken = null
        phoneBackendEnabled = false
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_TOKEN)
            .putBoolean(KEY_LEARNING_REMINDER_ENABLED, false)
            .putString(KEY_LEARNING_REMINDER_TIME, "")
            .putBoolean(KEY_BACKGROUND_SERVICE_ENABLED, false)
            .putBoolean(KEY_AUTO_START_ASSISTANT, false)
            .putBoolean(KEY_PHONE_BACKEND_ENABLED, false)
            .commit()
        binding.authMessage.text = getString(R.string.logged_out_message)
        DexLearningReminderScheduler.cancelReminder(this)
        stopDexBackgroundService()
        refreshLoggedInState()
    }

    private fun refreshLoggedInState() {
        val loggedIn = !authToken.isNullOrBlank()
        binding.logoutButton.visibility = if (loggedIn) View.VISIBLE else View.GONE
        binding.permissionsCard.alpha = if (loggedIn) 1f else 0.55f
        binding.phonePermissionSwitch.isEnabled = loggedIn
        binding.calendarPermissionSwitch.isEnabled = loggedIn
        binding.notificationsPermissionSwitch.isEnabled = loggedIn
        binding.authMessage.text = if (loggedIn) getString(R.string.logged_in_message) else getString(R.string.logged_out_message)
        if (!loggedIn) {
            applyPermissions(emptyMap())
            autoWakeStarted = false
        }
        refreshCallMonitorState()
        autoStartWakeModeIfReady()
    }

    private fun refreshVoiceStatus() {
        binding.voiceStatus.text =
            ttsStatusMessage ?: if (ttsReady) getString(R.string.voice_ready) else getString(R.string.voice_not_ready)
        binding.testVoiceButton.isEnabled = ttsReady
    }

    private fun updateWakeUi() {
        binding.wakeModeButton.text =
            if (wakeModeEnabled) getString(R.string.stop_wake_mode) else getString(R.string.start_wake_mode)
        if (!wakeModeEnabled) {
            binding.conversationStatus.text = getString(R.string.wake_mode_off)
        }
    }

    private fun updatePendingActionUi() {
        val action = pendingAction
        binding.pendingActionCard.visibility = if (action == null) View.GONE else View.VISIBLE
        if (action != null) {
            binding.pendingActionSummary.text = action.summary
            binding.pendingActionDetail.text = action.detail
        }
    }

    private fun currentServerUrl(): String {
        val rawValue = binding.serverUrlInput.text?.toString()
        return normalizeServerUrl(rawValue)
    }

    private fun isPrivateLanHost(host: String): Boolean {
        if (host.startsWith("192.168.") || host.startsWith("10.")) return true
        val match = Regex("^172\\.(\\d{1,2})\\.").find(host) ?: return false
        val secondOctet = match.groupValues[1].toIntOrNull() ?: return false
        return secondOctet in 16..31
    }

    private fun normalizeServerUrl(serverUrl: String?): String {
        val trimmed = serverUrl?.trim()?.trimEnd('/').orEmpty()
        if (trimmed.isBlank()) return DEFAULT_SERVER_URL
        val lower = trimmed.lowercase(Locale.US)
        val parsedUri = runCatching { URI(trimmed) }.getOrNull()
        val host = parsedUri?.host?.lowercase(Locale.US).orEmpty()
        val port = parsedUri?.port ?: -1
        val normalized = when {
            lower.startsWith("http://localhost") || lower.startsWith("http://127.0.0.1") -> DEFAULT_SERVER_URL
            lower.startsWith("http://konvict-artz.onrender.com") -> trimmed.replaceFirst("http://", "https://")
            lower.startsWith("http://www.konvict-artz.com") -> trimmed.replaceFirst("http://", "https://")
            lower.startsWith("http://konvict-artz.com") -> trimmed.replaceFirst("http://", "https://")
            isPrivateLanHost(host) && port == 4000 -> trimmed.replace(":4000", ":3001")
            else -> trimmed
        }
        return when {
            normalized.equals("https://konvict-artz.onrender.com", ignoreCase = true) -> DEFAULT_SERVER_URL
            normalized.equals("http://konvict-artz.onrender.com", ignoreCase = true) -> DEFAULT_SERVER_URL
            normalized.equals("https://www.konvict-artz.com", ignoreCase = true) -> "https://www.konvict-artz.com/api"
            normalized.equals("https://konvict-artz.com", ignoreCase = true) -> "https://konvict-artz.com/api"
            normalized.startsWith("https://konvict-artz.onrender.com/", ignoreCase = true) &&
                !normalized.contains("/api", ignoreCase = true) -> DEFAULT_SERVER_URL
            normalized.startsWith("https://www.konvict-artz.com/", ignoreCase = true) &&
                !normalized.contains("/api", ignoreCase = true) -> "https://www.konvict-artz.com/api"
            normalized.startsWith("https://konvict-artz.com/", ignoreCase = true) &&
                !normalized.contains("/api", ignoreCase = true) -> "https://konvict-artz.com/api"
            else -> normalized
        }
    }

    private fun backendUrlHint(): String = DEFAULT_SERVER_URL

    private fun parseJsonObjectOrThrow(body: String, responseCode: Int): JSONObject {
        if (body.isBlank()) return JSONObject()
        val trimmed = body.trimStart()
        if (trimmed.startsWith("<!DOCTYPE", ignoreCase = true) || trimmed.startsWith("<html", ignoreCase = true)) {
            throw IOException("Dex expected the backend API but received a web page. Use ${backendUrlHint()}")
        }
        return runCatching { JSONObject(body) }.getOrElse { error ->
            throw IOException(
                "Dex expected JSON from the backend. Check that the backend URL ends with /api and uses https. (${backendUrlHint()})",
                error
            )
        }
    }

    private fun parseErrorMessage(body: String, responseCode: Int): String {
        if (body.isBlank()) return "Request failed with $responseCode"
        val trimmed = body.trimStart()
        if (trimmed.startsWith("<!DOCTYPE", ignoreCase = true) || trimmed.startsWith("<html", ignoreCase = true)) {
            return "Dex expected the backend API but received a web page. Use ${backendUrlHint()}"
        }
        return runCatching { JSONObject(body) }.getOrNull()?.let { json ->
            json.optString("message").ifBlank {
                json.optString("error").ifBlank { "Request failed with $responseCode" }
            }
        } ?: "Dex expected JSON from the backend. Check that the backend URL ends with /api and uses https. (${backendUrlHint()})"
    }

    private fun login() {
        val email = binding.emailInput.text?.toString()?.trim().orEmpty()
        val password = binding.passwordInput.text?.toString().orEmpty()
        if (email.isBlank() || password.isBlank()) {
            binding.authMessage.text = "Email and password are required."
            return
        }
        runAuthRequest("/auth/login", JSONObject().apply {
            put("email", email)
            put("password", password)
        })
    }

    private fun register() {
        val name = binding.nameInput.text?.toString()?.trim().orEmpty()
        val email = binding.emailInput.text?.toString()?.trim().orEmpty()
        val password = binding.passwordInput.text?.toString().orEmpty()
        if (email.isBlank() || password.isBlank()) {
            binding.authMessage.text = "Email and password are required."
            return
        }
        runAuthRequest("/auth/register", JSONObject().apply {
            put("email", email)
            put("password", password)
            if (name.isNotBlank()) put("name", name)
        })
    }

    private fun runAuthRequest(path: String, payload: JSONObject) {
        val serverUrl = currentServerUrl()
        if (serverUrl.isBlank()) {
            binding.authMessage.text = "Add your backend API URL first."
            return
        }
        saveServerUrl(serverUrl)
        setAuthLoading(true)
        lifecycleScope.launch {
            val result = postJson("$serverUrl$path", payload, null)
            setAuthLoading(false)
            result.onSuccess { response ->
                val token = response.optString("token")
                val user = response.optJSONObject("user")
                val email = user?.optString("email").orEmpty().ifBlank { binding.emailInput.text?.toString().orEmpty() }
                if (token.isBlank()) {
                    binding.authMessage.text = "Dex did not return a login token."
                    return@onSuccess
                }
                saveSession(token, email)
                binding.authMessage.text = getString(R.string.connected_as, email)
            }.onFailure { error ->
                binding.authMessage.text = error.message ?: "Dex sign-in failed."
            }
        }
    }

    private fun fetchPermissions() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            setPermissionsLoading(true)
            val result = getJson("$serverUrl/dex/permissions", token)
            setPermissionsLoading(false)
            result.onSuccess { response ->
                val permissions = response.optJSONObject("permissions")
                val phoneEnabled = permissions?.optBoolean("phone") ?: false
                phoneBackendEnabled = phoneEnabled
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_PHONE_BACKEND_ENABLED, phoneEnabled)
                    .apply()
                applyPermissions(
                    mapOf(
                        "phone" to phoneEnabled,
                        "calendar" to (permissions?.optBoolean("calendar") ?: false),
                        "notifications" to (permissions?.optBoolean("notifications") ?: false)
                    )
                )
                binding.permissionsMessage.text = getString(R.string.permissions_synced)
                refreshCallMonitorState()
            }.onFailure { error ->
                binding.permissionsMessage.text = error.message ?: getString(R.string.permissions_load_failed)
                refreshCallMonitorState()
            }
        }
    }

    private fun fetchLearningReminderPreferences() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            val result = getJson("$serverUrl/dex/preferences", token)
            result.onSuccess { response ->
                val preferences = response.optJSONObject("preferences") ?: JSONObject()
                val enabled = preferences.optString("learning_reminder_enabled") == "1"
                val time = preferences.optString("learning_reminder_time")
                val language = preferences.optString("learning_target_language").ifBlank { "your language" }
                val subject = preferences.optString("learning_subject")
                    .ifBlank { preferences.optString("learning_focus").ifBlank { "practice" } }
                val title = getString(R.string.learning_reminder_title)
                val text = getString(R.string.learning_reminder_text_template, language, subject)

                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_LEARNING_REMINDER_ENABLED, enabled)
                    .putString(KEY_LEARNING_REMINDER_TIME, time)
                    .putString(KEY_LEARNING_REMINDER_TITLE, title)
                    .putString(KEY_LEARNING_REMINDER_TEXT, text)
                    .apply()

                if (enabled && time.isNotBlank() && hasNotificationPermissionForReminder()) {
                    DexLearningReminderScheduler.scheduleDailyReminder(this@MainActivity, time, title, text)
                    binding.permissionsMessage.text = getString(R.string.learning_reminder_scheduled, time)
                } else {
                    DexLearningReminderScheduler.cancelReminder(this@MainActivity)
                }
            }.onFailure {
                // Keep reminder sync quiet if preferences are unavailable.
            }
        }
    }

    private fun fetchRelationshipAliases() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            val result = getJson("$serverUrl/dex/relationship-aliases", token)
            result.onSuccess { response ->
                val aliases = response.optJSONArray("aliases") ?: JSONArray()
                val map = mutableMapOf<String, String>()
                for (index in 0 until aliases.length()) {
                    val item = aliases.optJSONObject(index) ?: continue
                    val alias = item.optString("alias").trim().lowercase(Locale.US)
                    val contactName = item.optString("contact_name").trim()
                    if (alias.isNotBlank() && contactName.isNotBlank()) {
                        map[alias] = contactName
                    }
                }
                relationshipAliases = map
            }.onFailure {
                relationshipAliases = emptyMap()
            }
        }
    }

    private fun updatePermissions(key: String, enabled: Boolean) {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        val payload = JSONObject().apply {
            put("permissions", JSONObject().apply {
                put("phone", binding.phonePermissionSwitch.isChecked)
                put("calendar", binding.calendarPermissionSwitch.isChecked)
                put("notifications", binding.notificationsPermissionSwitch.isChecked)
            })
        }

        setPermissionsLoading(true)
        lifecycleScope.launch {
            val result = postJson("$serverUrl/dex/permissions", payload, token)
            setPermissionsLoading(false)
            result.onSuccess {
                phoneBackendEnabled = binding.phonePermissionSwitch.isChecked
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_PHONE_BACKEND_ENABLED, phoneBackendEnabled)
                    .apply()
                binding.permissionsMessage.text =
                    when (key) {
                        "phone" -> getString(if (enabled) R.string.phone_enabled else R.string.phone_disabled)
                        "calendar" -> getString(if (enabled) R.string.calendar_enabled else R.string.calendar_disabled)
                        else -> getString(if (enabled) R.string.notifications_enabled else R.string.notifications_disabled)
                    }
                refreshCallMonitorState()
            }.onFailure { error ->
                binding.permissionsMessage.text = error.message ?: getString(R.string.permissions_save_failed)
                fetchPermissions()
            }
        }
    }

    private fun applyPermissions(permissions: Map<String, Boolean>) {
        binding.phonePermissionSwitch.isChecked = permissions["phone"] == true
        binding.calendarPermissionSwitch.isChecked = permissions["calendar"] == true
        binding.notificationsPermissionSwitch.isChecked = permissions["notifications"] == true
    }

    private fun requestAndroidPermissions() {
        AlertDialog.Builder(this)
            .setTitle(R.string.permissions_disclosure_title)
            .setMessage(getString(R.string.permissions_disclosure_message))
            .setNegativeButton(R.string.permissions_disclosure_cancel, null)
            .setPositiveButton(R.string.permissions_disclosure_continue) { _, _ ->
                val permissions = mutableListOf(
                    Manifest.permission.READ_PHONE_STATE,
                    Manifest.permission.READ_CONTACTS,
                    Manifest.permission.ANSWER_PHONE_CALLS,
                    Manifest.permission.CALL_PHONE,
                    Manifest.permission.RECORD_AUDIO
                )
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    permissions += Manifest.permission.POST_NOTIFICATIONS
                }
                permissionLauncher.launch(permissions.toTypedArray())
            }
            .show()
    }

    private fun hasNotificationPermissionForReminder(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    private fun hasAllAndroidPermissions(): Boolean {
        val required = mutableListOf(
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.ANSWER_PHONE_CALLS,
            Manifest.permission.CALL_PHONE,
            Manifest.permission.RECORD_AUDIO
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            required += Manifest.permission.POST_NOTIFICATIONS
        }
        return required.all { permission ->
            ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun updateAndroidPermissionStatus() {
        val ready = hasAllAndroidPermissions()
        binding.androidPermissionStatus.text =
            if (ready) getString(R.string.android_permissions_ready)
            else getString(R.string.android_permissions_missing)
        if (!ready) autoWakeStarted = false
    }

    private fun autoStartWakeModeIfReady() {
        if (wakeModeEnabled || autoWakeStarted) return
        if (authToken.isNullOrBlank()) return
        if (!hasAllAndroidPermissions()) return
        autoWakeStarted = true
        startWakeMode(automatic = true)
    }

    private fun refreshCallMonitorState() {
        val shouldMonitor = !authToken.isNullOrBlank() && phoneBackendEnabled && hasAllAndroidPermissions()
        if (shouldMonitor) {
            startCallMonitoring()
            binding.callMonitorStatus.text = getString(R.string.call_monitor_active)
        } else {
            stopCallMonitoring()
            binding.callMonitorStatus.text = getString(R.string.call_monitor_waiting)
        }
        maintainBackgroundService()
    }

    private fun clearStaleBackgroundState() {
        if (wakeModeEnabled) return
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(KEY_BACKGROUND_SERVICE_ENABLED, false) && !shouldRunBackgroundService()) {
            prefs.edit().putBoolean(KEY_BACKGROUND_SERVICE_ENABLED, false).apply()
            stopService(Intent(this, DexForegroundService::class.java))
        }
    }

    private fun shouldRunBackgroundService(): Boolean {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val autoStartEnabled = prefs.getBoolean(KEY_AUTO_START_ASSISTANT, false)
        val hasToken = !authToken.isNullOrBlank()
        return autoStartEnabled && hasToken && hasAllAndroidPermissions()
    }

    private fun setAppForegroundState(inForeground: Boolean) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_APP_IN_FOREGROUND, inForeground)
            .apply()
    }

    private fun maintainBackgroundService() {
        if (shouldRunBackgroundService()) {
            startDexBackgroundService()
        } else {
            stopDexBackgroundService()
        }
    }

    private fun startDexBackgroundService() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_BACKGROUND_SERVICE_ENABLED, true).apply()
        val intent = Intent(this, DexForegroundService::class.java)
        ContextCompat.startForegroundService(this, intent)
    }

    private fun stopDexBackgroundService() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_BACKGROUND_SERVICE_ENABLED, false).apply()
        stopService(Intent(this, DexForegroundService::class.java))
    }

    private fun handleWakeRecognitionError(error: Int) {
        if (!wakeModeEnabled) return
        when (error) {
            SpeechRecognizer.ERROR_NO_MATCH,
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> {
                binding.conversationStatus.text =
                    if (awaitingWakeCommand || conversationActive) getString(R.string.wake_mode_command_ready)
                    else getString(R.string.wake_mode_waiting)
                scheduleWakeListeningRestart(2500)
            }
            else -> binding.conversationStatus.text = getString(R.string.wake_mode_unavailable)
        }
    }

    private fun handleWakeTranscript(transcript: String) {
        if (!wakeModeEnabled) return
        val normalized = transcript.trim().lowercase(Locale.US)
        if (normalized.isBlank()) {
            scheduleWakeListeningRestart(2500)
            return
        }

        binding.lastHeardValue.text = sanitizeWakeTranscriptForDisplay(normalized)

        if (normalized.contains("stop listening") || normalized.contains("go to sleep")) {
            stopWakeMode()
            speakDex(getString(R.string.wake_mode_sleep_reply))
            return
        }

        if (!awaitingWakeCommand && !conversationActive) {
            if (!containsWakeWord(normalized)) {
                binding.conversationStatus.text = getString(R.string.wake_mode_waiting)
                scheduleWakeListeningRestart(2500)
                return
            }

            val spokenCommand = stripWakeWord(normalized)
            conversationActive = true
            scheduleConversationTimeout()
            if (spokenCommand.isNotBlank()) {
                processDexCommand(spokenCommand)
            } else {
                awaitingWakeCommand = true
                binding.conversationStatus.text = getString(R.string.wake_mode_command_ready)
                speakDex(
                    getString(R.string.wake_mode_acknowledged),
                    R.string.voice_speaking,
                    resumeWakeModeAfterSpeech = true
                )
            }
            return
        }

        conversationActive = true
        scheduleConversationTimeout()
        awaitingWakeCommand = false
        val cleanedTranscript = stripWakeWord(normalized)
        if (cleanedTranscript.isBlank()) {
            binding.conversationStatus.text = getString(R.string.wake_mode_command_ready)
            scheduleWakeListeningRestart(2500)
            return
        }
        processDexCommand(cleanedTranscript)
    }

    private fun containsWakeWord(transcript: String): Boolean =
        WAKE_WORD_VARIANTS.any { transcript.contains(it) }

    private fun stripWakeWord(transcript: String): String {
        var cleaned = transcript
        WAKE_WORD_VARIANTS.forEach { variant ->
            cleaned = cleaned.replace(variant, " ")
        }
        return cleaned.replace("\\s+".toRegex(), " ").trim()
    }

    private fun sanitizeWakeTranscriptForDisplay(transcript: String): String {
        val cleanedCommand = stripWakeWord(transcript)
        if (containsWakeWord(transcript) && cleanedCommand.isBlank()) {
            return getString(R.string.wake_mode_detected)
        }
        return cleanedCommand.ifBlank { transcript }
    }

    @Suppress("DEPRECATION")
    private fun startCallMonitoring() {
        if (phoneStateListener != null) return
        val manager = telephonyManager ?: return
        val listener = object : PhoneStateListener() {
            override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                super.onCallStateChanged(state, phoneNumber)
                handleCallStateChanged(state, phoneNumber)
            }
        }
        phoneStateListener = listener
        manager.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
    }

    @Suppress("DEPRECATION")
    private fun stopCallMonitoring() {
        val manager = telephonyManager ?: return
        phoneStateListener?.let { manager.listen(it, PhoneStateListener.LISTEN_NONE) }
        phoneStateListener = null
        lastCallState = TelephonyManager.CALL_STATE_IDLE
        lastCaller = "Unknown caller"
        stopListeningForCallCommand()
        updateCallActionVisibility(false)
        currentCallWasAnswered = false
        enableSpeakerAfterAnswer = false
    }

    private fun handleCallStateChanged(state: Int, phoneNumber: String?) {
        val resolvedCaller = resolveCallerLabel(phoneNumber)
        when (state) {
            TelephonyManager.CALL_STATE_RINGING -> {
                mainHandler.removeCallbacks(restartWakeListeningRunnable)
                currentCallWasAnswered = false
                lastCaller = resolvedCaller
                lastIncomingNumber = phoneNumber?.trim()?.takeIf { it.isNotBlank() }
                lastIncomingNeedsSave = lastIncomingNumber != null && lookupContactName(lastIncomingNumber!!) == null
                if (isLikelySpamCaller(resolvedCaller, phoneNumber)) {
                    binding.callMonitorStatus.text = getString(R.string.call_spam_blocked)
                    postCallEvent("declined", resolvedCaller)
                    declineRingingCall()
                } else {
                    updateCallActionVisibility(true)
                    speakIncomingCallPrompt(resolvedCaller)
                    postCallEvent("incoming", resolvedCaller)
                }
            }
            TelephonyManager.CALL_STATE_OFFHOOK -> {
                stopListeningForCallCommand()
                updateCallActionVisibility(false)
                currentCallWasAnswered = true
                if (enableSpeakerAfterAnswer) {
                    setSpeakerphoneEnabled(true)
                    enableSpeakerAfterAnswer = false
                }
                if (lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                    postCallEvent("answered", resolvedCaller)
                }
            }
            TelephonyManager.CALL_STATE_IDLE -> {
                stopListeningForCallCommand()
                updateCallActionVisibility(false)
                if (lastCallState == TelephonyManager.CALL_STATE_RINGING && !currentCallWasAnswered) {
                    postCallEvent("declined", resolvedCaller)
                }
                maybeQueueUnknownCallerSave()
                lastCaller = "Unknown caller"
                lastIncomingNumber = null
                lastIncomingNeedsSave = false
                currentCallWasAnswered = false
                enableSpeakerAfterAnswer = false
                if (wakeModeEnabled) {
                    scheduleWakeListeningRestart(500)
                }
            }
        }
        lastCallState = state
    }

    private fun resolveCallerLabel(phoneNumber: String?): String {
        val rawNumber = phoneNumber?.trim().orEmpty()
        if (rawNumber.isBlank()) {
            return lastCaller.takeUnless { it.isBlank() || it == "Unknown caller" } ?: "Unknown caller"
        }
        val contactName = lookupContactName(rawNumber)
        return contactName ?: rawNumber
    }

    private fun lookupContactName(phoneNumber: String): String? {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            return null
        }
        val projection = arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME)
        val candidates = linkedSetOf(phoneNumber, phoneNumber.filter { it.isDigit() || it == '+' })
        for (candidate in candidates) {
            if (candidate.isBlank()) continue
            val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(candidate))
            val cursor: Cursor? = contentResolver.query(uri, projection, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    return it.getString(0)
                }
            }
        }
        return null
    }

    private fun isLikelySpamCaller(callerLabel: String, phoneNumber: String?): Boolean {
        val normalized = callerLabel.lowercase(Locale.US)
        val spamKeywords = listOf("spam", "scam", "fraud", "telemarketer", "robocall")
        if (spamKeywords.any { normalized.contains(it) }) {
            return true
        }
        val rawNumber = phoneNumber?.trim().orEmpty()
        if (rawNumber.isBlank()) return false
        return rawNumber.startsWith("000") || rawNumber == "Unknown caller"
    }

    private fun speakIncomingCallPrompt(caller: String) {
        shouldResumeCallListeningAfterSpeech = true
        speakDex(getString(R.string.call_prompt_template, caller), R.string.call_speaking)
    }

    private fun parseCallVoiceAction(transcript: String): CallVoiceAction? {
        val normalized = transcript.trim().lowercase(Locale.US)
        if (normalized.isBlank()) return null
        if (normalized.contains("incoming call") || (normalized.contains("answer") && normalized.contains("decline"))) {
            return null
        }
        return when {
            normalized.contains("take a message") ||
                normalized.contains("take the message") ||
                normalized.contains("message them instead") ||
                normalized.contains("send it to voicemail") -> CallVoiceAction.TAKE_MESSAGE
            normalized.contains("answer on speaker") ||
                normalized.contains("pick up on speaker") ||
                normalized.contains("take the call on speaker") -> CallVoiceAction.ANSWER_ON_SPEAKER
            normalized == "answer" ||
                normalized.startsWith("answer ") ||
                normalized == "accept" ||
                normalized.startsWith("accept ") ||
                normalized.contains("pick up") ||
                normalized.contains("take the call") -> CallVoiceAction.ANSWER
            normalized == "decline" ||
                normalized.startsWith("decline ") ||
                normalized == "reject" ||
                normalized.startsWith("reject ") ||
                normalized.contains("hang up") ||
                normalized.contains("ignore the call") -> CallVoiceAction.DECLINE
            else -> null
        }
    }

    private fun speakDex(
        text: String,
        activeStatusResId: Int = R.string.voice_speaking,
        resumeWakeModeAfterSpeech: Boolean = false
    ) {
        if (!ttsReady) {
            if (shouldResumeCallListeningAfterSpeech && lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                shouldResumeCallListeningAfterSpeech = false
                startListeningForCallCommand()
            }
            ttsStatusMessage = getString(R.string.voice_setup_needed)
            refreshVoiceStatus()
            Toast.makeText(this, R.string.voice_setup_needed, Toast.LENGTH_SHORT).show()
            return
        }

        this.resumeWakeListeningAfterSpeech = resumeWakeModeAfterSpeech
        mainHandler.removeCallbacks(restartWakeListeningRunnable)
        if (!resumeWakeModeAfterSpeech) {
            mainHandler.removeCallbacks(restartWakeListeningRunnable)
        }
        textToSpeech?.stop()
        val result = textToSpeech?.speak(
            text,
            TextToSpeech.QUEUE_FLUSH,
            null,
            "dex_voice_${System.currentTimeMillis()}"
        ) ?: TextToSpeech.ERROR

        if (result == TextToSpeech.SUCCESS) {
            ttsStatusMessage = getString(activeStatusResId)
        } else {
            ttsReady = false
            ttsStatusMessage = getString(R.string.voice_not_ready)
        }
        refreshVoiceStatus()
    }

    private fun openVoiceSetup() {
        val voiceSetupIntent = Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA)
        val fallbackIntent = Intent(Settings.ACTION_SETTINGS)
        try {
            startActivity(voiceSetupIntent)
        } catch (_: ActivityNotFoundException) {
            startActivity(fallbackIntent)
        } catch (_: Exception) {
            Toast.makeText(this, R.string.voice_setup_open_failed, Toast.LENGTH_SHORT).show()
        }
    }

    private fun startListeningForCallCommand() {
        if (isListeningForCallCommand) return
        mainHandler.removeCallbacks(restartWakeListeningRunnable)
        val recognizer = speechRecognizer ?: run {
            binding.callMonitorStatus.text = getString(R.string.call_voice_unavailable)
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            binding.callMonitorStatus.text = getString(R.string.call_voice_unavailable)
            return
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1800L)
        }
        isListeningForCallCommand = true
        recognizer.startListening(intent)
    }

    private fun stopListeningForCallCommand() {
        if (!isListeningForCallCommand) return
        isListeningForCallCommand = false
        shouldResumeCallListeningAfterSpeech = false
        speechRecognizer?.stopListening()
        speechRecognizer?.cancel()
    }

    private fun startWakeMode(automatic: Boolean = false) {
        if (authToken.isNullOrBlank()) {
            binding.conversationStatus.text = getString(R.string.wake_mode_login_needed)
            return
        }
        if (currentServerUrl().isBlank()) {
            binding.conversationStatus.text = getString(R.string.wake_mode_server_needed)
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            binding.conversationStatus.text = getString(R.string.wake_mode_permission_needed)
            return
        }
        if (speechRecognizer == null) {
            binding.conversationStatus.text = getString(R.string.wake_mode_unavailable)
            return
        }
        wakeModeEnabled = true
        awaitingWakeCommand = false
        conversationActive = false
        binding.lastHeardValue.text = getString(R.string.voice_dash)
        binding.lastReplyValue.text = getString(R.string.voice_dash)
        binding.conversationStatus.text =
            if (automatic) getString(R.string.wake_mode_auto_started)
            else getString(R.string.wake_mode_waiting)
        updateWakeUi()
        maintainBackgroundService()
        scheduleWakeListeningRestart(1200)
    }

    private fun stopWakeMode() {
        wakeModeEnabled = false
        awaitingWakeCommand = false
        conversationActive = false
        autoWakeStarted = false
        resumeWakeListeningAfterSpeech = false
        mainHandler.removeCallbacks(resetWakeWindowRunnable)
        mainHandler.removeCallbacks(restartWakeListeningRunnable)
        if (!isListeningForCallCommand) {
            speechRecognizer?.cancel()
        }
        updateWakeUi()
        maintainBackgroundService()
    }

    private fun startWakeWordListening() {
        if (!wakeModeEnabled || isListeningForCallCommand) return
        val recognizer = speechRecognizer ?: return
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 10000L)
        }
        try {
            recognizer.cancel()
            lastWakeListenStartedAt = SystemClock.elapsedRealtime()
            recognizer.startListening(intent)
        } catch (_: Exception) {
            binding.conversationStatus.text = getString(R.string.wake_mode_unavailable)
        }
    }

    private fun scheduleWakeListeningRestart(delayMs: Long = 3500L) {
        if (!wakeModeEnabled) return
        val elapsed = SystemClock.elapsedRealtime() - lastWakeListenStartedAt
        val adjustedDelay = max(delayMs, WAKE_LISTEN_MIN_GAP_MS - elapsed)
        mainHandler.removeCallbacks(restartWakeListeningRunnable)
        mainHandler.postDelayed(restartWakeListeningRunnable, adjustedDelay)
    }

    private fun processDexCommand(message: String) {
        if (handleTaskIntent(message)) return
        sendDexChat(message)
    }

    private fun openYoutube(query: String?) {
        val uri = if (query.isNullOrBlank()) {
            Uri.parse("https://www.youtube.com")
        } else {
            Uri.parse("https://www.youtube.com/results?search_query=${Uri.encode(query)}")
        }
        val intent = Intent(Intent.ACTION_VIEW, uri)
        try {
            startActivity(intent)
            val reply = if (query.isNullOrBlank()) getString(R.string.youtube_opened) else getString(R.string.youtube_search_opened, query)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        } catch (_: Exception) {
            val reply = getString(R.string.action_open_failed)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        }
    }

    private fun openYoutubeMusic(message: String) {
        val query = message
            .replace(Regex("^(?:play|open|put on)\\s+", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\b(?:some\\s+)?music\\b", RegexOption.IGNORE_CASE), "")
            .trim()
        val uri = if (query.isBlank()) {
            Uri.parse("https://music.youtube.com")
        } else {
            Uri.parse("https://music.youtube.com/search?q=${Uri.encode(query)}")
        }
        val intent = Intent(Intent.ACTION_VIEW, uri)
        try {
            startActivity(intent)
            val reply = if (query.isBlank()) getString(R.string.music_opened) else getString(R.string.music_search_opened, query)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        } catch (_: Exception) {
            val reply = getString(R.string.action_open_failed)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        }
    }

    private fun setSpeakerphoneEnabled(enabled: Boolean) {
        val audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        @Suppress("DEPRECATION")
        runCatching {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = enabled
        }
    }

    private fun handleMediaIntent(message: String): Boolean {
        val normalized = message.trim().lowercase(Locale.US)
        val youtubeSearch = Regex("^(?:open|pull up|search)\\s+youtube\\s*(?:for)?\\s*(.*)$", RegexOption.IGNORE_CASE)
            .find(message.trim())
        if (youtubeSearch != null) {
            val query = youtubeSearch.groupValues[1].trim()
            openYoutube(query.ifBlank { null })
            return true
        }
        if (
            normalized.contains("play some music") ||
            normalized.contains("play music") ||
            normalized.contains("open youtube music") ||
            normalized.contains("put on some music")
        ) {
            openYoutubeMusic(message)
            return true
        }
        return false
    }

    private fun handleSpeakerIntent(normalized: String): Boolean {
        val speakerRequest =
            normalized.contains("put it on speaker") ||
                normalized.contains("put this on speaker") ||
                normalized.contains("turn on speaker") ||
                normalized.contains("answer on speaker") ||
                normalized.contains("take the call on speaker")
        if (!speakerRequest) return false

        if (lastCallState == TelephonyManager.CALL_STATE_RINGING) {
            enableSpeakerAfterAnswer = true
            answerRingingCall()
            return true
        }

        if (lastCallState == TelephonyManager.CALL_STATE_OFFHOOK) {
            setSpeakerphoneEnabled(true)
            val reply = getString(R.string.call_speaker_enabled)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return true
        }

        val reply = getString(R.string.call_speaker_unavailable)
        binding.conversationStatus.text = reply
        binding.lastReplyValue.text = reply
        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        return true
    }

    private fun buildCallMessageDraft(caller: String, phoneNumber: String?): PendingAction? {
        val targetValue = phoneNumber?.trim()?.takeIf { it.isNotBlank() } ?: return null
        val targetName = caller.takeUnless { it.isBlank() || it == "Unknown caller" }
        return PendingAction(
            kind = PendingActionKind.SMS_DRAFT,
            summary = getString(R.string.call_message_draft_summary, targetName ?: targetValue),
            detail = getString(R.string.call_message_draft_detail, targetName ?: targetValue),
            targetName = targetName,
            targetValue = targetValue,
            body = getString(R.string.call_message_sms_body)
        )
    }

    private fun takeMessageForCurrentCaller() {
        if (lastCallState != TelephonyManager.CALL_STATE_RINGING) {
            val reply = getString(R.string.call_message_unavailable)
            binding.callMonitorStatus.text = reply
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return
        }

        val caller = lastCaller.takeUnless { it.isBlank() } ?: "Unknown caller"
        val number = lastIncomingNumber
        createCallFollowUpTask(caller, number)
        declineRingingCall()
        val draftedReply = buildCallMessageDraft(caller, number)?.also { queuePendingAction(it) } != null

        val reply = if (number.isNullOrBlank()) {
            getString(R.string.call_message_taken_no_number, caller)
        } else {
            getString(R.string.call_message_taken, caller)
        }
        binding.callMonitorStatus.text = reply
        binding.conversationStatus.text = reply
        binding.lastReplyValue.text = reply
        if (!draftedReply) {
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        }
    }

    private fun handleTaskIntent(message: String): Boolean {
        val normalized = message.trim().lowercase(Locale.US)
        if (normalized.isBlank()) return false

        if (
            normalized.contains("what is on my calendar") ||
            normalized.contains("what's on my calendar") ||
            normalized.contains("what do i have today") ||
            normalized.contains("what do i have tomorrow") ||
            normalized.contains("my schedule today") ||
            normalized.contains("my schedule tomorrow")
        ) {
            fetchAppointmentsSummary(normalized)
            return true
        }

        if (
            normalized.contains("morning briefing") ||
            normalized.contains("brief my day") ||
            normalized.contains("plan my day") ||
            normalized.contains("what should i focus on today")
        ) {
            fetchMorningBriefing()
            return true
        }

        if (handleMediaIntent(message)) return true

        if (handleSpeakerIntent(normalized)) return true

        if (
            normalized.contains("take a message") ||
            normalized.contains("take the message") ||
            normalized.contains("message them instead")
        ) {
            takeMessageForCurrentCaller()
            return true
        }

        buildSmsDraft(message)?.let {
            queuePendingAction(it)
            return true
        }

        buildEmailDraft(message)?.let {
            queuePendingAction(it)
            return true
        }

        buildDirectCallRequest(message)?.let {
            placeVoiceRequestedCall(it)
            return true
        }

        buildHeuristicCallRequest(message)?.let {
            placeVoiceRequestedCall(it)
            return true
        }

        buildAppointmentDraft(message)?.let {
            queuePendingAction(it)
            return true
        }

        return false
    }

    private fun queuePendingAction(action: PendingAction) {
        pendingAction = action
        updatePendingActionUi()
        binding.conversationStatus.text = getString(R.string.pending_action_ready)
        binding.lastReplyValue.text = action.summary
        conversationActive = true
        scheduleConversationTimeout()
        speakDex(action.summary, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        syncPendingCommunicationDraft(action)
    }

    private fun scheduleConversationTimeout() {
        mainHandler.removeCallbacks(resetWakeWindowRunnable)
        mainHandler.postDelayed(resetWakeWindowRunnable, CONVERSATION_TIMEOUT_MS)
    }

    private fun maybeQueueUnknownCallerSave() {
        val number = lastIncomingNumber ?: return
        if (!lastIncomingNeedsSave) return
        if (pendingAction != null) return
        val action = PendingAction(
            kind = PendingActionKind.CONTACT_SAVE,
            summary = getString(R.string.contact_save_summary, number),
            detail = getString(R.string.contact_save_detail),
            targetValue = number,
        )
        queuePendingAction(action)
    }

    private fun sendDexChat(message: String) {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        if (serverUrl.isBlank()) {
            binding.conversationStatus.text = getString(R.string.wake_mode_server_needed)
            return
        }
        awaitingWakeCommand = false
        mainHandler.removeCallbacks(resetWakeWindowRunnable)
        binding.lastHeardValue.text = message
        binding.conversationStatus.text = getString(R.string.wake_mode_thinking)
        lifecycleScope.launch {
            val result = postJson("$serverUrl/dex/chat", JSONObject().apply { put("message", message) }, token)
            result.onSuccess { response ->
                val reply = response.optString("reply").ifBlank { getString(R.string.wake_mode_fallback_reply) }
                binding.lastReplyValue.text = reply
                binding.conversationStatus.text = getString(R.string.wake_mode_replying)
                conversationActive = true
                scheduleConversationTimeout()
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            }.onFailure { error ->
                val fallback = error.message ?: getString(R.string.wake_mode_fallback_reply)
                binding.lastReplyValue.text = fallback
                binding.conversationStatus.text = fallback
                conversationActive = true
                scheduleConversationTimeout()
                speakDex(fallback, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            }
        }
    }

    private fun buildSmsDraft(message: String): PendingAction? {
        val match = Regex("^(?:text|sms|message)\\s+(.+?)\\s+(?:saying|that|message|tell)\\s+(.+)$", RegexOption.IGNORE_CASE)
            .find(message.trim()) ?: return null
        val contactName = match.groupValues[1].trim()
        val body = match.groupValues[2].trim()
        val contact = findPhoneContactByName(contactName) ?: run {
            val reply = getString(R.string.contact_not_found_phone, contactName)
            binding.lastReplyValue.text = reply
            binding.conversationStatus.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return null
        }
        return PendingAction(
            kind = PendingActionKind.SMS_DRAFT,
            summary = getString(R.string.sms_draft_summary, contact.displayName),
            detail = body,
            targetName = contact.displayName,
            targetValue = contact.value,
            body = body,
        )
    }

    private fun buildEmailDraft(message: String): PendingAction? {
        val match = Regex("^(?:email)\\s+(.+?)\\s+(?:about|saying|that|subject)\\s+(.+)$", RegexOption.IGNORE_CASE)
            .find(message.trim()) ?: return null
        val contactName = match.groupValues[1].trim()
        val body = match.groupValues[2].trim()
        val contact = findEmailContactByName(contactName) ?: run {
            val reply = getString(R.string.contact_not_found_email, contactName)
            binding.lastReplyValue.text = reply
            binding.conversationStatus.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return null
        }
        return PendingAction(
            kind = PendingActionKind.EMAIL_DRAFT,
            summary = getString(R.string.email_draft_summary, contact.displayName),
            detail = body,
            targetName = contact.displayName,
            targetValue = contact.value,
            subject = getString(R.string.default_email_subject),
            body = body,
        )
    }

    private fun buildDirectCallRequest(message: String): DirectCallRequest? {
        val normalized = message.trim()
        val patterns = listOf(
            Regex("^(?:call|dial|ring|phone)\\s+(.+)$", RegexOption.IGNORE_CASE),
            Regex("^(?:can you\\s+)?call\\s+(.+)$", RegexOption.IGNORE_CASE),
            Regex("^(?:can you\\s+)?(?:place|make)\\s+(?:a\\s+)?call\\s+(?:to\\s+)?(.+)$", RegexOption.IGNORE_CASE),
            Regex("^(?:i need to\\s+)?call\\s+(.+)$", RegexOption.IGNORE_CASE),
        )
        val match = patterns.firstNotNullOfOrNull { it.find(normalized) } ?: return null
        val contactName = resolveContactAlias(
            match.groupValues[1]
            .trim()
            .replace(Regex("^(?:to\\s+)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s+(?:for me|please)$", RegexOption.IGNORE_CASE), "")
            .trim()
        )
        if (contactName.isBlank()) return null
        val contact = findPhoneContactByName(contactName) ?: run {
            val reply = getString(R.string.contact_not_found_phone, contactName)
            binding.lastReplyValue.text = reply
            binding.conversationStatus.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return null
        }
        return DirectCallRequest(
            displayName = contact.displayName,
            phoneNumber = contact.value,
        )
    }

    private fun buildHeuristicCallRequest(message: String): DirectCallRequest? {
        val normalized = message.lowercase(Locale.US)
        val soundsLikeCallRequest =
            normalized.contains("call") ||
                normalized.contains("dial") ||
                normalized.contains("ring") ||
                normalized.contains("phone")
        if (!soundsLikeCallRequest) return null

        val contact = findAnyPhoneContactMentioned(resolveAliasesInSentence(message)) ?: return null
        return DirectCallRequest(
            displayName = contact.displayName,
            phoneNumber = contact.value,
        )
    }

    private fun buildAppointmentDraft(message: String): PendingAction? {
        val normalized = message.lowercase(Locale.US)
        val appointmentIntent =
            normalized.contains("schedule") ||
                normalized.contains("book") ||
                normalized.contains("appointment") ||
                normalized.contains("add to my calendar") ||
                normalized.contains("set up")
        if (!appointmentIntent) return null

        val start = inferDateTimeFromCommand(message)
        val end = start.plusHours(1)
        val title = message
            .replace(Regex("\\b(schedule|book|appointment|add to my calendar|set up)\\b", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\b(today|tomorrow|next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday)\\b", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\bat\\s+\\d{1,2}(?::\\d{2})?\\s*(am|pm)\\b", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\b(noon|midnight|morning|afternoon|evening|tonight)\\b", RegexOption.IGNORE_CASE), "")
            .trim()
            .ifBlank { "Dex task" }

        return PendingAction(
            kind = PendingActionKind.APPOINTMENT_CREATE,
            summary = getString(R.string.appointment_draft_summary, title),
            detail = getString(
                R.string.appointment_draft_detail,
                start.format(DateTimeFormatter.ofPattern("EEE, MMM d 'at' h:mm a"))
            ),
            appointmentTitle = title.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() },
            appointmentStartIso = start.atZone(ZoneId.systemDefault()).toOffsetDateTime().toString(),
            appointmentEndIso = end.atZone(ZoneId.systemDefault()).toOffsetDateTime().toString(),
        )
    }

    private fun inferDateTimeFromCommand(message: String): LocalDateTime {
        val lower = message.lowercase(Locale.US)
        val date = inferRequestedDate(lower)
        val timeMatch = Regex("(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)", RegexOption.IGNORE_CASE).find(lower)
        val time = if (timeMatch != null) {
            var hour = timeMatch.groupValues[1].toInt()
            val minute = timeMatch.groupValues[2].ifBlank { "0" }.toInt()
            val meridiem = timeMatch.groupValues[3].lowercase(Locale.US)
            if (meridiem == "pm" && hour < 12) hour += 12
            if (meridiem == "am" && hour == 12) hour = 0
            LocalTime.of(hour, minute)
        } else if (lower.contains("noon")) {
            LocalTime.NOON
        } else if (lower.contains("midnight")) {
            LocalTime.MIDNIGHT
        } else if (lower.contains("morning")) {
            LocalTime.of(9, 0)
        } else if (lower.contains("afternoon")) {
            LocalTime.of(15, 0)
        } else if (lower.contains("evening") || lower.contains("tonight")) {
            LocalTime.of(18, 0)
        } else {
            LocalTime.of(9, 0)
        }
        return LocalDateTime.of(date, time)
    }

    private fun inferRequestedDate(command: String): LocalDate {
        val today = LocalDate.now()
        if (command.contains("tomorrow")) return today.plusDays(1)
        if (command.contains("next week")) return today.plusWeeks(1)

        val weekdays = mapOf(
            "monday" to DayOfWeek.MONDAY,
            "tuesday" to DayOfWeek.TUESDAY,
            "wednesday" to DayOfWeek.WEDNESDAY,
            "thursday" to DayOfWeek.THURSDAY,
            "friday" to DayOfWeek.FRIDAY,
            "saturday" to DayOfWeek.SATURDAY,
            "sunday" to DayOfWeek.SUNDAY,
        )

        for ((name, dayOfWeek) in weekdays) {
            if (command.contains("next $name")) {
                return nextDateForDay(dayOfWeek, forceNextWeek = true)
            }
            if (command.contains(name)) {
                return nextDateForDay(dayOfWeek, forceNextWeek = false)
            }
        }

        return today
    }

    private fun nextDateForDay(dayOfWeek: DayOfWeek, forceNextWeek: Boolean): LocalDate {
        val today = LocalDate.now()
        var candidate = today
        while (candidate.dayOfWeek != dayOfWeek) {
            candidate = candidate.plusDays(1)
        }
        if (forceNextWeek || !candidate.isAfter(today)) {
            candidate = candidate.plusWeeks(1)
        }
        return candidate
    }

    private fun fetchAppointmentsSummary(command: String) {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        binding.conversationStatus.text = getString(R.string.wake_mode_thinking)
        lifecycleScope.launch {
            val result = getJsonArray("$serverUrl/dex/appointments", token)
            result.onSuccess { response ->
                val targetDate = inferRequestedDate(command.lowercase(Locale.US))
                val summary = when {
                    response.length() == 0 -> getString(R.string.no_appointments_found)
                    else -> {
                        val entries = mutableListOf<String>()
                        for (index in 0 until response.length()) {
                            val item = response.optJSONObject(index) ?: continue
                            val startTime = item.optString("start_time")
                            val title = item.optString("title").ifBlank { "Appointment" }
                            val parsed = runCatching { java.time.OffsetDateTime.parse(startTime).toLocalDateTime() }.getOrNull()
                            if (parsed != null && parsed.toLocalDate() == targetDate) {
                                entries += "$title at ${parsed.format(DateTimeFormatter.ofPattern("h:mm a"))}"
                            }
                        }
                        if (entries.isEmpty()) getString(R.string.no_matching_appointments)
                        else entries.joinToString(". ")
                    }
                }
                binding.lastReplyValue.text = summary
                binding.conversationStatus.text = summary
                speakDex(summary, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            }.onFailure { error ->
                val reply = error.message ?: getString(R.string.wake_mode_fallback_reply)
                binding.lastReplyValue.text = reply
                binding.conversationStatus.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            }
        }
    }

    private fun fetchMorningBriefing() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        binding.conversationStatus.text = getString(R.string.wake_mode_thinking)
        lifecycleScope.launch {
            val result = getJson("$serverUrl/dex/briefing", token)
            result.onSuccess { response ->
                val briefing = response.optJSONObject("briefing") ?: JSONObject()
                val highlights = briefing.optJSONArray("highlights") ?: JSONArray()
                val agenda = briefing.optJSONArray("agenda") ?: JSONArray()
                val priorities = briefing.optJSONArray("priorities") ?: JSONArray()
                val nextLesson = briefing.optJSONObject("nextLesson")
                val parts = mutableListOf<String>()

                if (highlights.length() > 0) {
                    parts += highlights.optString(0)
                }
                if (agenda.length() > 0) {
                    val firstAgenda = agenda.optJSONObject(0)
                    if (firstAgenda != null) {
                        parts += getString(
                            R.string.briefing_first_event,
                            firstAgenda.optString("title").ifBlank { getString(R.string.briefing_default_event) }
                        )
                    }
                }
                if (priorities.length() > 0) {
                    val firstTask = priorities.optJSONObject(0)
                    if (firstTask != null) {
                        parts += getString(
                            R.string.briefing_first_task,
                            firstTask.optString("title").ifBlank { getString(R.string.briefing_default_task) }
                        )
                    }
                }
                if (nextLesson != null) {
                    val topic = nextLesson.optString("topic")
                    if (topic.isNotBlank()) {
                        parts += getString(R.string.briefing_next_lesson, topic)
                    }
                }

                val reply = if (parts.isEmpty()) getString(R.string.briefing_fallback) else parts.joinToString(" ")
                binding.lastReplyValue.text = reply
                binding.conversationStatus.text = reply
                conversationActive = true
                scheduleConversationTimeout()
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            }.onFailure { error ->
                val reply = error.message ?: getString(R.string.briefing_fallback)
                binding.lastReplyValue.text = reply
                binding.conversationStatus.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            }
        }
    }

    private fun approvePendingAction() {
        val action = pendingAction ?: return
        updateCommunicationDraftStatus(action, "approved")
        when (action.kind) {
            PendingActionKind.SMS_DRAFT -> openSmsDraft(action)
            PendingActionKind.EMAIL_DRAFT -> openEmailDraft(action)
            PendingActionKind.APPOINTMENT_CREATE -> createAppointmentFromDraft(action)
            PendingActionKind.CONTACT_SAVE -> openContactSaveDraft(action)
        }
    }

    private fun cancelPendingAction() {
        pendingAction?.let { updateCommunicationDraftStatus(it, "canceled") }
        pendingAction = null
        updatePendingActionUi()
        binding.conversationStatus.text = getString(R.string.pending_action_canceled)
        speakDex(getString(R.string.pending_action_canceled), R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
    }

    private fun syncPendingCommunicationDraft(action: PendingAction) {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        val channel = when (action.kind) {
            PendingActionKind.SMS_DRAFT -> "sms"
            PendingActionKind.EMAIL_DRAFT -> "email"
            else -> return
        }
        lifecycleScope.launch {
            val payload = JSONObject().apply {
                put("channel", channel)
                put("target_name", action.targetName ?: "")
                put("target_value", action.targetValue ?: "")
                put("subject", action.subject ?: "")
                put("body", action.body ?: action.detail)
                put("source", "android_voice")
            }
            val result = postJson("$serverUrl/dex/communications", payload, token)
            result.onSuccess { response ->
                val draft = response.optJSONObject("draft") ?: return@onSuccess
                val draftId = draft.optInt("id")
                val current = pendingAction
                if (current != null && current.summary == action.summary && current.targetValue == action.targetValue) {
                    pendingAction = current.copy(serverDraftId = draftId)
                    updatePendingActionUi()
                }
            }.onFailure {
                // Keep local approval flow working even if draft sync fails.
            }
        }
    }

    private fun updateCommunicationDraftStatus(action: PendingAction, status: String) {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        val draftId = action.serverDraftId ?: return
        lifecycleScope.launch {
            val payload = JSONObject().apply { put("status", status) }
            postJson("$serverUrl/dex/communications/$draftId", payload, token)
        }
    }

    private fun createCallFollowUpTask(caller: String, phoneNumber: String?) {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            val details = buildString {
                append("Caller: ").append(caller)
                if (!phoneNumber.isNullOrBlank()) {
                    append("\nNumber: ").append(phoneNumber)
                }
                append("\nRequested by Dex call screening on Android.")
            }
            val payload = JSONObject().apply {
                put("title", getString(R.string.call_message_task_title, caller))
                put("details", details)
                put("kind", "call_follow_up")
                put("source", "android_call_screening")
            }
            postJson("$serverUrl/dex/tasks", payload, token)
        }
    }

    private fun openSmsDraft(action: PendingAction) {
        val number = action.targetValue ?: return
        val body = action.body.orEmpty()
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            data = Uri.parse("smsto:$number")
            putExtra("sms_body", body)
        }
        try {
            startActivity(intent)
            pendingAction = null
            updatePendingActionUi()
            val reply = getString(R.string.sms_draft_opened, action.targetName ?: "your contact")
            binding.conversationStatus.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        } catch (_: Exception) {
            binding.conversationStatus.text = getString(R.string.action_open_failed)
        }
    }

    private fun openEmailDraft(action: PendingAction) {
        val email = action.targetValue ?: return
        val intent = Intent(Intent.ACTION_SENDTO).apply {
            data = Uri.parse("mailto:$email")
            putExtra(Intent.EXTRA_SUBJECT, action.subject ?: getString(R.string.default_email_subject))
            putExtra(Intent.EXTRA_TEXT, action.body.orEmpty())
        }
        try {
            startActivity(intent)
            pendingAction = null
            updatePendingActionUi()
            val reply = getString(R.string.email_draft_opened, action.targetName ?: "your contact")
            binding.conversationStatus.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        } catch (_: Exception) {
            binding.conversationStatus.text = getString(R.string.action_open_failed)
        }
    }

    private fun placeVoiceRequestedCall(request: DirectCallRequest) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            val reply = getString(R.string.call_phone_permission_missing)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return
        }
        val intent = Intent(Intent.ACTION_CALL).apply {
            data = Uri.parse("tel:${request.phoneNumber}")
        }
        try {
            startActivity(intent)
            val reply = getString(R.string.call_direct_started, request.displayName)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            conversationActive = true
            scheduleConversationTimeout()
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        } catch (_: Exception) {
            val reply = getString(R.string.action_open_failed)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        }
    }

    private fun createAppointmentFromDraft(action: PendingAction) {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        val title = action.appointmentTitle ?: return
        val start = action.appointmentStartIso ?: return
        val end = action.appointmentEndIso
        lifecycleScope.launch {
            val payload = JSONObject().apply {
                put("title", title)
                put("description", action.detail)
                put("start_time", start)
                if (!end.isNullOrBlank()) put("end_time", end)
            }
            val result = postJson("$serverUrl/dex/appointment", payload, token)
            result.onSuccess {
                pendingAction = null
                updatePendingActionUi()
                val reply = getString(R.string.appointment_created, title)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            }.onFailure { error ->
                val reply = error.message ?: getString(R.string.appointment_create_failed)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            }
        }
    }

    private fun openContactSaveDraft(action: PendingAction) {
        val number = action.targetValue ?: return
        val intent = Intent(Insert.ACTION).apply {
            type = ContactsContract.RawContacts.CONTENT_TYPE
            putExtra(ContactsContract.Intents.Insert.PHONE, number)
        }
        try {
            startActivity(intent)
            pendingAction = null
            updatePendingActionUi()
            val reply = getString(R.string.contact_save_opened, number)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        } catch (_: Exception) {
            binding.conversationStatus.text = getString(R.string.action_open_failed)
        }
    }

    private fun findPhoneContactByName(name: String): ContactMatch? {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            return null
        }
        val cursor = contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            ),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
            arrayOf("%$name%"),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
        )
        cursor?.use {
            if (it.moveToFirst()) {
                return ContactMatch(
                    displayName = it.getString(0),
                    value = it.getString(1)
                )
            }
        }
        return null
    }

    private fun resolveContactAlias(name: String): String {
        val normalized = name.trim().lowercase(Locale.US)
        if (normalized.isBlank()) return name
        val direct = relationshipAliases[normalized]
        if (!direct.isNullOrBlank()) return direct
        val stripped = normalized
            .replace(Regex("^(?:my|the)\\s+"), "")
            .replace(Regex("\\s+(?:please|for me)$"), "")
            .trim()
        return relationshipAliases[stripped].takeUnless { it.isNullOrBlank() } ?: name
    }

    private fun resolveAliasesInSentence(message: String): String {
        var updated = message
        for ((alias, contactName) in relationshipAliases.entries.sortedByDescending { it.key.length }) {
            val pattern = Regex("\\b${Regex.escape(alias)}\\b", RegexOption.IGNORE_CASE)
            updated = updated.replace(pattern, contactName)
        }
        return updated
    }

    private fun findAnyPhoneContactMentioned(message: String): ContactMatch? {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            return null
        }
        val loweredMessage = message.lowercase(Locale.US)
        val cursor = contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            ),
            null,
            null,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
        )
        cursor?.use {
            while (it.moveToNext()) {
                val displayName = it.getString(0) ?: continue
                val number = it.getString(1) ?: continue
                if (loweredMessage.contains(displayName.lowercase(Locale.US))) {
                    return ContactMatch(
                        displayName = displayName,
                        value = number
                    )
                }
            }
        }
        return null
    }

    private fun findEmailContactByName(name: String): ContactMatch? {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            return null
        }
        val cursor = contentResolver.query(
            ContactsContract.CommonDataKinds.Email.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Email.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Email.ADDRESS
            ),
            "${ContactsContract.CommonDataKinds.Email.DISPLAY_NAME} LIKE ?",
            arrayOf("%$name%"),
            "${ContactsContract.CommonDataKinds.Email.DISPLAY_NAME} ASC"
        )
        cursor?.use {
            if (it.moveToFirst()) {
                return ContactMatch(
                    displayName = it.getString(0),
                    value = it.getString(1)
                )
            }
        }
        return null
    }

    private fun updateCallActionVisibility(show: Boolean) {
        binding.callActionsRow.visibility = if (show) View.VISIBLE else View.GONE
    }

    @Suppress("DEPRECATION")
    private fun answerRingingCall() {
        stopListeningForCallCommand()
        if (lastCallState != TelephonyManager.CALL_STATE_RINGING) {
            binding.callMonitorStatus.text = getString(R.string.call_not_ringing)
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ANSWER_PHONE_CALLS) != PackageManager.PERMISSION_GRANTED) {
            binding.callMonitorStatus.text = getString(R.string.call_answer_permission_missing)
            return
        }
        val manager = telecomManager ?: run {
            binding.callMonitorStatus.text = getString(R.string.call_answer_failed)
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            binding.callMonitorStatus.text = getString(R.string.call_answer_failed)
            return
        }
        binding.callMonitorStatus.text = getString(R.string.call_answering)
        attemptAnswerCall(manager, 0)
    }

    @Suppress("DEPRECATION")
    private fun attemptAnswerCall(manager: TelecomManager, attempt: Int) {
        try {
            manager.acceptRingingCall()
            binding.callMonitorStatus.text = getString(R.string.call_answered)
            postCallEvent("answered", lastCaller)
        } catch (_: SecurityException) {
            binding.callMonitorStatus.text = getString(R.string.call_answer_permission_missing)
        } catch (_: Exception) {
            if (attempt < MAX_CALL_ANSWER_RETRIES && lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                mainHandler.postDelayed({ attemptAnswerCall(manager, attempt + 1) }, CALL_ANSWER_RETRY_DELAY_MS)
            } else {
                binding.callMonitorStatus.text = getString(R.string.call_answer_failed)
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun declineRingingCall() {
        stopListeningForCallCommand()
        try {
            val manager = telecomManager ?: return
            val ended = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) manager.endCall() else false
            binding.callMonitorStatus.text =
                if (ended) getString(R.string.call_declined) else getString(R.string.call_decline_failed)
        } catch (_: SecurityException) {
            binding.callMonitorStatus.text = getString(R.string.call_decline_failed)
        } catch (_: Exception) {
            binding.callMonitorStatus.text = getString(R.string.call_decline_failed)
        }
    }

    private fun postCallEvent(event: String, caller: String) {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            val payload = JSONObject().apply {
                put("event", event)
                put("caller", caller)
                put("timestamp", System.currentTimeMillis())
            }
            val result = postJson("$serverUrl/dex/call-event", payload, token)
            result.onSuccess {
                binding.callMonitorStatus.text = getString(R.string.call_event_sent, "$event ($caller)")
            }.onFailure { error ->
                binding.callMonitorStatus.text = error.message ?: getString(R.string.call_monitor_waiting)
            }
        }
    }

    private fun setAuthLoading(loading: Boolean) {
        binding.authProgress.visibility = if (loading) View.VISIBLE else View.GONE
        binding.authActionButton.isEnabled = !loading
        binding.logoutButton.isEnabled = !loading
    }

    private fun setPermissionsLoading(loading: Boolean) {
        binding.permissionsProgress.visibility = if (loading) View.VISIBLE else View.GONE
        val enabled = !loading && !authToken.isNullOrBlank()
        binding.phonePermissionSwitch.isEnabled = enabled
        binding.calendarPermissionSwitch.isEnabled = enabled
        binding.notificationsPermissionSwitch.isEnabled = enabled
        binding.requestAndroidPermissionsButton.isEnabled = !loading
    }

    private suspend fun postJson(url: String, payload: JSONObject, token: String?): Result<JSONObject> {
        return withContext(Dispatchers.IO) {
            runCatching {
                val requestBuilder = Request.Builder()
                    .url(url)
                    .post(payload.toString().toRequestBody(jsonType))
                    .header("Content-Type", "application/json")

                if (!token.isNullOrBlank()) {
                    requestBuilder.header("Authorization", "Bearer $token")
                }

                client.newCall(requestBuilder.build()).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        throw IOException(parseErrorMessage(body, response.code))
                    }
                    parseJsonObjectOrThrow(body, response.code)
                }
            }
        }
    }

    private suspend fun getJson(url: String, token: String): Result<JSONObject> {
        return withContext(Dispatchers.IO) {
            runCatching {
                val request = Request.Builder()
                    .url(url)
                    .get()
                    .header("Authorization", "Bearer $token")
                    .build()

                client.newCall(request).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        throw IOException(parseErrorMessage(body, response.code))
                    }
                    parseJsonObjectOrThrow(body, response.code)
                }
            }
        }
    }

    private suspend fun getJsonArray(url: String, token: String): Result<JSONArray> {
        return withContext(Dispatchers.IO) {
            runCatching {
                val request = Request.Builder()
                    .url(url)
                    .get()
                    .header("Authorization", "Bearer $token")
                    .build()

                client.newCall(request).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        throw IOException(parseErrorMessage(body, response.code))
                    }
                    if (body.isBlank()) JSONArray() else JSONArray(body)
                }
            }
        }
    }

    companion object {
        const val PREFS_NAME = "dex_android"
        const val KEY_SERVER_URL = "server_url"
        const val KEY_TOKEN = "token"
        const val KEY_EMAIL = "email"
        const val KEY_BACKGROUND_SERVICE_ENABLED = "background_service_enabled"
        const val KEY_AUTO_START_ASSISTANT = "auto_start_assistant"
        const val KEY_PHONE_BACKEND_ENABLED = "phone_backend_enabled"
        const val KEY_APP_IN_FOREGROUND = "app_in_foreground"
        const val KEY_LEARNING_REMINDER_ENABLED = "learning_reminder_enabled"
        const val KEY_LEARNING_REMINDER_TIME = "learning_reminder_time"
        const val KEY_LEARNING_REMINDER_TITLE = "learning_reminder_title"
        const val KEY_LEARNING_REMINDER_TEXT = "learning_reminder_text"
        const val DEFAULT_SERVER_URL = "https://konvict-artz.onrender.com/api"
        private val WAKE_WORD_VARIANTS = listOf(
            "hey dex",
            "hey decks",
            "hey deks",
            "hey dix",
            "hey dicks",
            "hey dick's"
        )
        private const val CONVERSATION_TIMEOUT_MS = 45_000L
        private const val MAX_CALL_ANSWER_RETRIES = 2
        private const val CALL_ANSWER_RETRY_DELAY_MS = 350L
        private const val CALL_COMMAND_RETRY_DELAY_MS = 400L
        private const val CALL_COMMAND_PROMPT_GUARD_DELAY_MS = 900L
        private const val WAKE_LISTEN_MIN_GAP_MS = 3500L
    }
}
