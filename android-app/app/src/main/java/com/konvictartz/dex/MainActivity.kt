package com.konvictartz.dex

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
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
import android.telephony.SmsManager
import android.telephony.TelephonyManager
import android.view.View
import android.widget.Toast
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.material.card.MaterialCardView
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

private enum class DecorationPickTarget {
    BACKGROUND,
    LEFT_STICKER,
    RIGHT_STICKER,
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

private data class DashboardSection(
    val title: String,
    val body: String,
)

private enum class PendingContactAction {
    CALL,
    TEXT,
    EMAIL,
}

class MainActivity : AppCompatActivity(), TextToSpeech.OnInitListener {
    private lateinit var binding: ActivityMainBinding
    private val client = OkHttpClient()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val mainHandler = Handler(Looper.getMainLooper())

    private var isRegisterMode = false
    private var authToken: String? = null
    private var currentUserRole: String = "user"
    private var currentUserName: String = ""
    private var currentAccessType: String = ""
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
    private var pendingContactTarget: ContactMatch? = null
    private var pendingContactAction: PendingContactAction? = null
    private var pendingSmsRecipient: ContactMatch? = null
    private var pendingSmsBodyDraft: String? = null
    private var currentThemePreset: String = THEME_STUDIO
    private var currentAccentColor: String = DEFAULT_ACCENT_COLOR
    private var currentBackgroundColor: String = DEFAULT_BACKGROUND_COLOR
    private var currentPanelColor: String = DEFAULT_PANEL_COLOR
    private var isAdvancedStyleVisible = false
    private var currentBackgroundImageUri: String? = null
    private var currentLeftStickerUri: String? = null
    private var currentRightStickerUri: String? = null
    private var pendingDecorationPickTarget: DecorationPickTarget? = null
    private var currentTrialDaysLeft: Int? = null
    private var hasBillingCustomer = false
    private val dashboardSections = mutableListOf<DashboardSection>()

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

    private val decorationImagePicker =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            val target = pendingDecorationPickTarget
            pendingDecorationPickTarget = null
            if (uri == null || target == null) return@registerForActivityResult
            runCatching {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            when (target) {
                DecorationPickTarget.BACKGROUND -> {
                    currentBackgroundImageUri = uri.toString()
                    binding.homeStyleMessage.text = getString(R.string.home_style_background_added)
                }
                DecorationPickTarget.LEFT_STICKER -> {
                    currentLeftStickerUri = uri.toString()
                    binding.homeStyleMessage.text = getString(R.string.home_style_sticker_added)
                }
                DecorationPickTarget.RIGHT_STICKER -> {
                    currentRightStickerUri = uri.toString()
                    binding.homeStyleMessage.text = getString(R.string.home_style_sticker_added)
                }
            }
            applyHomeMedia()
            persistHomeLook()
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
            fetchCurrentUserProfile()
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

        binding.useInviteCodeButton.setOnClickListener {
            val code = binding.inviteCodeInput.text?.toString()?.trim().orEmpty()
            if (code.isBlank()) {
                binding.inviteCodeMessage.text = getString(R.string.invite_code_needed)
                return@setOnClickListener
            }
            isRegisterMode = true
            binding.authModeToggle.check(binding.registerModeButton.id)
            binding.affiliateInviteInput.setText(code)
            binding.inviteCodeMessage.text = getString(R.string.invite_code_applied)
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

        binding.adminGenerateInviteButton.setOnClickListener {
            createAdminAffiliateInvite()
        }

        binding.saveLearningProfileButton.setOnClickListener {
            saveLearningProfile()
        }

        binding.getDailyLessonButton.setOnClickListener {
            requestDailyLesson()
        }

        binding.startLearningQuizButton.setOnClickListener {
            requestLearningQuiz()
        }

        binding.buildDailyPlanButton.setOnClickListener {
            requestDashboardSection(
                sectionTitle = "Daily plan",
                prompt = "Build me a practical daily plan for today with morning, afternoon, evening, top priorities, and one self-care reminder.",
                fallbackMessage = getString(R.string.daily_plan_failed)
            )
        }

        binding.buildDietPlanButton.setOnClickListener {
            requestDashboardSection(
                sectionTitle = "Diet plan",
                prompt = "Build me a simple diet plan for today with breakfast, lunch, dinner, one snack, hydration, and a short healthy reminder.",
                fallbackMessage = getString(R.string.diet_plan_failed)
            )
        }

        binding.buildWorkoutPlanButton.setOnClickListener {
            requestDashboardSection(
                sectionTitle = "Workout plan",
                prompt = "Build me a practical workout plan for today with warmup, main workout, cooldown, and one recovery tip.",
                fallbackMessage = getString(R.string.custom_section_failed)
            )
        }

        binding.buildBudgetPlanButton.setOnClickListener {
            requestDashboardSection(
                sectionTitle = "Budget plan",
                prompt = "Build me a simple budget plan for today with spending priorities, what to avoid, and one saving reminder.",
                fallbackMessage = getString(R.string.custom_section_failed)
            )
        }

        binding.buildPrayerPlanButton.setOnClickListener {
            requestDashboardSection(
                sectionTitle = "Prayer plan",
                prompt = "Build me a short prayer plan for today with morning reflection, midday focus, evening gratitude, and one encouraging reminder.",
                fallbackMessage = getString(R.string.custom_section_failed)
            )
        }

        binding.addCustomSectionButton.setOnClickListener {
            val custom = binding.customSectionInput.text?.toString()?.trim().orEmpty()
            if (custom.isBlank()) {
                binding.lifeSectionsPreview.text = getString(R.string.custom_section_needed)
                return@setOnClickListener
            }
            requestDashboardSection(
                sectionTitle = custom.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() },
                prompt = "Build me a useful dashboard section for this topic: $custom. Keep it clear, practical, and organized with short bullets or headings.",
                fallbackMessage = getString(R.string.custom_section_failed)
            )
            binding.customSectionInput.setText("")
        }

        binding.subscribeNowButton.setOnClickListener {
            openStripeCheckout()
        }

        binding.manageBillingButton.setOnClickListener {
            openBillingPortal()
        }

        binding.themeOceanButton.setOnClickListener { applyThemePreset(THEME_OCEAN, persist = true) }
        binding.themeSunsetButton.setOnClickListener { applyThemePreset(THEME_SUNSET, persist = true) }
        binding.themeStudioButton.setOnClickListener { applyThemePreset(THEME_STUDIO, persist = true) }
        binding.toggleAdvancedStyleButton.setOnClickListener {
            updateAdvancedStyleUi(!isAdvancedStyleVisible)
        }
        binding.accentBlueButton.setOnClickListener { applyAccentChoice("#69C6FF") }
        binding.accentRoseButton.setOnClickListener { applyAccentChoice("#FF8AAE") }
        binding.accentGoldButton.setOnClickListener { applyAccentChoice("#F5C451") }
        binding.accentMintButton.setOnClickListener { applyAccentChoice("#70E0C0") }
        binding.accentPurpleButton.setOnClickListener { applyAccentChoice("#B18CFF") }
        binding.accentCoralButton.setOnClickListener { applyAccentChoice("#FF7F6A") }
        binding.accentLavenderButton.setOnClickListener { applyAccentChoice("#D8C4FF") }
        binding.accentPeachButton.setOnClickListener { applyAccentChoice("#FFBE98") }
        binding.accentLimeButton.setOnClickListener { applyAccentChoice("#B7E35C") }
        binding.accentSilverButton.setOnClickListener { applyAccentChoice("#CFD5E2") }
        binding.accentCrimsonButton.setOnClickListener { applyAccentChoice("#E35778") }
        binding.accentTealButton.setOnClickListener { applyAccentChoice("#58D2CC") }
        binding.pickBackgroundImageButton.setOnClickListener {
            openDecorationPicker(DecorationPickTarget.BACKGROUND)
        }
        binding.clearBackgroundImageButton.setOnClickListener {
            clearHomeBackgroundImage()
        }
        binding.pickLeftStickerButton.setOnClickListener {
            openDecorationPicker(DecorationPickTarget.LEFT_STICKER)
        }
        binding.pickRightStickerButton.setOnClickListener {
            openDecorationPicker(DecorationPickTarget.RIGHT_STICKER)
        }
        binding.clearStickerImagesButton.setOnClickListener {
            clearStickerImages()
        }
        binding.applyCustomStyleButton.setOnClickListener {
            applyCustomHomeStyle()
        }
        binding.resetCustomStyleButton.setOnClickListener {
            resetCustomHomeStyle()
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
        binding.affiliateInviteInput.visibility = if (isRegisterMode) View.VISIBLE else View.GONE
    }

    private fun loadStoredState() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val restoredServerUrl = normalizeServerUrl(prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL))
        binding.serverUrlInput.setText(restoredServerUrl)
        authToken = prefs.getString(KEY_TOKEN, null)
        currentUserRole = prefs.getString(KEY_USER_ROLE, "user").orEmpty().ifBlank { "user" }
        currentUserName = prefs.getString(KEY_USER_NAME, "").orEmpty()
        currentAccessType = prefs.getString(KEY_ACCESS_TYPE, "").orEmpty()
        currentThemePreset = prefs.getString(KEY_THEME_PRESET, THEME_STUDIO).orEmpty().ifBlank { THEME_STUDIO }
        currentAccentColor = prefs.getString(KEY_ACCENT_COLOR, DEFAULT_ACCENT_COLOR).orEmpty().ifBlank { DEFAULT_ACCENT_COLOR }
        currentBackgroundColor = prefs.getString(KEY_BACKGROUND_COLOR, DEFAULT_BACKGROUND_COLOR).orEmpty().ifBlank { DEFAULT_BACKGROUND_COLOR }
        currentPanelColor = prefs.getString(KEY_PANEL_COLOR, DEFAULT_PANEL_COLOR).orEmpty().ifBlank { DEFAULT_PANEL_COLOR }
        binding.emailInput.setText(prefs.getString(KEY_EMAIL, ""))
        binding.affiliateInviteInput.setText(prefs.getString(KEY_AFFILIATE_INVITE_CODE, ""))
        binding.homeTitleInput.setText(prefs.getString(KEY_HOME_TITLE, ""))
        binding.homeSubtitleInput.setText(prefs.getString(KEY_HOME_SUBTITLE, ""))
        currentBackgroundImageUri = prefs.getString(KEY_HOME_BACKGROUND_URI, null)
        currentLeftStickerUri = prefs.getString(KEY_HOME_LEFT_STICKER_URI, null)
        currentRightStickerUri = prefs.getString(KEY_HOME_RIGHT_STICKER_URI, null)
        updateAdvancedStyleUi(currentThemePreset == "custom")
        loadDashboardSections()
        if (currentThemePreset == "custom") {
            applyHomePalette(
                accentHex = currentAccentColor,
                backgroundHex = currentBackgroundColor,
                panelHex = currentPanelColor,
                titleOverride = binding.homeTitleInput.text?.toString(),
                subtitleOverride = binding.homeSubtitleInput.text?.toString()
            )
        } else {
            applyThemePreset(currentThemePreset, persist = false)
        }
        applyHomeMedia()
    }

    private fun saveServerUrl(serverUrl: String) {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, serverUrl)
            .commit()
    }

    private fun saveSession(token: String, email: String, user: JSONObject?) {
        authToken = token
        currentUserRole = user?.optString("role").orEmpty().ifBlank { currentUserRole.ifBlank { "user" } }
        currentUserName = user?.optString("name").orEmpty().ifBlank { currentUserName }
        currentAccessType = user?.optString("access_type").orEmpty().ifBlank { currentAccessType }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_EMAIL, email)
            .putString(KEY_USER_ROLE, currentUserRole)
            .putString(KEY_USER_NAME, currentUserName)
            .putString(KEY_ACCESS_TYPE, currentAccessType)
            .putString(KEY_SERVER_URL, currentServerUrl())
            .putString(KEY_AFFILIATE_INVITE_CODE, binding.affiliateInviteInput.text?.toString().orEmpty())
            .putBoolean(KEY_AUTO_START_ASSISTANT, true)
            .commit()
        refreshLoggedInState()
        fetchCurrentUserProfile()
        fetchPermissions()
        maintainBackgroundService()
    }

    private fun clearSession() {
        authToken = null
        currentUserRole = "user"
        currentUserName = ""
        currentAccessType = ""
        phoneBackendEnabled = false
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER_ROLE)
            .remove(KEY_USER_NAME)
            .remove(KEY_ACCESS_TYPE)
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
        binding.inviteCodeCard.visibility = if (loggedIn) View.GONE else View.VISIBLE
        binding.dashboardCard.visibility = if (loggedIn) View.VISIBLE else View.GONE
        binding.userDashboardCard.visibility =
            if (loggedIn && (currentUserRole == "user" || currentUserRole == "affiliate" || currentUserRole == "admin")) View.VISIBLE else View.GONE
        binding.learningCenterCard.visibility =
            if (loggedIn && (currentUserRole == "user" || currentUserRole == "affiliate" || currentUserRole == "admin")) View.VISIBLE else View.GONE
        binding.lifeSectionsCard.visibility =
            if (loggedIn && (currentUserRole == "user" || currentUserRole == "affiliate" || currentUserRole == "admin")) View.VISIBLE else View.GONE
        binding.billingCard.visibility = if (loggedIn && currentUserRole != "admin") View.VISIBLE else View.GONE
        binding.affiliateDashboardCard.visibility = if (loggedIn && currentUserRole == "affiliate") View.VISIBLE else View.GONE
        binding.adminDashboardCard.visibility = if (loggedIn && currentUserRole == "admin") View.VISIBLE else View.GONE
        binding.themeCard.visibility = if (loggedIn) View.VISIBLE else View.GONE
        binding.serverCard.visibility = if (loggedIn && currentUserRole == "admin") View.VISIBLE else View.GONE
        binding.authModeToggle.visibility = if (loggedIn) View.GONE else View.VISIBLE
        binding.nameInput.visibility = if (!loggedIn && isRegisterMode) View.VISIBLE else View.GONE
        binding.affiliateInviteInput.visibility = if (!loggedIn && isRegisterMode) View.VISIBLE else View.GONE
        binding.emailInput.visibility = if (!loggedIn) View.VISIBLE else View.GONE
        binding.passwordInput.visibility = if (!loggedIn) View.VISIBLE else View.GONE
        binding.authActionButton.visibility = if (!loggedIn) View.VISIBLE else View.GONE
        binding.permissionsCard.alpha = if (loggedIn) 1f else 0.55f
        binding.phonePermissionSwitch.isEnabled = loggedIn
        binding.calendarPermissionSwitch.isEnabled = loggedIn
        binding.notificationsPermissionSwitch.isEnabled = loggedIn
        binding.authMessage.text = if (loggedIn) getString(R.string.connected_as, binding.emailInput.text?.toString().orEmpty()) else getString(R.string.logged_out_message)
        updateDashboardHeader()
        if (!loggedIn) {
            applyPermissions(emptyMap())
            autoWakeStarted = false
            binding.userDashboardChatCount.text = getString(R.string.chat_history_count, 0)
            binding.userDashboardLessonCount.text = getString(R.string.lesson_history_count, 0)
            binding.userDashboardQuizScore.text = getString(R.string.quiz_score_summary, getString(R.string.quiz_score_empty))
            binding.learningProfileSummary.text = getString(R.string.learning_profile_missing)
            binding.learningReminderSummary.text = getString(R.string.learning_reminder_off)
            binding.learningLessonPreview.text = ""
            binding.learningQuizPreview.text = ""
            binding.lifeSectionsPreview.text = ""
            dashboardSections.clear()
            renderDashboardSections()
            binding.billingStatusText.text = ""
            binding.billingDetailText.text = ""
        }
        refreshCallMonitorState()
        autoStartWakeModeIfReady()
    }

    private fun updateDashboardHeader() {
        val name = currentUserName.ifBlank {
            binding.emailInput.text?.toString()?.substringBefore("@").orEmpty().ifBlank { "Dex user" }
        }
        binding.dashboardWelcome.text = getString(R.string.dashboard_welcome, name)
        binding.dashboardRole.text = getString(R.string.dashboard_role, roleLabel(currentUserRole))
        binding.dashboardAccess.text = getString(R.string.dashboard_access, accessLabel(currentAccessType))
        binding.adminBackendValue.text = currentServerUrl()
    }

    private fun roleLabel(role: String): String = when (role.lowercase(Locale.US)) {
        "admin" -> getString(R.string.dashboard_role_admin)
        "affiliate" -> getString(R.string.dashboard_role_affiliate)
        else -> getString(R.string.dashboard_role_user)
    }

    private fun accessLabel(access: String): String = when (access.lowercase(Locale.US)) {
        "trial" -> getString(R.string.dashboard_access_trial)
        "paid" -> getString(R.string.dashboard_access_paid)
        "unlimited" -> getString(R.string.dashboard_access_unlimited)
        "expired" -> getString(R.string.dashboard_access_expired)
        else -> getString(R.string.dashboard_access_unknown)
    }

    private fun fetchDashboardData() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            getJsonArray("$serverUrl/dex/history", token).onSuccess { history ->
                binding.userDashboardChatCount.text = getString(R.string.chat_history_count, history.length())
            }
            getJson("$serverUrl/dex/learning/history", token).onSuccess { response ->
                val lessons = response.optJSONArray("lessons")?.length() ?: 0
                val average = response.optJSONObject("progress")?.optInt("averageScore")
                val streak = response.optJSONObject("progress")?.optInt("streak") ?: 0
                val nextLesson = response.optJSONObject("nextLesson")
                binding.userDashboardLessonCount.text = getString(R.string.lesson_history_count, lessons)
                binding.userDashboardQuizScore.text = getString(
                    R.string.quiz_score_summary,
                    if (average == null || average == 0 && (response.optJSONObject("progress")?.has("averageScore") != true)) {
                        getString(R.string.quiz_score_empty)
                    } else {
                        "$average%"
                    }
                )
                binding.learningQuizPreview.text = buildString {
                    if (streak > 0) {
                        append("Streak: $streak day")
                        if (streak != 1) append("s")
                    }
                    nextLesson?.optString("topic")?.takeIf { it.isNotBlank() }?.let { topic ->
                        if (isNotEmpty()) append("  ")
                        append("Next lesson: $topic")
                    }
                }
            }
            if (currentUserRole == "affiliate") {
                getJson("$serverUrl/affiliate/dashboard", token).onSuccess { response ->
                    binding.affiliatePromoCode.text = getString(R.string.affiliate_promo_code, response.optString("promoCode").ifBlank { "-" })
                    val earningsValue = response.optDouble("earnings", 0.0) / 100.0
                    binding.affiliateEarnings.text = getString(R.string.affiliate_earnings, String.format(Locale.US, "%.2f", earningsValue))
                    binding.affiliateSignups.text = getString(R.string.affiliate_signups, response.optInt("signups"))
                    binding.affiliatePaidSubs.text = getString(R.string.affiliate_paid_subs, response.optInt("paidSubs"))
                }
            }
            if (currentUserRole == "admin") {
                getJson("$serverUrl/admin/stats", token).onSuccess { response ->
                    binding.adminStatsValue.text = getString(
                        R.string.admin_stats_summary,
                        response.optInt("totalUsers"),
                        response.optInt("affiliateCount"),
                        response.optInt("activeToday"),
                        response.optInt("learningLessons")
                    )
                }
            }
        }
    }

    private fun createAdminAffiliateInvite() {
        val token = authToken ?: return
        if (currentUserRole != "admin") return
        val serverUrl = currentServerUrl()
        val payload = JSONObject().apply {
            val name = binding.adminInviteNameInput.text?.toString()?.trim().orEmpty()
            val email = binding.adminInviteEmailInput.text?.toString()?.trim().orEmpty()
            if (name.isNotBlank()) put("name", name)
            if (email.isNotBlank()) put("email", email)
        }
        lifecycleScope.launch {
            val result = postJson("$serverUrl/admin/affiliate-invites/create", payload, token)
            result.onSuccess { response ->
                val invite = response.optJSONObject("invite")
                val code = invite?.optString("code").orEmpty()
                binding.adminInviteResult.text = if (code.isNotBlank()) {
                    getString(R.string.admin_invite_created, code)
                } else {
                    response.optString("success")
                }
            }.onFailure { error ->
                binding.adminInviteResult.text = error.message ?: "Could not create affiliate code."
            }
        }
    }

    private fun saveLearningProfile() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        val updates = listOf(
            "learning_target_language" to binding.learningLanguageInput.text?.toString()?.trim().orEmpty(),
            "learning_level" to binding.learningLevelInput.text?.toString()?.trim().orEmpty(),
            "learning_focus" to binding.learningFocusInput.text?.toString()?.trim().orEmpty(),
            "learning_subject" to binding.learningSubjectInput.text?.toString()?.trim().orEmpty(),
            "learning_reminder_time" to binding.learningReminderTimeInput.text?.toString()?.trim().orEmpty(),
            "learning_reminder_enabled" to if (binding.learningReminderTimeInput.text?.toString()?.trim().isNullOrBlank()) "0" else "1",
        )
        lifecycleScope.launch {
            var failed = false
            updates.forEach { (key, value) ->
                val result = postJson(
                    "$serverUrl/dex/preferences",
                    JSONObject().apply {
                        put("key", key)
                        put("value", value)
                    },
                    token
                )
                if (result.isFailure) failed = true
            }
            if (failed) {
                binding.learningLessonPreview.text = getString(R.string.learning_profile_failed)
            } else {
                binding.learningLessonPreview.text = getString(R.string.learning_profile_saved)
                fetchLearningReminderPreferences()
                fetchDashboardData()
            }
        }
    }

    private fun requestDailyLesson() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        val payload = JSONObject().apply {
            binding.learningLanguageInput.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { put("language", it) }
            binding.learningLevelInput.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { put("level", it) }
            binding.learningFocusInput.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { put("focus", it) }
            binding.learningSubjectInput.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { put("topic", it) }
        }
        lifecycleScope.launch {
            binding.learningLessonPreview.text = "Building your lesson..."
            val result = postJson("$serverUrl/dex/learning/daily-lesson", payload, token)
            result.onSuccess { response ->
                val lesson = response.optJSONObject("lesson")
                if (lesson == null) {
                    binding.learningLessonPreview.text = getString(R.string.learning_lesson_failed)
                } else {
                    val title = lesson.optString("title").ifBlank { "Daily lesson" }
                    val body = lesson.optString("content")
                    binding.learningLessonPreview.text =
                        getString(R.string.learning_lesson_preview_title, lesson.optString("language").ifBlank { "Language" }, title) +
                            "\n\n" + body
                    fetchDashboardData()
                }
            }.onFailure {
                binding.learningLessonPreview.text = getString(R.string.learning_lesson_failed)
            }
        }
    }

    private fun requestLearningQuiz() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        val payload = JSONObject().apply {
            binding.learningLanguageInput.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { put("language", it) }
            binding.learningLevelInput.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { put("level", it) }
            binding.learningFocusInput.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { put("focus", it) }
            binding.learningSubjectInput.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { put("topic", it) }
        }
        lifecycleScope.launch {
            binding.learningQuizPreview.text = "Building your quiz..."
            val result = postJson("$serverUrl/dex/learning/quiz", payload, token)
            result.onSuccess { response ->
                val quiz = response.optJSONObject("quiz")
                if (quiz == null) {
                    binding.learningQuizPreview.text = getString(R.string.learning_quiz_failed)
                } else {
                    val questions = quiz.optJSONArray("questions")
                    val lines = mutableListOf<String>()
                    lines += getString(
                        R.string.learning_quiz_preview_title,
                        quiz.optString("language").ifBlank { "Language" },
                        quiz.optString("title").ifBlank { "Quiz" }
                    )
                    for (i in 0 until minOf(questions?.length() ?: 0, 5)) {
                        val item = questions?.optJSONObject(i) ?: continue
                        lines += "${i + 1}. ${item.optString("question")}"
                    }
                    binding.learningQuizPreview.text = lines.joinToString("\n")
                }
            }.onFailure {
                binding.learningQuizPreview.text = getString(R.string.learning_quiz_failed)
            }
        }
    }

    private fun requestDashboardSection(sectionTitle: String, prompt: String, fallbackMessage: String) {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            binding.lifeSectionsPreview.text = "Dex is building your section..."
            val result = postJson("$serverUrl/dex/chat", JSONObject().apply { put("message", prompt) }, token)
            result.onSuccess { response ->
                val reply = response.optString("reply").ifBlank { fallbackMessage }
                binding.lifeSectionsPreview.text = getString(R.string.custom_section_added, sectionTitle)
                addDashboardSection(sectionTitle, reply)
            }.onFailure {
                binding.lifeSectionsPreview.text = fallbackMessage
            }
        }
    }

    private fun addDashboardSection(title: String, body: String) {
        dashboardSections.removeAll { it.title.equals(title, ignoreCase = true) }
        dashboardSections.add(0, DashboardSection(title = title, body = body))
        while (dashboardSections.size > MAX_DASHBOARD_SECTIONS) {
            dashboardSections.removeAt(dashboardSections.lastIndex)
        }
        saveDashboardSections()
        renderDashboardSections()
    }

    private fun renderDashboardSections() {
        binding.lifeSectionsContainer.removeAllViews()
        dashboardSections.forEachIndexed { index, section ->
            val accentColor = runCatching {
                android.graphics.Color.parseColor(currentAccentColor)
            }.getOrDefault(android.graphics.Color.parseColor(DEFAULT_ACCENT_COLOR))
            val titleView = TextView(this).apply {
                text = section.title
                setTextColor(android.graphics.Color.WHITE)
                textSize = 16f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            }
            val bodyView = TextView(this).apply {
                text = section.body
                setTextColor(android.graphics.Color.WHITE)
                textSize = 14f
                setPadding(0, 8, 0, 0)
            }
            val controlsRow = android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.HORIZONTAL
                setPadding(0, 8, 0, 0)
            }
            val upView = TextView(this).apply {
                text = getString(R.string.section_move_up)
                setTextColor(accentColor)
                textSize = 13f
                setOnClickListener {
                    if (index <= 0) return@setOnClickListener
                    val moved = dashboardSections.removeAt(index)
                    dashboardSections.add(index - 1, moved)
                    saveDashboardSections()
                    renderDashboardSections()
                }
            }
            val downView = TextView(this).apply {
                text = getString(R.string.section_move_down)
                setTextColor(accentColor)
                textSize = 13f
                setPadding(32, 0, 0, 0)
                setOnClickListener {
                    if (index >= dashboardSections.lastIndex) return@setOnClickListener
                    val moved = dashboardSections.removeAt(index)
                    dashboardSections.add(index + 1, moved)
                    saveDashboardSections()
                    renderDashboardSections()
                }
            }
            val renameView = TextView(this).apply {
                text = getString(R.string.section_rename)
                setTextColor(accentColor)
                textSize = 13f
                setPadding(32, 0, 0, 0)
                setOnClickListener {
                    promptRenameDashboardSection(index)
                }
            }
            val removeView = TextView(this).apply {
                text = getString(R.string.section_remove)
                setTextColor(accentColor)
                textSize = 13f
                setPadding(32, 0, 0, 0)
                setOnClickListener {
                    dashboardSections.removeAt(index)
                    saveDashboardSections()
                    renderDashboardSections()
                    binding.lifeSectionsPreview.text = getString(R.string.section_removed)
                }
            }
            controlsRow.addView(upView)
            controlsRow.addView(downView)
            controlsRow.addView(renameView)
            controlsRow.addView(removeView)
            val container = android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                setPadding(0, if (index == 0) 0 else 20, 0, 0)
                addView(titleView)
                addView(bodyView)
                addView(controlsRow)
            }
            binding.lifeSectionsContainer.addView(container)
        }
    }

    private fun promptRenameDashboardSection(index: Int) {
        val current = dashboardSections.getOrNull(index) ?: return
        val input = com.google.android.material.textfield.TextInputEditText(this).apply {
            setText(current.title)
            setTextColor(android.graphics.Color.WHITE)
            hint = getString(R.string.rename_section_hint)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.rename_section_title)
            .setView(input)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val updated = input.text?.toString()?.trim().orEmpty()
                if (updated.isBlank()) return@setPositiveButton
                dashboardSections[index] = current.copy(title = updated)
                saveDashboardSections()
                renderDashboardSections()
                binding.lifeSectionsPreview.text = getString(R.string.section_renamed)
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun saveDashboardSections() {
        val json = JSONArray()
        dashboardSections.forEach { section ->
            json.put(
                JSONObject().apply {
                    put("title", section.title)
                    put("body", section.body)
                }
            )
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_DASHBOARD_SECTIONS, json.toString())
            .commit()
    }

    private fun loadDashboardSections() {
        dashboardSections.clear()
        val raw = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_DASHBOARD_SECTIONS, "[]")
            .orEmpty()
        runCatching {
            val json = JSONArray(raw)
            for (i in 0 until json.length()) {
                val item = json.optJSONObject(i) ?: continue
                val title = item.optString("title")
                val body = item.optString("body")
                if (title.isNotBlank() && body.isNotBlank()) {
                    dashboardSections += DashboardSection(title, body)
                }
            }
        }
        renderDashboardSections()
    }

    private fun fetchBillingStatus() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            val result = getJson("$serverUrl/payments/status", token)
            result.onSuccess { response ->
                currentAccessType = response.optString("access_type").ifBlank { currentAccessType }
                currentTrialDaysLeft = if (response.has("trialDaysLeft")) response.optInt("trialDaysLeft") else null
                hasBillingCustomer = !response.optString("stripe_customer_id").isNullOrBlank()
                updateBillingUi()
            }.onFailure {
                updateBillingUi()
            }
        }
    }

    private fun updateBillingUi() {
        val access = currentAccessType.lowercase(Locale.US)
        binding.billingStatusText.text = when (access) {
            "trial" -> getString(R.string.billing_status_trial)
            "paid" -> getString(R.string.billing_status_paid)
            "expired" -> getString(R.string.billing_status_expired)
            "unlimited" -> getString(R.string.billing_status_unlimited)
            else -> getString(R.string.billing_status_unknown)
        }
        binding.billingDetailText.text = when (access) {
            "trial" -> getString(R.string.billing_detail_trial, currentTrialDaysLeft ?: 0)
            "paid" -> getString(R.string.billing_detail_paid)
            "expired" -> getString(R.string.billing_detail_expired)
            "unlimited" -> getString(R.string.billing_detail_unlimited)
            else -> getString(R.string.billing_status_unknown)
        }
        binding.subscribeNowButton.visibility = if (access == "paid" || access == "unlimited") View.GONE else View.VISIBLE
        binding.manageBillingButton.visibility = if (hasBillingCustomer || access == "paid") View.VISIBLE else View.GONE
    }

    private fun openStripeCheckout() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            val result = postJson("$serverUrl/payments/checkout-session", JSONObject(), token)
            result.onSuccess { response ->
                val checkoutUrl = response.optString("checkoutUrl")
                if (checkoutUrl.isBlank()) {
                    binding.billingDetailText.text = getString(R.string.billing_checkout_failed)
                } else {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(checkoutUrl)))
                }
            }.onFailure { error ->
                binding.billingDetailText.text = error.message ?: getString(R.string.billing_checkout_failed)
            }
        }
    }

    private fun openBillingPortal() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            val result = postJson("$serverUrl/payments/portal", JSONObject(), token)
            result.onSuccess { response ->
                val portalUrl = response.optString("url")
                if (portalUrl.isBlank()) {
                    binding.billingDetailText.text = getString(R.string.billing_portal_failed)
                } else {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(portalUrl)))
                }
            }.onFailure { error ->
                binding.billingDetailText.text = error.message ?: getString(R.string.billing_portal_failed)
            }
        }
    }

    private fun applyThemePreset(theme: String, persist: Boolean) {
        currentThemePreset = theme
        currentAccentColor = when (theme) {
            THEME_OCEAN -> "#58C4FF"
            THEME_SUNSET -> "#FF8A5B"
            else -> DEFAULT_ACCENT_COLOR
        }
        currentBackgroundColor = when (theme) {
            THEME_OCEAN -> "#0C1B2A"
            THEME_SUNSET -> "#2A1614"
            else -> DEFAULT_BACKGROUND_COLOR
        }
        currentPanelColor = when (theme) {
            THEME_OCEAN -> "#14283D"
            THEME_SUNSET -> "#321C19"
            else -> DEFAULT_PANEL_COLOR
        }
        updateAdvancedStyleUi(false)
        applyHomePalette(
            accentHex = currentAccentColor,
            backgroundHex = currentBackgroundColor,
            panelHex = currentPanelColor,
            titleOverride = binding.homeTitleInput.text?.toString(),
            subtitleOverride = binding.homeSubtitleInput.text?.toString()
        )
        if (persist) {
            persistHomeLook()
        }
    }

    private fun applyCustomHomeStyle() {
        val okay = applyHomePalette(
            accentHex = currentAccentColor,
            backgroundHex = currentBackgroundColor,
            panelHex = currentPanelColor,
            titleOverride = binding.homeTitleInput.text?.toString(),
            subtitleOverride = binding.homeSubtitleInput.text?.toString()
        )
        if (!okay) {
            return
        }
        currentThemePreset = "custom"
        updateAdvancedStyleUi(true)
        persistHomeLook()
        binding.homeStyleMessage.text = getString(R.string.home_style_saved)
    }

    private fun resetCustomHomeStyle() {
        binding.homeTitleInput.setText("")
        binding.homeSubtitleInput.setText("")
        binding.homeStyleMessage.text = getString(R.string.home_style_reset)
        updateAdvancedStyleUi(false)
        applyThemePreset(THEME_STUDIO, persist = true)
        clearHomeBackgroundImage(showMessage = false)
        clearStickerImages(showMessage = false)
        persistHomeLook()
    }

    private fun applyAccentChoice(accentHex: String) {
        currentThemePreset = "custom"
        currentAccentColor = accentHex
        applyHomePalette(
            accentHex = currentAccentColor,
            backgroundHex = currentBackgroundColor,
            panelHex = currentPanelColor,
            titleOverride = binding.homeTitleInput.text?.toString(),
            subtitleOverride = binding.homeSubtitleInput.text?.toString()
        )
        updateAdvancedStyleUi(true)
        binding.homeStyleMessage.text = getString(R.string.home_style_saved)
    }

    private fun openDecorationPicker(target: DecorationPickTarget) {
        pendingDecorationPickTarget = target
        runCatching {
            decorationImagePicker.launch(arrayOf("image/*"))
        }.onFailure {
            pendingDecorationPickTarget = null
            binding.homeStyleMessage.text = getString(R.string.home_style_picker_failed)
        }
    }

    private fun clearHomeBackgroundImage(showMessage: Boolean = true) {
        currentBackgroundImageUri = null
        applyHomeMedia()
        if (showMessage) {
            binding.homeStyleMessage.text = getString(R.string.home_style_background_cleared)
        }
    }

    private fun clearStickerImages(showMessage: Boolean = true) {
        currentLeftStickerUri = null
        currentRightStickerUri = null
        applyHomeMedia()
        if (showMessage) {
            binding.homeStyleMessage.text = getString(R.string.home_style_stickers_cleared)
        }
    }

    private fun applyHomeMedia() {
        bindOptionalImage(binding.backgroundImageView, currentBackgroundImageUri)
        bindOptionalImage(binding.stickerLeftView, currentLeftStickerUri)
        bindOptionalImage(binding.stickerRightView, currentRightStickerUri)
        applyHomePalette(
            accentHex = currentAccentColor,
            backgroundHex = currentBackgroundColor,
            panelHex = currentPanelColor,
            titleOverride = binding.homeTitleInput.text?.toString(),
            subtitleOverride = binding.homeSubtitleInput.text?.toString()
        )
    }

    private fun bindOptionalImage(view: android.widget.ImageView, uriString: String?) {
        if (uriString.isNullOrBlank()) {
            view.setImageDrawable(null)
            view.visibility = View.GONE
            return
        }
        runCatching {
            view.setImageURI(Uri.parse(uriString))
            view.visibility = View.VISIBLE
        }.onFailure {
            view.setImageDrawable(null)
            view.visibility = View.GONE
        }
    }

    private fun persistHomeLook() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME_PRESET, currentThemePreset)
            .putString(KEY_HOME_TITLE, binding.homeTitleInput.text?.toString()?.trim().orEmpty())
            .putString(KEY_HOME_SUBTITLE, binding.homeSubtitleInput.text?.toString()?.trim().orEmpty())
            .putString(KEY_ACCENT_COLOR, currentAccentColor)
            .putString(KEY_BACKGROUND_COLOR, currentBackgroundColor)
            .putString(KEY_PANEL_COLOR, currentPanelColor)
            .putString(KEY_HOME_BACKGROUND_URI, currentBackgroundImageUri)
            .putString(KEY_HOME_LEFT_STICKER_URI, currentLeftStickerUri)
            .putString(KEY_HOME_RIGHT_STICKER_URI, currentRightStickerUri)
            .commit()
    }

    private fun updateAdvancedStyleUi(show: Boolean) {
        isAdvancedStyleVisible = show
        binding.advancedHomeStyleGroup.visibility = if (show) View.VISIBLE else View.GONE
        binding.toggleAdvancedStyleButton.text = getString(
            if (show) R.string.home_style_customize_less else R.string.home_style_customize_more
        )
    }

    private fun applyHomePalette(
        accentHex: String,
        backgroundHex: String,
        panelHex: String,
        titleOverride: String?,
        subtitleOverride: String?
    ): Boolean {
        return runCatching {
            val accentColor = android.graphics.Color.parseColor(accentHex)
            val backgroundColor = android.graphics.Color.parseColor(backgroundHex)
            val panelColor = android.graphics.Color.parseColor(panelHex)
            val tint = ColorStateList.valueOf(accentColor)

            binding.root.setBackgroundColor(backgroundColor)
            val scrollOverlayColor = if (currentBackgroundImageUri.isNullOrBlank()) {
                backgroundColor
            } else {
                android.graphics.Color.argb(
                    130,
                    android.graphics.Color.red(backgroundColor),
                    android.graphics.Color.green(backgroundColor),
                    android.graphics.Color.blue(backgroundColor)
                )
            }
            binding.contentScrollView.setBackgroundColor(scrollOverlayColor)
            binding.appTitle.setTextColor(accentColor)
            binding.statusTitle.text =
                titleOverride?.trim().takeUnless { it.isNullOrBlank() } ?: getString(R.string.dex_ready_title)
            binding.statusSummary.text =
                subtitleOverride?.trim().takeUnless { it.isNullOrBlank() } ?: getString(R.string.dex_ready_summary)

            listOf<MaterialCardView>(
                binding.inviteCodeCard,
                binding.authCard,
                binding.dashboardCard,
                binding.userDashboardCard,
                binding.learningCenterCard,
                binding.affiliateDashboardCard,
                binding.adminDashboardCard,
                binding.themeCard,
                binding.serverCard,
                binding.permissionsCard,
                binding.callMonitorCard,
                binding.voiceCard,
                binding.conversationCard
            ).forEach { card ->
                card.setCardBackgroundColor(panelColor)
            }

            listOf(
                binding.authActionButton,
                binding.useInviteCodeButton,
                binding.testVoiceButton,
                binding.wakeModeButton,
                binding.answerCallButton,
                binding.approveActionButton,
                binding.adminGenerateInviteButton,
                binding.getDailyLessonButton,
                binding.applyCustomStyleButton,
                binding.pickBackgroundImageButton
            ).forEach { button ->
                button.backgroundTintList = tint
            }
            true
        }.getOrDefault(false)
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
        val affiliateInviteCode = binding.affiliateInviteInput.text?.toString()?.trim().orEmpty()
        if (email.isBlank() || password.isBlank()) {
            binding.authMessage.text = "Email and password are required."
            return
        }
        runAuthRequest("/auth/register", JSONObject().apply {
            put("email", email)
            put("password", password)
            if (name.isNotBlank()) put("name", name)
            if (affiliateInviteCode.isNotBlank()) put("affiliateInviteCode", affiliateInviteCode)
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
                currentTrialDaysLeft = if (user?.has("trialDaysLeft") == true) user.optInt("trialDaysLeft") else null
                if (token.isBlank()) {
                    binding.authMessage.text = "Dex did not return a login token."
                    return@onSuccess
                }
                saveSession(token, email, user)
                binding.authMessage.text = getString(R.string.connected_as, email)
            }.onFailure { error ->
                binding.authMessage.text = error.message ?: "Dex sign-in failed."
            }
        }
    }

    private fun fetchCurrentUserProfile() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            val result = getJson("$serverUrl/auth/me", token)
            result.onSuccess { response ->
                val user = response.optJSONObject("user") ?: return@onSuccess
                currentUserRole = user.optString("role").ifBlank { currentUserRole.ifBlank { "user" } }
                currentUserName = user.optString("name").ifBlank { currentUserName }
                currentAccessType = user.optString("access_type").ifBlank { currentAccessType }
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_USER_ROLE, currentUserRole)
                    .putString(KEY_USER_NAME, currentUserName)
                    .putString(KEY_ACCESS_TYPE, currentAccessType)
                    .commit()
                refreshLoggedInState()
                fetchDashboardData()
                fetchBillingStatus()
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
                val level = preferences.optString("learning_level").ifBlank { "beginner" }
                val focus = preferences.optString("learning_focus").ifBlank { "conversation" }
                val subject = preferences.optString("learning_subject")
                    .ifBlank { preferences.optString("learning_focus").ifBlank { "practice" } }
                val title = getString(R.string.learning_reminder_title)
                val text = getString(R.string.learning_reminder_text_template, language, subject)

                binding.learningLanguageInput.setText(preferences.optString("learning_target_language"))
                binding.learningLevelInput.setText(preferences.optString("learning_level"))
                binding.learningFocusInput.setText(preferences.optString("learning_focus"))
                binding.learningSubjectInput.setText(preferences.optString("learning_subject"))
                binding.learningReminderTimeInput.setText(time)
                binding.learningProfileSummary.text =
                    if (preferences.optString("learning_target_language").isBlank()) {
                        getString(R.string.learning_profile_missing)
                    } else {
                        getString(R.string.learning_profile_summary, language, level, focus)
                    }
                binding.learningReminderSummary.text =
                    if (enabled && time.isNotBlank()) getString(R.string.learning_reminder_on, time)
                    else getString(R.string.learning_reminder_off)

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
                binding.learningProfileSummary.text = getString(R.string.learning_profile_missing)
                binding.learningReminderSummary.text = getString(R.string.learning_reminder_off)
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
                    Manifest.permission.SEND_SMS,
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
        detectContactOnlyIntent(message)?.let { contact ->
            handleDetectedContactTarget(contact)
            return
        }
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

        handlePendingActionVoiceCommand(normalized)?.let { actionTaken ->
            if (actionTaken) return true
        }

        consumePendingSmsBody(message)?.let { actionTaken ->
            if (actionTaken) return true
        }

        consumePendingActionOnlyIntent(normalized)?.let { actionTaken ->
            if (actionTaken) return true
        }

        consumePendingContactTarget(normalized)?.let { actionTaken ->
            if (actionTaken) return true
        }

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

        buildDashboardSectionIntent(message)?.let { (title, prompt, fallback) ->
            requestDashboardSection(title, prompt, fallback)
            return true
        }

        buildSmsDraft(message)?.let {
            queuePendingAction(it)
            return true
        }

        startSmsRecipientCapture(message)?.let { reply ->
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return true
        }

        buildEmailDraft(message)?.let {
            queuePendingAction(it)
            return true
        }

        buildQuickEmailDraft(message)?.let {
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

    private fun buildDashboardSectionIntent(message: String): Triple<String, String, String>? {
        val normalized = message.trim().lowercase(Locale.US)
        val dailyTriggers = listOf("daily plan", "day plan", "schedule section")
        val dietTriggers = listOf("diet plan", "meal plan", "food plan")
        val workoutTriggers = listOf("workout plan", "fitness plan", "exercise plan")
        val budgetTriggers = listOf("budget plan", "money plan", "budget section")
        val prayerTriggers = listOf("prayer plan", "prayer section", "devotion plan")

        fun wantsSection() =
            normalized.contains("add ") || normalized.contains("create ") ||
                normalized.contains("make ") || normalized.contains("build ")

        return when {
            wantsSection() && dailyTriggers.any { normalized.contains(it) } ->
                Triple(
                    "Daily plan",
                    "Build me a practical daily plan for today with morning, afternoon, evening, top priorities, and one self-care reminder.",
                    getString(R.string.daily_plan_failed)
                )
            wantsSection() && dietTriggers.any { normalized.contains(it) } ->
                Triple(
                    "Diet plan",
                    "Build me a simple diet plan for today with breakfast, lunch, dinner, one snack, hydration, and a short healthy reminder.",
                    getString(R.string.diet_plan_failed)
                )
            wantsSection() && workoutTriggers.any { normalized.contains(it) } ->
                Triple(
                    "Workout plan",
                    "Build me a practical workout plan for today with warmup, main workout, cooldown, and one recovery tip.",
                    getString(R.string.custom_section_failed)
                )
            wantsSection() && budgetTriggers.any { normalized.contains(it) } ->
                Triple(
                    "Budget plan",
                    "Build me a simple budget plan for today with spending priorities, what to avoid, and one saving reminder.",
                    getString(R.string.custom_section_failed)
                )
            wantsSection() && prayerTriggers.any { normalized.contains(it) } ->
                Triple(
                    "Prayer plan",
                    "Build me a short prayer plan for today with morning reflection, midday focus, evening gratitude, and one encouraging reminder.",
                    getString(R.string.custom_section_failed)
                )
            wantsSection() && normalized.contains("section") -> {
                val custom = normalized
                    .replace(Regex("^(?:add|create|make|build)\\s+", RegexOption.IGNORE_CASE), "")
                    .replace(Regex("\\s+section$", RegexOption.IGNORE_CASE), "")
                    .trim()
                if (custom.isBlank()) null else Triple(
                    custom.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() },
                    "Build me a useful dashboard section for this topic: $custom. Keep it clear, practical, and organized with short bullets or headings.",
                    getString(R.string.custom_section_failed)
                )
            }
            else -> null
        }
    }

    private fun handlePendingActionVoiceCommand(normalized: String): Boolean? {
        val action = pendingAction ?: return null
        return when (normalized) {
            "yes send", "send", "send it", "yes", "approve", "confirm", "go ahead" -> {
                approvePendingAction()
                true
            }
            "cancel", "cancel it", "don't send", "do not send", "no", "never mind", "stop" -> {
                cancelPendingAction()
                true
            }
            else -> false
        }
    }

    private fun handleDetectedContactTarget(contact: ContactMatch) {
        val pendingAction = pendingContactAction
        if (pendingAction != null) {
            pendingContactAction = null
            when (pendingAction) {
                PendingContactAction.CALL -> placeVoiceRequestedCall(DirectCallRequest(contact.displayName, contact.value))
                PendingContactAction.TEXT -> {
                    pendingSmsRecipient = contact
                    val reply = getString(R.string.ask_what_to_text, contact.displayName)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                }
                PendingContactAction.EMAIL -> {
                    val emailContact = findEmailContactByName(contact.displayName)
                    if (emailContact == null) {
                        val reply = getString(R.string.contact_not_found_email, contact.displayName)
                        binding.lastReplyValue.text = reply
                        binding.conversationStatus.text = reply
                        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    } else {
                        queuePendingAction(
                            PendingAction(
                                kind = PendingActionKind.EMAIL_DRAFT,
                                summary = getString(R.string.email_draft_summary, emailContact.displayName),
                                detail = getString(R.string.email_draft_detail_blank, emailContact.displayName),
                                targetName = emailContact.displayName,
                                targetValue = emailContact.value,
                                subject = getString(R.string.default_email_subject),
                                body = "",
                            )
                        )
                    }
                }
            }
            return
        }

        pendingContactTarget = contact
        val reply = getString(R.string.contact_target_confirmed, contact.displayName)
        binding.conversationStatus.text = reply
        binding.lastReplyValue.text = reply
        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
    }

    private fun queuePendingAction(action: PendingAction) {
        pendingAction = action
        updatePendingActionUi()
        binding.conversationStatus.text = getString(R.string.pending_action_ready)
        binding.lastReplyValue.text = action.summary
        conversationActive = true
        scheduleConversationTimeout()
        speakDex(buildPendingActionSpokenReply(action), R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        syncPendingCommunicationDraft(action)
    }

    private fun buildPendingActionSpokenReply(action: PendingAction): String {
        return when (action.kind) {
            PendingActionKind.SMS_DRAFT -> {
                val target = action.targetName ?: "your contact"
                val message = action.body?.trim().orEmpty().ifBlank { action.detail.trim() }
                if (message.isBlank()) {
                    getString(R.string.sms_approval_prompt_blank, target)
                } else {
                    getString(R.string.sms_approval_prompt, target, message)
                }
            }
            PendingActionKind.EMAIL_DRAFT -> {
                val target = action.targetName ?: "your contact"
                val message = action.body?.trim().orEmpty().ifBlank { action.detail.trim() }
                if (message.isBlank()) {
                    getString(R.string.email_approval_prompt_blank, target)
                } else {
                    getString(R.string.email_approval_prompt, target, message)
                }
            }
            else -> action.summary
        }
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
        val match = listOf(
            Regex("^(?:text|sms|message)\\s+(.+?)\\s+(?:saying|that|message|tell)\\s+(.+)$", RegexOption.IGNORE_CASE),
            Regex("^send\\s+(.+?)\\s+(?:a\\s+)?text\\s+(?:saying|that|message|tell)\\s+(.+)$", RegexOption.IGNORE_CASE),
            Regex("^send\\s+(?:a\\s+)?text\\s+to\\s+(.+?)\\s+(?:saying|that|message|tell)\\s+(.+)$", RegexOption.IGNORE_CASE),
        ).firstNotNullOfOrNull { it.find(message.trim()) } ?: return null
        val contactName = resolveContactAlias(match.groupValues[1].trim())
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
        val contactName = resolveContactAlias(match.groupValues[1].trim())
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

    private fun startSmsRecipientCapture(message: String): String? {
        val match = listOf(
            Regex("^(?:text|sms|message)\\s+(.+)$", RegexOption.IGNORE_CASE),
            Regex("^send\\s+(.+?)\\s+(?:a\\s+)?text$", RegexOption.IGNORE_CASE),
            Regex("^send\\s+(?:a\\s+)?text\\s+to\\s+(.+)$", RegexOption.IGNORE_CASE),
        ).firstNotNullOfOrNull { it.find(message.trim()) } ?: return null
        val contactName = resolveContactAlias(match.groupValues[1].trim())
        val contact = findPhoneContactByName(contactName) ?: return null
        pendingSmsRecipient = contact
        return getString(R.string.ask_what_to_text, contact.displayName)
    }

    private fun buildQuickEmailDraft(message: String): PendingAction? {
        val match = Regex("^(?:email)\\s+(.+)$", RegexOption.IGNORE_CASE)
            .find(message.trim()) ?: return null
        val contactName = resolveContactAlias(match.groupValues[1].trim())
        val contact = findEmailContactByName(contactName) ?: return null
        return PendingAction(
            kind = PendingActionKind.EMAIL_DRAFT,
            summary = getString(R.string.email_draft_summary, contact.displayName),
            detail = getString(R.string.email_draft_detail_blank, contact.displayName),
            targetName = contact.displayName,
            targetValue = contact.value,
            subject = getString(R.string.default_email_subject),
            body = "",
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

    private fun detectContactOnlyIntent(message: String): ContactMatch? {
        val resolvedName = resolveContactAlias(message.trim())
        if (resolvedName.isBlank()) return null
        return findExactPhoneContactByName(resolvedName)
            ?: findPhoneContactByName(resolvedName)
    }

    private fun consumePendingContactTarget(normalized: String): Boolean? {
        val contact = pendingContactTarget ?: return null
        return when {
            normalized == "call" || normalized == "call them" || normalized == "call her" || normalized == "call him" -> {
                pendingContactTarget = null
                placeVoiceRequestedCall(DirectCallRequest(contact.displayName, contact.value))
                true
            }
            normalized == "text" || normalized == "text them" || normalized == "message them" || normalized == "text her" || normalized == "text him" -> {
                pendingContactTarget = null
                queuePendingAction(
                    PendingAction(
                        kind = PendingActionKind.SMS_DRAFT,
                        summary = getString(R.string.sms_draft_summary, contact.displayName),
                        detail = getString(R.string.sms_draft_detail_blank, contact.displayName),
                        targetName = contact.displayName,
                        targetValue = contact.value,
                        body = "",
                    )
                )
                true
            }
            normalized == "email" || normalized == "email them" || normalized == "email her" || normalized == "email him" -> {
                pendingContactTarget = null
                val emailContact = findEmailContactByName(contact.displayName)
                if (emailContact == null) {
                    val reply = getString(R.string.contact_not_found_email, contact.displayName)
                    binding.lastReplyValue.text = reply
                    binding.conversationStatus.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                } else {
                    queuePendingAction(
                        PendingAction(
                            kind = PendingActionKind.EMAIL_DRAFT,
                            summary = getString(R.string.email_draft_summary, emailContact.displayName),
                            detail = getString(R.string.email_draft_detail_blank, emailContact.displayName),
                            targetName = emailContact.displayName,
                            targetValue = emailContact.value,
                            subject = getString(R.string.default_email_subject),
                            body = "",
                        )
                    )
                }
                true
            }
            else -> false
        }
    }

    private fun consumePendingActionOnlyIntent(normalized: String): Boolean? {
        return when (normalized) {
            "call", "call someone", "make a call", "place a call" -> {
                pendingContactAction = PendingContactAction.CALL
                val reply = getString(R.string.ask_who_to_call)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            "text", "text someone", "send a text", "message someone" -> {
                pendingContactAction = PendingContactAction.TEXT
                val reply = getString(R.string.ask_who_to_text)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            "send the message", "send the message for me", "send that message", "send this message", "send the text", "send the text for me" -> {
                if (pendingAction != null) {
                    approvePendingAction()
                } else {
                    pendingContactAction = PendingContactAction.TEXT
                    val reply = getString(R.string.ask_who_to_text)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                }
                true
            }
            "email", "email someone", "send an email" -> {
                pendingContactAction = PendingContactAction.EMAIL
                val reply = getString(R.string.ask_who_to_email)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            else -> null
        }
    }

    private fun consumePendingSmsBody(message: String): Boolean? {
        val recipient = pendingSmsRecipient ?: return null
        val trimmed = message.trim()
        if (trimmed.isBlank()) return false
        val normalized = trimmed.lowercase(Locale.US)
        val pendingDraft = pendingSmsBodyDraft
        return when (normalized) {
            "cancel", "cancel it", "never mind", "stop" -> {
                pendingSmsRecipient = null
                pendingSmsBodyDraft = null
                val reply = getString(R.string.pending_action_canceled)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            "text", "message", "sms", "send a text", "send the text", "send the message" -> true
            "yes", "yes use that", "use that", "that's right", "correct", "yes that's right", "yes send", "send it" -> {
                val approvedBody = pendingDraft?.trim().orEmpty()
                if (approvedBody.isBlank()) {
                    val reply = getString(R.string.ask_what_to_text, recipient.displayName)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                } else {
                    pendingSmsRecipient = null
                    pendingSmsBodyDraft = null
                    queuePendingAction(
                        PendingAction(
                            kind = PendingActionKind.SMS_DRAFT,
                            summary = getString(R.string.sms_draft_summary, recipient.displayName),
                            detail = approvedBody,
                            targetName = recipient.displayName,
                            targetValue = recipient.value,
                            body = approvedBody,
                        )
                    )
                }
                true
            }
            "no", "no that's wrong", "say it again", "try again", "start over", "rewrite that" -> {
                pendingSmsBodyDraft = null
                val reply = getString(R.string.ask_what_to_text, recipient.displayName)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            else -> {
                pendingSmsBodyDraft = trimmed
                val reply = getString(R.string.sms_dictation_confirmation, recipient.displayName, trimmed)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
        }
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
            PendingActionKind.SMS_DRAFT -> sendSmsDirect(action)
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

    private fun sendSmsDirect(action: PendingAction) {
        val number = action.targetValue ?: return
        val body = action.body.orEmpty()
        if (body.isBlank()) {
            openSmsDraft(action)
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            val reply = getString(R.string.sms_send_permission_missing)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            openSmsDraft(action)
            return
        }
        runCatching {
            @Suppress("DEPRECATION")
            val smsManager = SmsManager.getDefault()
            smsManager.sendTextMessage(number, null, body, null, null)
        }.onSuccess {
            pendingAction = null
            updatePendingActionUi()
            val reply = getString(R.string.sms_sent_directly, action.targetName ?: "your contact")
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        }.onFailure {
            val reply = getString(R.string.sms_send_failed, action.targetName ?: "your contact")
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            openSmsDraft(action)
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

    private fun findExactPhoneContactByName(name: String): ContactMatch? {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            return null
        }
        val cursor = contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            ),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} = ? COLLATE NOCASE",
            arrayOf(name),
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
        const val KEY_USER_ROLE = "user_role"
        const val KEY_USER_NAME = "user_name"
        const val KEY_ACCESS_TYPE = "access_type"
        const val KEY_AFFILIATE_INVITE_CODE = "affiliate_invite_code"
        const val KEY_BACKGROUND_SERVICE_ENABLED = "background_service_enabled"
        const val KEY_AUTO_START_ASSISTANT = "auto_start_assistant"
        const val KEY_PHONE_BACKEND_ENABLED = "phone_backend_enabled"
        const val KEY_APP_IN_FOREGROUND = "app_in_foreground"
        const val KEY_LEARNING_REMINDER_ENABLED = "learning_reminder_enabled"
        const val KEY_LEARNING_REMINDER_TIME = "learning_reminder_time"
        const val KEY_LEARNING_REMINDER_TITLE = "learning_reminder_title"
        const val KEY_LEARNING_REMINDER_TEXT = "learning_reminder_text"
        const val KEY_THEME_PRESET = "theme_preset"
        const val KEY_HOME_TITLE = "home_title"
        const val KEY_HOME_SUBTITLE = "home_subtitle"
        const val KEY_ACCENT_COLOR = "accent_color"
        const val KEY_BACKGROUND_COLOR = "background_color"
        const val KEY_PANEL_COLOR = "panel_color"
        const val KEY_HOME_BACKGROUND_URI = "home_background_uri"
        const val KEY_HOME_LEFT_STICKER_URI = "home_left_sticker_uri"
        const val KEY_HOME_RIGHT_STICKER_URI = "home_right_sticker_uri"
        const val KEY_DASHBOARD_SECTIONS = "dashboard_sections"
        const val DEFAULT_SERVER_URL = "https://konvict-artz.onrender.com/api"
        private const val DEFAULT_ACCENT_COLOR = "#69C6FF"
        private const val DEFAULT_BACKGROUND_COLOR = "#0F172A"
        private const val DEFAULT_PANEL_COLOR = "#182131"
        private const val MAX_DASHBOARD_SECTIONS = 8
        private const val THEME_OCEAN = "ocean"
        private const val THEME_SUNSET = "sunset"
        private const val THEME_STUDIO = "studio"
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
