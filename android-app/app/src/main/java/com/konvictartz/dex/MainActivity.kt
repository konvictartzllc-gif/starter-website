package com.konvictartz.dex

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
import android.provider.MediaStore
import android.provider.Settings
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.telecom.TelecomManager
import android.telephony.SmsManager
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Toast
import android.widget.TextView
import android.animation.ArgbEvaluator
import android.animation.Animator
import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.PopupMenu
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import androidx.core.widget.doAfterTextChanged
import androidx.lifecycle.lifecycleScope
import com.google.android.material.card.MaterialCardView
import com.google.android.material.button.MaterialButton
import com.google.android.material.switchmaterial.SwitchMaterial
import com.google.android.material.textfield.TextInputLayout
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
import android.graphics.Typeface
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

private enum class HintTone {
    NEXT_STEP,
    READY,
    HEALTHY,
}

private data class DashboardMotionProfile(
    val pulseDurationMs: Long,
    val pulseStartAlpha: Float,
    val pulseStartScale: Float,
    val loadingDurationMs: Long,
    val loadingMinAlpha: Float,
    val loadingStartOffsetMs: Long,
    val statusLiftDp: Float,
)

private enum class DecorationPickTarget {
    BACKGROUND,
    LEFT_STICKER,
    RIGHT_STICKER,
}

private enum class DexSpeechProfile {
    CONVERSATION,
    SAFETY,
    CRISIS,
    TEACHING,
    PRONUNCIATION,
}

private enum class ReminderContactDisambiguationMode {
    CALL,
    TEXT,
}

private enum class DexCompanionContext {
    GENERAL,
    TEXT,
    CALL,
    LESSON,
    SAFETY,
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

private data class ScoredContactMatch(
    val contact: ContactMatch,
    val score: Int,
)

private data class DirectCallRequest(
    val displayName: String,
    val phoneNumber: String,
)

data class SavedCallMessage(
    val callerLabel: String,
    val phoneNumber: String?,
    val message: String,
    val timeLabel: String,
    val handled: Boolean = false,
)

private data class DashboardSection(
    val title: String,
    val body: String,
)

private data class QuizQuestion(
    val question: String,
    val answer: String,
    val explanation: String,
)

private data class QuizSession(
    val quiz: JSONObject,
    val title: String,
    val questions: List<QuizQuestion>,
    val answers: MutableList<String> = mutableListOf(),
    var currentIndex: Int = 0,
)

private data class SpeechChunk(
    val text: String,
    val profile: DexSpeechProfile,
    val pauseAfterMs: Long = 450L,
)

private enum class PendingContactAction {
    CALL,
    TEXT,
    EMAIL,
}

private enum class DexMiniGameType {
    NONE,
    GUESS_NUMBER,
    RIDDLE,
    TRIVIA,
    MEMORY,
    WOULD_YOU_RATHER,
}

private data class DexRiddle(
    val prompt: String,
    val answer: String,
)

private data class DexWouldYouRather(
    val prompt: String,
    val followUp: String,
)

private data class DexTrivia(
    val prompt: String,
    val answers: List<String>,
    val reveal: String,
)

private data class DexChallengeReward(
    val reply: String,
    val bubble: String? = null,
)

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
    private var callStateCallback: DexCallStateCallback? = null
    @Suppress("DEPRECATION")
    private var legacyPhoneStateListener: LegacyCallStateListener? = null
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
    private var wakeSpeechRecognizer: SpeechRecognizer? = null
    private var wakeWordEngine: DexWakeWordEngine? = null
    private var wakeWordEngineActive = false
    private var isListeningForCallCommand = false
    private var shouldResumeCallListeningAfterSpeech = false
    private var wakeModeEnabled = false
    private var awaitingWakeCommand = false
    private var conversationActive = false
    private var isListeningForDexCommand = false
    private var resumeWakeListeningAfterSpeech = false
    private var resumeCommandCaptureAfterWakePrompt = false
    private var pendingAction: PendingAction? = null
    private var autoWakeStarted = false
    private var relationshipAliases: Map<String, String> = emptyMap()
    private var lastWakeListenStartedAt = 0L
    private var pendingContactTarget: ContactMatch? = null
    private var pendingContactAction: PendingContactAction? = null
    private var pendingDetectedContactPhrase: String? = null
    private var pendingSmsRecipient: ContactMatch? = null
    private var pendingSmsBodyDraft: String? = null
    private var pendingReminderSmsTriggerAt: LocalDateTime? = null
    private var pendingReminderSmsTarget: ContactMatch? = null
    private var pendingReminderSmsBody: String? = null
    private var awaitingReminderSmsContact = false
    private var pendingReminderCallTriggerAt: LocalDateTime? = null
    private var awaitingReminderCallContact = false
    private var pendingReminderCallTargetName: String? = null
    private var recentCallReminderTargetName: String? = null
    private var recentCallReminderScheduledAt = 0L
    private var pendingReminderContactChoices: List<ContactMatch> = emptyList()
    private var pendingReminderContactDisambiguationMode: ReminderContactDisambiguationMode? = null
    private var pendingIncomingSmsSender: String? = null
    private var pendingIncomingSmsValue: String? = null
    private var pendingIncomingSmsBody: String? = null
    private var pendingIncomingSmsReplyChoice = false
    private var pendingNotificationApp: String? = null
    private var pendingNotificationTitle: String? = null
    private var pendingNotificationText: String? = null
    private var pendingNotificationReplyChoice = false
    private var currentThemePreset: String = THEME_STUDIO
    private var currentAccentColor: String = DEFAULT_ACCENT_COLOR
    private var currentBackgroundColor: String = DEFAULT_BACKGROUND_COLOR
    private var currentPanelColor: String = DEFAULT_PANEL_COLOR
    private var isAdvancedStyleVisible = false
    private var currentBackgroundImageUri: String? = null
    private var currentLeftStickerUri: String? = null
    private var currentRightStickerUri: String? = null
    private var currentDexCompanionVisible = true
    private var currentDexCompanionMood: String = DEX_COMPANION_MOOD_CALM
    private var currentDexCompanionSize: String = DEX_COMPANION_SIZE_MEDIUM
    private var currentDexCompanionSide: String = DEX_COMPANION_SIDE_RIGHT
    private var currentDexCompanionFaceStyle: String = DEX_COMPANION_FACE_CLASSIC
    private var currentDexCompanionBubbleStyle: String = DEX_COMPANION_BUBBLE_SOFT
    private var currentDexCompanionSkin: String = DEX_COMPANION_SKIN_SKY
    private var currentDexCompanionAccessory: String = DEX_COMPANION_ACCESSORY_NONE
    private var currentDexCompanionName: String = "Dex"
    private var currentDexCompanionVoice: String = DEX_COMPANION_VOICE_SUPPORTIVE
    private var currentDexCompanionPersonality: String = DEX_COMPANION_PERSONALITY_COACH
    private var dexCompanionIntroDismissed = false
    private var dexCompanionIntroGreeted = false
    private var currentDexCompanionOffsetX = 0f
    private var currentDexCompanionOffsetY = 0f
    private var currentDexCompanionTierStyleOverride: Int? = null
    private var dexCompanionState: String = DEX_COMPANION_STATE_IDLE
    private var dexCompanionBubbleOverride: String? = null
    private var dexCompanionRewardsPreviewLevel: Int? = null
    private var dexCompanionRecentUnlockLevel: Int? = null
    private var dexCompanionRewardsLastTapAt = 0L
    private var dexCompanionFloatAnimator: AnimatorSet? = null
    private var dexCompanionEventAnimator: AnimatorSet? = null
    private var advancedDeviceAccessStatusView: TextView? = null
    private var dexCompanionBlinkScheduled = false
    private var dexCompanionDragDownRawX = 0f
    private var dexCompanionDragDownRawY = 0f
    private var dexCompanionDragStartX = 0f
    private var dexCompanionDragStartY = 0f
    private var dexCompanionDraggedDuringTouch = false
    private var dexCompanionLastTapAt = 0L
    private var dexCompanionLongPressTriggered = false
    private var pendingDecorationPickTarget: DecorationPickTarget? = null
    private var currentTrialDaysLeft: Int? = null
    private var hasBillingCustomer = false
    private val dashboardSections = mutableListOf<DashboardSection>()
    private var pendingSpeechCompletion: (() -> Unit)? = null
    private var finalSpeechUtteranceId: String? = null
    private var activeQuizSession: QuizSession? = null
    private var listeningForQuizAnswer = false
    private var restoreWakeEngineAfterQuiz = false
    private var dexChatInFlight = false
    private var lastDexChatMessage = ""
    private var lastDexChatSentAt = 0L
    private var lastLocalEmergencySmsSentAt = 0L
    private var lastDexSpokenText = ""
    private var lastDexSpokenAt = 0L
    private var lastEmergencyTriggerReason = ""
    private var lastEmergencySmsStatus = ""
    private val activityLogEntries = ArrayDeque<String>()
    private var showUnhandledCallerMessagesOnly = true
    private val animatedDashboardCards = mutableSetOf<Int>()
    private var activeDexMiniGame = DexMiniGameType.NONE
    private var dexGuessTarget = 0
    private var dexGuessAttempts = 0
    private var currentRiddleIndex = -1
    private var currentTriviaIndex = -1
    private var currentMemoryRound = 0
    private var currentMemorySequence: List<String> = emptyList()
    private var currentWouldYouRatherIndex = -1
    private var dexGamesPlayed = 0
    private var dexGamesCorrect = 0
    private var dexGamesCurrentStreak = 0
    private var dexGamesBestStreak = 0
    private var dexGuessPlays = 0
    private var dexRiddlePlays = 0
    private var dexTriviaPlays = 0
    private var dexMemoryPlays = 0
    private var dexWouldYouRatherPlays = 0
    private var dexGamesChallengeCompletedDate = ""
    private var dexGamesChallengeClears = 0
    private var dexCoins = 12
    private var ownedDexCosmetics = mutableSetOf<String>()

    private val resetWakeWindowRunnable = Runnable {
        awaitingWakeCommand = false
        conversationActive = false
        if (wakeModeEnabled) {
            binding.conversationStatus.text = getString(R.string.wake_mode_session_ended)
            if (!wakeWordEngineActive) {
                scheduleWakeListeningRestart()
            }
        }
    }

    private val restartWakeListeningRunnable = Runnable {
        if (wakeModeEnabled && !isListeningForCallCommand && lastCallState != TelephonyManager.CALL_STATE_RINGING) {
            if (awaitingWakeCommand || conversationActive) {
                startDexCommandListening()
            } else if (!wakeWordEngineActive) {
                startWakeWordListening()
            }
        }
    }

    private val dexCompanionBlinkRunnable = Runnable {
        dexCompanionBlinkScheduled = false
        if (binding.dexCompanionCard.visibility != View.VISIBLE) return@Runnable
        blinkDexCompanion()
        scheduleDexCompanionBlink()
    }

    private val dexCompanionStateResetRunnable = Runnable {
        dexCompanionBubbleOverride = null
        dexCompanionState = deriveDexCompanionState()
        applyDexCompanionUi()
    }

    private val dexCompanionRecentUnlockResetRunnable = Runnable {
        dexCompanionRecentUnlockLevel = null
        refreshDexCompanionRewardsPanel(unlockCelebration = false)
    }

    private val dexCompanionRewardsSingleTapRunnable = Runnable {
        dexCompanionRewardsLastTapAt = 0L
        cycleDexCompanionRewardsPreview()
    }

    private val dexCompanionSingleTapRunnable = Runnable {
        dexCompanionLastTapAt = 0L
        handleDexCompanionTap()
    }

    private val dexCompanionLongPressRunnable = Runnable {
        if (!dexCompanionDraggedDuringTouch) {
            dexCompanionLongPressTriggered = true
            dexCompanionLastTapAt = 0L
            handleDexCompanionLongPress()
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

    private inner class DexCallStateCallback : TelephonyCallback(), TelephonyCallback.CallStateListener {
        override fun onCallStateChanged(state: Int) {
            handleCallStateChanged(state, null)
        }
    }

    @Suppress("DEPRECATION")
    private inner class LegacyCallStateListener : android.telephony.PhoneStateListener() {
        @Deprecated("Deprecated in Java")
        override fun onCallStateChanged(state: Int, phoneNumber: String?) {
            super.onCallStateChanged(state, phoneNumber)
            handleCallStateChanged(state, phoneNumber)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        telecomManager = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
        textToSpeech = TextToSpeech(this, this)
        textToSpeech?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {
                runOnUiThread {
                    setDexCompanionState(DEX_COMPANION_STATE_TALKING)
                }
            }

            override fun onDone(utteranceId: String?) {
                runOnUiThread {
                    if (utteranceId != null && utteranceId == finalSpeechUtteranceId) {
                        finalSpeechUtteranceId = null
                        val callback = pendingSpeechCompletion
                        pendingSpeechCompletion = null
                        callback?.invoke()
                    }
                    if (resumeCommandCaptureAfterWakePrompt && wakeModeEnabled) {
                        resumeCommandCaptureAfterWakePrompt = false
                        startDexCommandListening()
                    }
                    if (resumeWakeListeningAfterSpeech && wakeModeEnabled) {
                        keepWakeConversationOpenAfterSpeech()
                        resumeWakeListeningAfterSpeech = false
                        scheduleWakeListeningRestart(900)
                    }
                    if (shouldResumeCallListeningAfterSpeech && lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                        shouldResumeCallListeningAfterSpeech = false
                        mainHandler.postDelayed({ startListeningForCallCommand() }, CALL_COMMAND_PROMPT_GUARD_DELAY_MS)
                    }
                    restoreDexCompanionState()
                }
            }

            @Suppress("OVERRIDE_DEPRECATION")
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                runOnUiThread {
                    if (utteranceId != null && utteranceId == finalSpeechUtteranceId) {
                        finalSpeechUtteranceId = null
                        val callback = pendingSpeechCompletion
                        pendingSpeechCompletion = null
                        callback?.invoke()
                    }
                    if (resumeCommandCaptureAfterWakePrompt && wakeModeEnabled) {
                        resumeCommandCaptureAfterWakePrompt = false
                        startDexCommandListening()
                    }
                    if (resumeWakeListeningAfterSpeech && wakeModeEnabled) {
                        keepWakeConversationOpenAfterSpeech()
                        resumeWakeListeningAfterSpeech = false
                        scheduleWakeListeningRestart(900)
                    }
                    if (shouldResumeCallListeningAfterSpeech && lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                        shouldResumeCallListeningAfterSpeech = false
                        mainHandler.postDelayed({ startListeningForCallCommand() }, CALL_COMMAND_PROMPT_GUARD_DELAY_MS)
                    }
                    restoreDexCompanionState()
                }
            }
        })
        setupSpeechRecognizers()
        wakeWordEngine = DexWakeWordEngine(
            this,
            onWakeWordDetected = {
                runOnUiThread { handleWakeWordEngineDetection() }
            },
            onWakeWordError = { message ->
                runOnUiThread { handleWakeWordEngineFailure(message) }
            }
        )

        loadStoredState()
        ensureDefaultWakeWordSetup()
        clearStaleBackgroundState()
        setupUi()
        updateAndroidPermissionStatus()
        refreshLoggedInState()
        if (!authToken.isNullOrBlank()) {
            fetchCurrentUserProfile()
            fetchPermissions()
            fetchLearningReminderPreferences()
            fetchSafetyPreferences()
            fetchRelationshipAliases()
        }
        handleAssistantEntryIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAssistantEntryIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        clearStaleBackgroundState()
        refreshActivityLogFromPrefs()
        refreshCallMessageLogFromPrefs()
        updateAndroidPermissionStatus()
        refreshCallMonitorState()
        autoStartWakeModeIfReady()
        applyDexCompanionUi()
        if (!authToken.isNullOrBlank()) {
            fetchLearningReminderPreferences()
            fetchSafetyPreferences()
            fetchRelationshipAliases()
        }
    }

    override fun onStart() {
        super.onStart()
        setAppForegroundState(true)
        refreshCallMonitorState()
        maintainBackgroundService()
    }

    override fun onStop() {
        setAppForegroundState(false)
        stopCallMonitoring()
        stopListeningForCallCommand()
        updateCallActionVisibility(false)
        mainHandler.removeCallbacks(dexCompanionSingleTapRunnable)
        mainHandler.removeCallbacks(dexCompanionLongPressRunnable)
        mainHandler.removeCallbacks(dexCompanionStateResetRunnable)
        stopDexCompanionAnimation()
        maintainBackgroundService()
        super.onStop()
    }

    override fun onDestroy() {
        stopCallMonitoring()
        stopListeningForCallCommand()
        wakeModeEnabled = false
        awaitingWakeCommand = false
        resumeWakeListeningAfterSpeech = false
        resumeCommandCaptureAfterWakePrompt = false
        mainHandler.removeCallbacks(resetWakeWindowRunnable)
        mainHandler.removeCallbacks(restartWakeListeningRunnable)
        mainHandler.removeCallbacks(dexCompanionBlinkRunnable)
        mainHandler.removeCallbacks(dexCompanionSingleTapRunnable)
        mainHandler.removeCallbacks(dexCompanionLongPressRunnable)
        mainHandler.removeCallbacks(dexCompanionStateResetRunnable)
        stopDexCompanionAnimation()
        wakeWordEngine?.stop()
        wakeSpeechRecognizer?.destroy()
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
        applyTtsProfile(DexSpeechProfile.CONVERSATION)

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

    private fun setupSpeechRecognizers() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return
        wakeSpeechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    if (wakeModeEnabled && !awaitingWakeCommand && !conversationActive) {
                        binding.conversationStatus.text = getString(R.string.wake_mode_waiting)
                    }
                }

                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit

                override fun onError(error: Int) {
                    if (wakeModeEnabled) {
                        handleWakeRecognitionError(error)
                    }
                }

                override fun onResults(results: Bundle?) {
                    if (wakeModeEnabled) {
                        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                        handleWakeRecognitionMatches(matches)
                    }
                }
            })
        }
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    when {
                        isListeningForCallCommand -> binding.callMonitorStatus.text = getString(R.string.call_listening)
                        listeningForQuizAnswer -> binding.learningQuizPreview.append("\n\nListening for your answer...")
                        isListeningForDexCommand -> binding.conversationStatus.text = getString(R.string.wake_mode_command_ready)
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
                    } else if (listeningForQuizAnswer) {
                        listeningForQuizAnswer = false
                        when (error) {
                            SpeechRecognizer.ERROR_NO_MATCH,
                            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> repeatCurrentQuizQuestion()
                            else -> {
                                binding.learningQuizPreview.append("\n\nI missed that answer, so let's try that question again.")
                                repeatCurrentQuizQuestion()
                            }
                        }
                    } else if (isListeningForDexCommand) {
                        isListeningForDexCommand = false
                        if (wakeModeEnabled) {
                            handleWakeRecognitionError(error)
                        }
                    }
                }

                override fun onResults(results: Bundle?) {
                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                    if (isListeningForCallCommand) {
                        isListeningForCallCommand = false
                        val action = matches
                            .asSequence()
                            .map { it.trim().lowercase(Locale.US) }
                            .firstNotNullOfOrNull { parseCallVoiceAction(it) }
                        when {
                            action == CallVoiceAction.ANSWER -> takeMessageForCurrentCaller()
                            action == CallVoiceAction.ANSWER_ON_SPEAKER -> {
                                enableSpeakerAfterAnswer = true
                                answerRingingCall()
                            }
                            action == CallVoiceAction.DECLINE -> declineRingingCall()
                            action == CallVoiceAction.TAKE_MESSAGE -> takeMessageForCurrentCaller()
                            lastCallState == TelephonyManager.CALL_STATE_RINGING -> {
                                binding.callMonitorStatus.text = getString(R.string.call_command_retry_prompt)
                                speakDex(
                                    getString(R.string.call_command_retry_prompt),
                                    R.string.voice_speaking,
                                    resumeWakeModeAfterSpeech = false
                                )
                                mainHandler.postDelayed({ startListeningForCallCommand() }, CALL_COMMAND_RETRY_DELAY_MS)
                            }
                        }
                    } else if (listeningForQuizAnswer) {
                        listeningForQuizAnswer = false
                        val transcript = matches.firstOrNull()?.trim().orEmpty().lowercase(Locale.US)
                        handleQuizAnswerTranscript(transcript)
                    } else if (isListeningForDexCommand && wakeModeEnabled) {
                        isListeningForDexCommand = false
                        handleWakeRecognitionMatches(matches)
                    }
                }
            })
        }
    }

    private fun setupUi() {
        installAdvancedDeviceAccessControls()
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
        binding.openAppSettingsButton.setOnClickListener {
            openAppSettings()
        }
        binding.openBatterySettingsButton.setOnClickListener {
            openBatterySettings()
        }
        binding.openNotificationSettingsButton.setOnClickListener {
            openNotificationSettings()
        }
        binding.openNotificationAccessButton.setOnClickListener {
            openNotificationAccessSettings()
        }

        binding.testVoiceButton.setOnClickListener {
            speakDex(getString(R.string.voice_test_phrase))
        }

        binding.setupVoiceButton.setOnClickListener {
            openVoiceSetup()
        }

        binding.setupWakeWordButton.setOnClickListener {
            showWakeWordSetupDialog()
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
            takeMessageForCurrentCaller()
        }

        binding.declineCallButton.setOnClickListener {
            declineRingingCall()
        }
        binding.callMessageActionButton.setOnClickListener {
            showSavedCallerMessageActions()
        }
        binding.callMessageActionButton.setOnLongClickListener {
            markAllSavedCallerMessagesHandled()
            true
        }
        binding.callMessageLogValue.setOnClickListener {
            showSavedCallerMessagePicker()
        }
        (binding.callMessageLogValue.parent as? View)?.setOnLongClickListener {
            toggleCallerMessageFilter()
            true
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
        binding.autoAnswerKnownContactsSwitch.setOnCheckedChangeListener { _, isChecked ->
            if (!binding.autoAnswerKnownContactsSwitch.isPressed) return@setOnCheckedChangeListener
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_AUTO_ANSWER_KNOWN_CONTACTS, isChecked)
                .apply()
            updatePermissions("phone", binding.phonePermissionSwitch.isChecked)
            maintainBackgroundService()
        }
        binding.autoAnswerAnyCallerSwitch.setOnCheckedChangeListener { _, isChecked ->
            if (!binding.autoAnswerAnyCallerSwitch.isPressed) return@setOnCheckedChangeListener
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_AUTO_ANSWER_ANY_NON_SPAM, isChecked)
                .apply()
            updatePermissions("phone", binding.phonePermissionSwitch.isChecked)
            maintainBackgroundService()
        }
        binding.autoDeclineSpamSwitch.setOnCheckedChangeListener { _, isChecked ->
            if (!binding.autoDeclineSpamSwitch.isPressed) return@setOnCheckedChangeListener
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_AUTO_DECLINE_SPAM, isChecked)
                .apply()
            updatePermissions("phone", binding.phonePermissionSwitch.isChecked)
            maintainBackgroundService()
        }

        binding.adminGenerateInviteButton.setOnClickListener {
            createAdminAffiliateInvite()
        }

        binding.saveLearningProfileButton.setOnClickListener {
            saveLearningProfile()
        }

        binding.saveSafetyProfileButton.setOnClickListener {
            saveSafetyProfile()
        }
        binding.testSafetyCheckInButton.setOnClickListener {
            testSafetyCheckIn()
        }
        binding.previewEmergencyPlanButton.setOnClickListener {
            previewEmergencyPlan()
        }
        binding.testEmergencySmsButton.setOnClickListener {
            testEmergencySms()
        }
        binding.saveAliasButton.setOnClickListener {
            saveLocalRelationshipAlias()
        }
        binding.clearAliasesButton.setOnClickListener {
            clearLocalRelationshipAliases()
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

        binding.startGuessNumberButton.setOnClickListener {
            startGuessNumberGame()
        }

        binding.startRiddleButton.setOnClickListener {
            startRiddleGame()
        }

        binding.startTriviaButton.setOnClickListener {
            startTriviaGame()
        }

        binding.startMemoryGameButton.setOnClickListener {
            startMemoryGame()
        }

        binding.startWouldYouRatherButton.setOnClickListener {
            startWouldYouRatherGame()
        }

        binding.submitDexGameAnswerButton.setOnClickListener {
            submitDexGameAnswer()
        }

        binding.nextDexGameRoundButton.setOnClickListener {
            playNextDexMiniGameRound()
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
        binding.dexCompanionVisibleSwitch.setOnCheckedChangeListener { _, isChecked ->
            currentDexCompanionVisible = isChecked
            applyDexCompanionUi()
            persistHomeLook()
        }
        binding.dexCompanionIntroDismissButton.setOnClickListener {
            dexCompanionIntroDismissed = true
            updateDexCompanionIntroUi()
            persistHomeLook()
        }
        binding.dexCompanionNameInput.doAfterTextChanged {
            currentDexCompanionName = it?.toString()?.trim().orEmpty().ifBlank { "Dex" }
            applyDexCompanionUi()
            persistHomeLook()
        }
        binding.dexCompanionPersonalityToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            currentDexCompanionPersonality = when (checkedId) {
                R.id.dexCompanionPersonalityBestieButton -> DEX_COMPANION_PERSONALITY_BESTIE
                R.id.dexCompanionPersonalityGuardianButton -> DEX_COMPANION_PERSONALITY_GUARDIAN
                R.id.dexCompanionPersonalityStudyBuddyButton -> DEX_COMPANION_PERSONALITY_STUDY_BUDDY
                else -> DEX_COMPANION_PERSONALITY_COACH
            }
            applyDexCompanionPersonalityPreset()
            updateDexCompanionControls()
            applyDexCompanionUi()
            persistHomeLook()
        }
        binding.dexCompanionMoodToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            currentDexCompanionMood = when (checkedId) {
                R.id.dexCompanionMoodPlayfulButton -> DEX_COMPANION_MOOD_PLAYFUL
                R.id.dexCompanionMoodFocusButton -> DEX_COMPANION_MOOD_FOCUS
                else -> DEX_COMPANION_MOOD_CALM
            }
            applyDexCompanionUi()
            persistHomeLook()
        }
        binding.dexCompanionSizeToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            currentDexCompanionSize = when (checkedId) {
                R.id.dexCompanionSizeSmallButton -> DEX_COMPANION_SIZE_SMALL
                R.id.dexCompanionSizeLargeButton -> DEX_COMPANION_SIZE_LARGE
                else -> DEX_COMPANION_SIZE_MEDIUM
            }
            applyDexCompanionUi()
            persistHomeLook()
        }
        binding.dexCompanionSideToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            currentDexCompanionSide = when (checkedId) {
                R.id.dexCompanionSideLeftButton -> DEX_COMPANION_SIDE_LEFT
                else -> DEX_COMPANION_SIDE_RIGHT
            }
            currentDexCompanionOffsetX = 0f
            currentDexCompanionOffsetY = 0f
            applyDexCompanionUi()
            persistHomeLook()
        }
        binding.dexCompanionFaceStyleToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            val faceStyle = when (checkedId) {
                R.id.dexCompanionFaceStyleWinkButton -> DEX_COMPANION_FACE_WINK
                R.id.dexCompanionFaceStylePixelButton -> DEX_COMPANION_FACE_PIXEL
                else -> DEX_COMPANION_FACE_CLASSIC
            }
            if (!ensureDexCosmeticOwned(faceStyleCosmeticKey(faceStyle), dexFaceStyleLabel(faceStyle), dexFaceStyleCost(faceStyle))) {
                updateDexCompanionControls()
                return@addOnButtonCheckedListener
            }
            currentDexCompanionFaceStyle = faceStyle
            applyDexCompanionUi()
            persistHomeLook()
        }
        binding.dexCompanionBubbleStyleToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            val bubbleStyle = when (checkedId) {
                R.id.dexCompanionBubbleStyleGlowButton -> DEX_COMPANION_BUBBLE_GLOW
                R.id.dexCompanionBubbleStyleBoldButton -> DEX_COMPANION_BUBBLE_BOLD
                else -> DEX_COMPANION_BUBBLE_SOFT
            }
            if (!ensureDexCosmeticOwned(bubbleStyleCosmeticKey(bubbleStyle), dexBubbleStyleLabel(bubbleStyle), dexBubbleStyleCost(bubbleStyle))) {
                updateDexCompanionControls()
                return@addOnButtonCheckedListener
            }
            currentDexCompanionBubbleStyle = bubbleStyle
            applyDexCompanionUi()
            persistHomeLook()
        }
        binding.dexCompanionSkinToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            val skin = when (checkedId) {
                R.id.dexCompanionSkinMintButton -> DEX_COMPANION_SKIN_MINT
                R.id.dexCompanionSkinSunsetButton -> DEX_COMPANION_SKIN_SUNSET
                R.id.dexCompanionSkinVioletButton -> DEX_COMPANION_SKIN_VIOLET
                else -> DEX_COMPANION_SKIN_SKY
            }
            if (!ensureDexCosmeticOwned(skinCosmeticKey(skin), dexSkinLabel(skin), dexSkinCost(skin))) {
                updateDexCompanionControls()
                return@addOnButtonCheckedListener
            }
            currentDexCompanionSkin = skin
            applyDexCompanionUi()
            persistHomeLook()
        }
        binding.dexCompanionAccessoryToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            val accessory = when (checkedId) {
                R.id.dexCompanionAccessoryHeadphonesButton -> DEX_COMPANION_ACCESSORY_HEADPHONES
                R.id.dexCompanionAccessoryGlassesButton -> DEX_COMPANION_ACCESSORY_GLASSES
                R.id.dexCompanionAccessoryHaloButton -> DEX_COMPANION_ACCESSORY_HALO
                else -> DEX_COMPANION_ACCESSORY_NONE
            }
            if (!ensureDexCosmeticOwned(accessoryCosmeticKey(accessory), dexAccessoryLabel(accessory), dexAccessoryCost(accessory))) {
                updateDexCompanionControls()
                return@addOnButtonCheckedListener
            }
            currentDexCompanionAccessory = accessory
            applyDexCompanionUi()
            persistHomeLook()
        }
        binding.dexCompanionVoiceToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (!isChecked) return@addOnButtonCheckedListener
            currentDexCompanionVoice = when (checkedId) {
                R.id.dexCompanionVoicePlayfulButton -> DEX_COMPANION_VOICE_PLAYFUL
                R.id.dexCompanionVoiceDirectButton -> DEX_COMPANION_VOICE_DIRECT
                else -> DEX_COMPANION_VOICE_SUPPORTIVE
            }
            applyDexCompanionUi()
            persistHomeLook()
        }
        binding.dexCompanionRewardsValue.setOnClickListener {
            val now = SystemClock.elapsedRealtime()
            if (now - dexCompanionRewardsLastTapAt <= DEX_COMPANION_DOUBLE_TAP_WINDOW_MS) {
                mainHandler.removeCallbacks(dexCompanionRewardsSingleTapRunnable)
                dexCompanionRewardsLastTapAt = 0L
                openDexShopDialog()
            } else {
                dexCompanionRewardsLastTapAt = now
                mainHandler.postDelayed(
                    dexCompanionRewardsSingleTapRunnable,
                    DEX_COMPANION_DOUBLE_TAP_WINDOW_MS
                )
            }
        }
        binding.dexCompanionRewardsValue.setOnLongClickListener {
            pinDexCompanionRewardsLook()
            true
        }
        binding.dexCompanionCard.setOnTouchListener { view, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    dexCompanionDragDownRawX = event.rawX
                    dexCompanionDragDownRawY = event.rawY
                    dexCompanionDragStartX = currentDexCompanionOffsetX
                    dexCompanionDragStartY = currentDexCompanionOffsetY
                    dexCompanionDraggedDuringTouch = false
                    dexCompanionLongPressTriggered = false
                    mainHandler.removeCallbacks(dexCompanionLongPressRunnable)
                    mainHandler.postDelayed(dexCompanionLongPressRunnable, DEX_COMPANION_LONG_PRESS_MS)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val deltaX = event.rawX - dexCompanionDragDownRawX
                    val deltaY = event.rawY - dexCompanionDragDownRawY
                    if (!dexCompanionDraggedDuringTouch && (kotlin.math.abs(deltaX) > dpToPx(6) || kotlin.math.abs(deltaY) > dpToPx(6))) {
                        dexCompanionDraggedDuringTouch = true
                        mainHandler.removeCallbacks(dexCompanionLongPressRunnable)
                    }
                    if (dexCompanionDraggedDuringTouch) {
                        currentDexCompanionOffsetX = dexCompanionDragStartX + deltaX
                        currentDexCompanionOffsetY = dexCompanionDragStartY + deltaY
                        applyDexCompanionDragPosition()
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    mainHandler.removeCallbacks(dexCompanionLongPressRunnable)
                    if (dexCompanionDraggedDuringTouch) {
                        applyDexCompanionDragPosition()
                        persistHomeLook()
                    } else if (dexCompanionLongPressTriggered) {
                        dexCompanionLongPressTriggered = false
                    } else {
                        val now = SystemClock.elapsedRealtime()
                        if (now - dexCompanionLastTapAt <= DEX_COMPANION_DOUBLE_TAP_WINDOW_MS) {
                            mainHandler.removeCallbacks(dexCompanionSingleTapRunnable)
                            dexCompanionLastTapAt = 0L
                            handleDexCompanionDoubleTap()
                        } else {
                            dexCompanionLastTapAt = now
                            mainHandler.postDelayed(dexCompanionSingleTapRunnable, DEX_COMPANION_DOUBLE_TAP_WINDOW_MS)
                        }
                    }
                    dexCompanionDraggedDuringTouch = false
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    mainHandler.removeCallbacks(dexCompanionLongPressRunnable)
                    if (dexCompanionDraggedDuringTouch) {
                        applyDexCompanionDragPosition()
                        persistHomeLook()
                    }
                    dexCompanionDraggedDuringTouch = false
                    dexCompanionLongPressTriggered = false
                    true
                }
                else -> false
            }
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
        phoneBackendEnabled = prefs.getBoolean(KEY_PHONE_BACKEND_ENABLED, false)
        binding.emailInput.setText(prefs.getString(KEY_EMAIL, ""))
        binding.affiliateInviteInput.setText(prefs.getString(KEY_AFFILIATE_INVITE_CODE, ""))
        binding.notificationsPermissionSwitch.isChecked = prefs.getBoolean(KEY_NOTIFICATIONS_ENABLED, false)
        binding.autoAnswerKnownContactsSwitch.isChecked = prefs.getBoolean(KEY_AUTO_ANSWER_KNOWN_CONTACTS, false)
        binding.autoAnswerAnyCallerSwitch.isChecked = prefs.getBoolean(KEY_AUTO_ANSWER_ANY_NON_SPAM, false)
        binding.autoDeclineSpamSwitch.isChecked = prefs.getBoolean(KEY_AUTO_DECLINE_SPAM, true)
        pendingIncomingSmsSender = prefs.getString(KEY_PENDING_INCOMING_SMS_SENDER, null)
        pendingIncomingSmsValue = prefs.getString(KEY_PENDING_INCOMING_SMS_VALUE, null)
        pendingIncomingSmsBody = prefs.getString(KEY_PENDING_INCOMING_SMS_BODY, null)
        pendingNotificationApp = prefs.getString(KEY_PENDING_NOTIFICATION_APP, null)
        pendingNotificationTitle = prefs.getString(KEY_PENDING_NOTIFICATION_TITLE, null)
        pendingNotificationText = prefs.getString(KEY_PENDING_NOTIFICATION_TEXT, null)
        binding.homeTitleInput.setText(prefs.getString(KEY_HOME_TITLE, ""))
        binding.homeSubtitleInput.setText(prefs.getString(KEY_HOME_SUBTITLE, ""))
        currentBackgroundImageUri = prefs.getString(KEY_HOME_BACKGROUND_URI, null)
        currentLeftStickerUri = prefs.getString(KEY_HOME_LEFT_STICKER_URI, null)
        currentRightStickerUri = prefs.getString(KEY_HOME_RIGHT_STICKER_URI, null)
        currentDexCompanionVisible = prefs.getBoolean(KEY_DEX_COMPANION_VISIBLE, true)
        currentDexCompanionMood = prefs.getString(KEY_DEX_COMPANION_MOOD, DEX_COMPANION_MOOD_CALM)
            .orEmpty()
            .ifBlank { DEX_COMPANION_MOOD_CALM }
        currentDexCompanionSize = prefs.getString(KEY_DEX_COMPANION_SIZE, DEX_COMPANION_SIZE_MEDIUM)
            .orEmpty()
            .ifBlank { DEX_COMPANION_SIZE_MEDIUM }
        currentDexCompanionSide = prefs.getString(KEY_DEX_COMPANION_SIDE, DEX_COMPANION_SIDE_RIGHT)
            .orEmpty()
            .ifBlank { DEX_COMPANION_SIDE_RIGHT }
        currentDexCompanionFaceStyle = prefs.getString(KEY_DEX_COMPANION_FACE_STYLE, DEX_COMPANION_FACE_CLASSIC)
            .orEmpty()
            .ifBlank { DEX_COMPANION_FACE_CLASSIC }
        currentDexCompanionBubbleStyle = prefs.getString(KEY_DEX_COMPANION_BUBBLE_STYLE, DEX_COMPANION_BUBBLE_SOFT)
            .orEmpty()
            .ifBlank { DEX_COMPANION_BUBBLE_SOFT }
        currentDexCompanionSkin = prefs.getString(KEY_DEX_COMPANION_SKIN, DEX_COMPANION_SKIN_SKY)
            .orEmpty()
            .ifBlank { DEX_COMPANION_SKIN_SKY }
        currentDexCompanionAccessory = prefs.getString(KEY_DEX_COMPANION_ACCESSORY, DEX_COMPANION_ACCESSORY_NONE)
            .orEmpty()
            .ifBlank { DEX_COMPANION_ACCESSORY_NONE }
        currentDexCompanionName = prefs.getString(KEY_DEX_COMPANION_NAME, "Dex")
            .orEmpty()
            .ifBlank { "Dex" }
        currentDexCompanionVoice = prefs.getString(KEY_DEX_COMPANION_VOICE, DEX_COMPANION_VOICE_SUPPORTIVE)
            .orEmpty()
            .ifBlank { DEX_COMPANION_VOICE_SUPPORTIVE }
        currentDexCompanionPersonality = prefs.getString(KEY_DEX_COMPANION_PERSONALITY, DEX_COMPANION_PERSONALITY_COACH)
            .orEmpty()
            .ifBlank { DEX_COMPANION_PERSONALITY_COACH }
        dexCompanionIntroDismissed = prefs.getBoolean(KEY_DEX_COMPANION_INTRO_DISMISSED, false)
        dexCompanionIntroGreeted = prefs.getBoolean(KEY_DEX_COMPANION_INTRO_GREETED, false)
        currentDexCompanionOffsetX = prefs.getFloat(KEY_DEX_COMPANION_OFFSET_X, 0f)
        currentDexCompanionOffsetY = prefs.getFloat(KEY_DEX_COMPANION_OFFSET_Y, 0f)
        currentDexCompanionTierStyleOverride =
            prefs.getInt(KEY_DEX_COMPANION_TIER_STYLE_OVERRIDE, -1).takeIf { it >= 0 }
        dexCoins = prefs.getInt(KEY_DEX_COINS, 12)
        ownedDexCosmetics =
            (prefs.getStringSet(KEY_DEX_COMPANION_OWNED_COSMETICS, emptySet()) ?: emptySet()).toMutableSet()
        ownedDexCosmetics.addAll(defaultDexCosmetics())
        dexGamesPlayed = prefs.getInt(KEY_DEX_GAMES_PLAYED, 0)
        dexGamesCorrect = prefs.getInt(KEY_DEX_GAMES_CORRECT, 0)
        dexGamesCurrentStreak = prefs.getInt(KEY_DEX_GAMES_STREAK, 0)
        dexGamesBestStreak = prefs.getInt(KEY_DEX_GAMES_BEST_STREAK, 0)
        dexGuessPlays = prefs.getInt(KEY_DEX_GAMES_GUESS_PLAYS, 0)
        dexRiddlePlays = prefs.getInt(KEY_DEX_GAMES_RIDDLE_PLAYS, 0)
        dexTriviaPlays = prefs.getInt(KEY_DEX_GAMES_TRIVIA_PLAYS, 0)
        dexMemoryPlays = prefs.getInt(KEY_DEX_GAMES_MEMORY_PLAYS, 0)
        dexWouldYouRatherPlays = prefs.getInt(KEY_DEX_GAMES_WYR_PLAYS, 0)
        dexGamesChallengeCompletedDate = prefs.getString(KEY_DEX_GAMES_CHALLENGE_DONE_DATE, "").orEmpty()
        dexGamesChallengeClears = prefs.getInt(KEY_DEX_GAMES_CHALLENGE_CLEARS, 0)
        updateAdvancedStyleUi(currentThemePreset == "custom")
        updateDexCompanionControls()
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
        fetchLearningReminderPreferences()
        fetchSafetyPreferences()
        fetchRelationshipAliases()
        maintainBackgroundService()
    }

    private fun clearSession() {
        authToken = null
        currentUserRole = "user"
        currentUserName = ""
        currentAccessType = ""
        phoneBackendEnabled = false
        pendingAction = null
        pendingContactTarget = null
        pendingContactAction = null
        pendingSmsRecipient = null
        pendingSmsBodyDraft = null
        pendingReminderSmsTriggerAt = null
        pendingReminderSmsTarget = null
        pendingReminderSmsBody = null
        awaitingReminderSmsContact = false
        pendingReminderCallTriggerAt = null
        awaitingReminderCallContact = false
        pendingReminderCallTargetName = null
        pendingReminderContactChoices = emptyList()
        pendingReminderContactDisambiguationMode = null
        pendingIncomingSmsSender = null
        pendingIncomingSmsValue = null
        pendingIncomingSmsBody = null
        pendingNotificationApp = null
        pendingNotificationTitle = null
        pendingNotificationText = null
        conversationActive = false
        awaitingWakeCommand = false
        mainHandler.removeCallbacks(resetWakeWindowRunnable)
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER_ROLE)
            .remove(KEY_USER_NAME)
            .remove(KEY_ACCESS_TYPE)
            .remove(KEY_ACTIVITY_LOG)
            .remove(KEY_CALL_MESSAGE_LOG)
            .putBoolean(KEY_LEARNING_REMINDER_ENABLED, false)
            .putString(KEY_LEARNING_REMINDER_TIME, "")
            .putBoolean(KEY_BACKGROUND_SERVICE_ENABLED, false)
            .putBoolean(KEY_AUTO_START_ASSISTANT, false)
            .putBoolean(KEY_PHONE_BACKEND_ENABLED, false)
              .putBoolean(KEY_AUTO_ANSWER_KNOWN_CONTACTS, false)
              .putBoolean(KEY_AUTO_ANSWER_ANY_NON_SPAM, false)
              .putBoolean(KEY_AUTO_DECLINE_SPAM, true)
              .commit()
        clearPendingNotification()
        binding.authMessage.text = getString(R.string.logged_out_message)
        binding.lastHeardValue.text = getString(R.string.voice_dash)
        binding.lastReplyValue.text = getString(R.string.voice_dash)
        binding.conversationStatus.text = getString(R.string.wake_mode_off)
        binding.safetyProfileMessage.text = ""
        binding.safetyDiagnosticsValue.text = ""
        binding.aliasSummaryValue.text = ""
        binding.activityLogValue.text = getString(R.string.activity_log_empty)
        binding.callMessageLogValue.text = getString(R.string.call_message_log_empty)
        binding.learningLessonPreview.text = ""
        binding.learningQuizPreview.text = ""
        updatePendingActionUi()
        DexLearningReminderScheduler.cancelReminder(this)
        stopDexBackgroundService()
        refreshLoggedInState()
        applyDexCompanionUi()
    }

    private fun refreshLoggedInState() {
        val loggedIn = !authToken.isNullOrBlank()
        val isAdmin = currentUserRole.equals("admin", ignoreCase = true)
        val isAffiliate = currentUserRole.equals("affiliate", ignoreCase = true)
        val isRegularUser = !isAdmin && !isAffiliate
        val showRegularDashboard = loggedIn && isRegularUser
        val showAffiliateDashboard = loggedIn && isAffiliate
        val showAdminDashboard = loggedIn && isAdmin

        binding.logoutButton.visibility = if (loggedIn) View.VISIBLE else View.GONE
        binding.inviteCodeCard.visibility = if (loggedIn) View.GONE else View.VISIBLE
        binding.dashboardCard.visibility = if (loggedIn) View.VISIBLE else View.GONE
        binding.userDashboardCard.visibility = if (showRegularDashboard || showAffiliateDashboard) View.VISIBLE else View.GONE
        binding.learningCenterCard.visibility = if (showRegularDashboard || showAffiliateDashboard) View.VISIBLE else View.GONE
        binding.safetyProfileCard.visibility = if (showRegularDashboard || showAdminDashboard) View.VISIBLE else View.GONE
        binding.dexGamesCard.visibility = if (showRegularDashboard) View.VISIBLE else View.GONE
        binding.lifeSectionsCard.visibility = if (showAdminDashboard) View.VISIBLE else View.GONE
        binding.billingCard.visibility = if (showRegularDashboard) View.VISIBLE else View.GONE
        binding.affiliateDashboardCard.visibility = if (showAffiliateDashboard) View.VISIBLE else View.GONE
        binding.adminDashboardCard.visibility = if (showAdminDashboard) View.VISIBLE else View.GONE
        binding.themeCard.visibility = if (loggedIn) View.VISIBLE else View.GONE
        binding.serverCard.visibility = if (showAdminDashboard) View.VISIBLE else View.GONE
        binding.permissionsCard.visibility = if (showAdminDashboard) View.VISIBLE else View.GONE
        binding.backgroundAccessCard.visibility = if (showAdminDashboard) View.VISIBLE else View.GONE
        binding.callMonitorCard.visibility = if (showAdminDashboard) View.VISIBLE else View.GONE
        binding.voiceCard.visibility = if (showRegularDashboard || showAdminDashboard) View.VISIBLE else View.GONE
        binding.conversationCard.visibility = if (showRegularDashboard || showAdminDashboard) View.VISIBLE else View.GONE
        binding.authModeToggle.visibility = if (loggedIn) View.GONE else View.VISIBLE
        binding.nameInput.visibility = if (!loggedIn && isRegisterMode) View.VISIBLE else View.GONE
        binding.affiliateInviteInput.visibility = if (!loggedIn && isRegisterMode) View.VISIBLE else View.GONE
        binding.emailInput.visibility = if (!loggedIn) View.VISIBLE else View.GONE
        binding.passwordInput.visibility = if (!loggedIn) View.VISIBLE else View.GONE
        binding.authActionButton.visibility = if (!loggedIn) View.VISIBLE else View.GONE
        binding.permissionsCard.alpha = if (showAdminDashboard) 1f else 0.55f
        binding.phonePermissionSwitch.isEnabled = loggedIn
        binding.calendarPermissionSwitch.isEnabled = loggedIn
        binding.notificationsPermissionSwitch.isEnabled = loggedIn
        binding.autoAnswerKnownContactsSwitch.isEnabled = loggedIn
        binding.autoAnswerAnyCallerSwitch.isEnabled = loggedIn
        binding.autoDeclineSpamSwitch.isEnabled = loggedIn
        binding.authMessage.text = if (loggedIn) getString(R.string.connected_as, binding.emailInput.text?.toString().orEmpty()) else getString(R.string.logged_out_message)
        updateDexCompanionControls()
        applyDexCompanionUi()
        if (loggedIn) {
            binding.statusTitle.text = when {
                isAdmin -> getString(R.string.dex_home_title_admin)
                isAffiliate -> getString(R.string.dex_home_title_affiliate)
                else -> getString(R.string.dex_home_title_user)
            }
            binding.statusSummary.text = when {
                isAdmin -> getString(R.string.dex_home_summary_admin)
                isAffiliate -> getString(R.string.dex_home_summary_affiliate)
                else -> getString(R.string.dex_home_summary_user)
            }
        } else {
            binding.statusTitle.text = getString(R.string.dex_ready_title)
            binding.statusSummary.text = getString(R.string.dex_ready_summary)
        }
        updateDashboardHeader()
        animateVisibleDashboardCards(loggedIn)
        if (!loggedIn) {
            applyPermissions(emptyMap())
            autoWakeStarted = false
            binding.userDashboardChatCount.text = getString(R.string.chat_history_count, 0)
            binding.userDashboardLessonCount.text = getString(R.string.lesson_history_count, 0)
            binding.userDashboardQuizScore.text = getString(R.string.quiz_score_summary, getString(R.string.quiz_score_empty))
            binding.learningProfileSummary.text = learningProfileMissingCopy()
        binding.learningReminderSummary.text = getString(R.string.learning_reminder_off)
        binding.learningLessonPreview.text = ""
        binding.learningQuizPreview.text = dashboardActivityEmptyCopy()
        binding.dexGamePrompt.text = getString(R.string.dex_games_prompt_default)
            binding.dexGameStatus.text = dexGamesStatusSummary(getString(R.string.dex_games_status_default))
            binding.dexGameInput.setText("")
            activeDexMiniGame = DexMiniGameType.NONE
            setHintBand(binding.userDashboardHint, null)
            setHintBand(binding.learningCenterHint, null)
            setHintBand(binding.billingHint, null)
            setHintBand(binding.affiliateDashboardHint, null)
            setHintBand(binding.adminDashboardHint, null)
            binding.lifeSectionsPreview.text = ""
            dashboardSections.clear()
            renderDashboardSections()
            binding.billingStatusText.text = ""
            binding.billingDetailText.text = ""
        }
        refreshCallMonitorState()
        autoStartWakeModeIfReady()
    }

    private fun animateVisibleDashboardCards(loggedIn: Boolean) {
        val dashboardCards = listOf(
            binding.dashboardCard,
            binding.userDashboardCard,
            binding.learningCenterCard,
            binding.safetyProfileCard,
            binding.dexGamesCard,
            binding.lifeSectionsCard,
            binding.billingCard,
            binding.affiliateDashboardCard,
            binding.adminDashboardCard,
            binding.themeCard,
            binding.serverCard,
            binding.permissionsCard,
            binding.backgroundAccessCard,
            binding.callMonitorCard,
            binding.voiceCard,
            binding.conversationCard
        )
        if (!loggedIn) {
            animatedDashboardCards.clear()
            dashboardCards.forEach { it.clearAnimation() }
            return
        }
        dashboardCards.forEachIndexed { index, card ->
            if (card.visibility == View.VISIBLE) {
                if (animatedDashboardCards.add(card.id)) {
                    val animation = android.view.animation.AnimationUtils.loadAnimation(this, R.anim.dashboard_section_in)
                    animation.startOffset = (index * 24L).coerceAtMost(180L)
                    card.startAnimation(animation)
                }
            } else {
                animatedDashboardCards.remove(card.id)
                card.clearAnimation()
            }
        }
    }

    private fun pulseDashboardValues(vararg views: View) {
        val motion = dashboardMotionProfile(currentUserRole.lowercase(Locale.US))
        views.forEach { view ->
            view.animate().cancel()
            view.clearAnimation()
            view.alpha = motion.pulseStartAlpha
            view.scaleX = motion.pulseStartScale
            view.scaleY = motion.pulseStartScale
            view.animate()
                .alpha(1f)
                .scaleX(1f)
                .scaleY(1f)
                .setDuration(motion.pulseDurationMs)
                .start()
        }
    }

    private fun startLoadingPulse(vararg views: TextView) {
        val motion = dashboardMotionProfile(currentUserRole.lowercase(Locale.US))
        views.forEach { view ->
            val animation = android.view.animation.AlphaAnimation(motion.loadingMinAlpha, 1f).apply {
                duration = motion.loadingDurationMs
                repeatMode = android.view.animation.Animation.REVERSE
                repeatCount = android.view.animation.Animation.INFINITE
                startOffset = motion.loadingStartOffsetMs
            }
            view.clearAnimation()
            view.startAnimation(animation)
        }
    }

    private fun dashboardMotionProfile(roleKey: String): DashboardMotionProfile = when (roleKey) {
        "admin" -> DashboardMotionProfile(
            pulseDurationMs = 180L,
            pulseStartAlpha = 0.78f,
            pulseStartScale = 0.976f,
            loadingDurationMs = 620L,
            loadingMinAlpha = 0.42f,
            loadingStartOffsetMs = 0L,
            statusLiftDp = 2f,
        )
        "affiliate" -> DashboardMotionProfile(
            pulseDurationMs = 280L,
            pulseStartAlpha = 0.86f,
            pulseStartScale = 0.982f,
            loadingDurationMs = 860L,
            loadingMinAlpha = 0.56f,
            loadingStartOffsetMs = 70L,
            statusLiftDp = 1f,
        )
        else -> DashboardMotionProfile(
            pulseDurationMs = 240L,
            pulseStartAlpha = 0.84f,
            pulseStartScale = 0.988f,
            loadingDurationMs = 760L,
            loadingMinAlpha = 0.5f,
            loadingStartOffsetMs = 36L,
            statusLiftDp = 1.5f,
        )
    }

    private fun sectionSignalColor(roleKey: String): Int = when (roleKey) {
        "admin" -> getColorCompat(R.color.dex_admin_signal)
        "affiliate" -> getColorCompat(R.color.dex_affiliate_signal)
        else -> getColorCompat(R.color.dex_user_signal)
    }

    private fun sectionLiveColor(roleKey: String): Int = when (roleKey) {
        "admin" -> getColorCompat(R.color.dex_admin_stroke)
        "affiliate" -> getColorCompat(R.color.dex_affiliate_stroke)
        else -> getColorCompat(R.color.dex_user_stroke)
    }

    private fun sectionEdgeColor(roleKey: String, active: Boolean): Int {
        val base = when (roleKey) {
            "admin" -> getColorCompat(if (active) R.color.dex_admin_signal else R.color.dex_admin_stroke)
            "affiliate" -> getColorCompat(if (active) R.color.dex_affiliate_signal else R.color.dex_affiliate_stroke)
            else -> getColorCompat(if (active) R.color.dex_user_signal else R.color.dex_user_stroke)
        }
        return ColorUtils.setAlphaComponent(base, if (active) 132 else 96)
    }

    private fun roleCardElevationPx(roleKey: String, active: Boolean): Float {
        val dp = if (active) 2f else 0f
        return dp * resources.displayMetrics.density
    }

    private fun roleInputAccentColor(roleKey: String): Int = when (roleKey) {
        "admin" -> getColorCompat(R.color.dex_admin_signal)
        "affiliate" -> getColorCompat(R.color.dex_affiliate_signal)
        else -> getColorCompat(R.color.dex_user_signal)
    }

    private fun roleInputFillColor(roleKey: String): Int = when (roleKey) {
        "admin" -> ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_panel_elevated), 222)
        "affiliate" -> ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_panel_elevated), 222)
        else -> ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_panel_elevated), 222)
    }

    private fun collectTextInputLayouts(view: View): List<TextInputLayout> {
        val found = mutableListOf<TextInputLayout>()
        fun walk(node: View) {
            when (node) {
                is TextInputLayout -> found += node
                is ViewGroup -> for (index in 0 until node.childCount) {
                    walk(node.getChildAt(index))
                }
            }
        }
        walk(view)
        return found
    }

    private fun applyRoleInputMood(roleKey: String) {
        val accent = roleInputAccentColor(roleKey)
        val fill = roleInputFillColor(roleKey)
        val strokeIdle = ColorUtils.setAlphaComponent(sectionEdgeColor(roleKey, active = false), 190)
        val strokeDisabled = ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_border), 120)
        val hint = getColorCompat(R.color.dex_text_secondary)
        val hintFocused = ColorUtils.blendARGB(accent, android.graphics.Color.WHITE, 0.18f)
        val strokeStates = arrayOf(
            intArrayOf(android.R.attr.state_enabled, android.R.attr.state_focused),
            intArrayOf(android.R.attr.state_enabled),
            intArrayOf()
        )
        val strokeColors = intArrayOf(accent, strokeIdle, strokeDisabled)
        val hintStates = arrayOf(
            intArrayOf(android.R.attr.state_enabled, android.R.attr.state_focused),
            intArrayOf(android.R.attr.state_enabled),
            intArrayOf()
        )
        val hintColors = intArrayOf(hintFocused, hint, ColorUtils.setAlphaComponent(hint, 132))
        val strokeList = ColorStateList(strokeStates, strokeColors)
        val hintList = ColorStateList(hintStates, hintColors)

        collectTextInputLayouts(binding.root).forEach { input ->
            input.setBoxStrokeColorStateList(strokeList)
            input.defaultHintTextColor = hintList
            input.hintTextColor = hintList
            input.setBoxBackgroundColorStateList(ColorStateList.valueOf(fill))
            input.setStartIconTintList(hintList)
            input.setEndIconTintList(hintList)
            input.editText?.setTextColor(android.graphics.Color.WHITE)
            input.editText?.setHintTextColor(hint)
        }
    }

    private fun strokeWidthDp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt().coerceAtLeast(1)

    private fun dashboardActivityEmptyCopy(): String =
        if (currentUserRole.equals("affiliate", true)) {
            getString(R.string.dashboard_activity_empty_affiliate)
        } else {
            getString(R.string.dashboard_activity_empty_user)
        }

    private fun learningProfileMissingCopy(): String =
        if (currentUserRole.equals("affiliate", true)) {
            getString(R.string.learning_profile_missing_affiliate)
        } else {
            getString(R.string.learning_profile_missing)
        }

    private fun billingUnknownDetailCopy(): String = when (currentUserRole.lowercase(Locale.US)) {
        "admin" -> getString(R.string.billing_detail_unknown_admin)
        "affiliate" -> getString(R.string.billing_detail_unknown_affiliate)
        else -> getString(R.string.billing_detail_unknown_user)
    }

    private fun installAdvancedDeviceAccessControls() {
        if (advancedDeviceAccessStatusView != null) return
        val parent = binding.backgroundAccessMessage.parent as? LinearLayout ?: return
        val insertIndex = parent.indexOfChild(binding.backgroundAccessMessage).coerceAtLeast(0)

        val overlayButton = MaterialButton(
            this,
            null,
            com.google.android.material.R.attr.materialButtonOutlinedStyle
        ).apply {
            text = getString(R.string.open_overlay_settings)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dpToPx(8) }
            setOnClickListener { openOverlaySettings() }
        }
        parent.addView(overlayButton, insertIndex)

        val accessibilityButton = MaterialButton(
            this,
            null,
            com.google.android.material.R.attr.materialButtonOutlinedStyle
        ).apply {
            text = getString(R.string.open_accessibility_settings)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dpToPx(8) }
            setOnClickListener { openAccessibilitySettings() }
        }
        parent.addView(accessibilityButton, insertIndex + 1)

        advancedDeviceAccessStatusView = TextView(this).apply {
            setTextColor(getColorCompat(R.color.dex_text_secondary))
            textSize = 13f
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dpToPx(10) }
        }
        parent.addView(advancedDeviceAccessStatusView, insertIndex + 2)
    }

    private fun dashboardHintCopy(): String =
        if (currentUserRole.equals("affiliate", true)) {
            getString(R.string.dashboard_hint_affiliate)
        } else {
            getString(R.string.dashboard_hint_user)
        }

    private fun learningHintCopy(): String =
        if (currentUserRole.equals("affiliate", true)) {
            getString(R.string.learning_hint_affiliate)
        } else {
            getString(R.string.learning_hint_user)
        }

    private fun billingHintCopy(): String = when (currentUserRole.lowercase(Locale.US)) {
        "admin" -> getString(R.string.billing_hint_unknown_admin)
        "affiliate" -> getString(R.string.billing_hint_unknown_affiliate)
        else -> getString(R.string.billing_hint_unknown_user)
    }

    private fun billingActiveHintCopy(access: String): String? = when (access.lowercase(Locale.US)) {
        "trial" -> getString(R.string.billing_hint_trial)
        "paid" -> getString(R.string.billing_hint_paid)
        "unlimited" -> getString(R.string.billing_hint_unlimited)
        "expired" -> getString(R.string.billing_hint_expired)
        else -> null
    }

    private fun hintLead(roleKey: String, tone: HintTone): String = when (roleKey) {
        "admin" -> when (tone) {
            HintTone.NEXT_STEP -> getString(R.string.hint_lead_admin_next)
            HintTone.READY -> getString(R.string.hint_lead_admin_ready)
            HintTone.HEALTHY -> getString(R.string.hint_lead_admin_healthy)
        }
        "affiliate" -> when (tone) {
            HintTone.NEXT_STEP -> getString(R.string.hint_lead_affiliate_next)
            HintTone.READY -> getString(R.string.hint_lead_affiliate_ready)
            HintTone.HEALTHY -> getString(R.string.hint_lead_affiliate_healthy)
        }
        else -> when (tone) {
            HintTone.NEXT_STEP -> getString(R.string.hint_lead_user_next)
            HintTone.READY -> getString(R.string.hint_lead_user_ready)
            HintTone.HEALTHY -> getString(R.string.hint_lead_user_healthy)
        }
    }

    private fun sectionChipTint(roleKey: String, isLoading: Boolean): Int = when (roleKey) {
        "admin" -> getColorCompat(if (isLoading) R.color.dex_admin_readout else R.color.dex_admin_chip_tint)
        "affiliate" -> getColorCompat(if (isLoading) R.color.dex_affiliate_readout else R.color.dex_affiliate_chip_tint)
        else -> getColorCompat(if (isLoading) R.color.dex_user_readout else R.color.dex_user_chip_tint)
    }

    private fun sectionStatusCopy(roleKey: String, isLoading: Boolean): String = when (roleKey) {
        "admin" -> getString(if (isLoading) R.string.dashboard_status_loading_admin else R.string.dashboard_status_live_admin)
        "affiliate" -> getString(if (isLoading) R.string.dashboard_status_loading_affiliate else R.string.dashboard_status_live_affiliate)
        else -> getString(if (isLoading) R.string.dashboard_status_loading_user else R.string.dashboard_status_live_user)
    }

    private fun setHintBand(view: TextView, message: String?, tone: HintTone = HintTone.NEXT_STEP) {
        val text = message?.trim().orEmpty()
        view.text = text
        if (text.isBlank()) {
            view.visibility = View.GONE
            return
        }
        val roleKey = currentUserRole.lowercase(Locale.US)
        view.text = "${hintLead(roleKey, tone)}\n$text"
        val (backgroundColor, textColor) = when (tone) {
            HintTone.READY -> R.color.dex_hint_ready_bg to R.color.dex_hint_ready_text
            HintTone.HEALTHY -> R.color.dex_hint_healthy_bg to R.color.dex_hint_healthy_text
            HintTone.NEXT_STEP -> R.color.dex_hint_next_bg to R.color.dex_hint_next_text
        }
        view.backgroundTintList = ColorStateList.valueOf(getColorCompat(backgroundColor))
        view.setTextColor(getColorCompat(textColor))
        view.visibility = View.VISIBLE
    }

    private fun applyActionButtonState(
        button: MaterialButton,
        enabled: Boolean,
        backgroundColor: Int,
        textColor: Int = android.graphics.Color.WHITE
    ) {
        val previousTint = button.backgroundTintList?.defaultColor ?: backgroundColor
        val previousTextColor = button.currentTextColor
        val targetAlpha = if (enabled) 1f else 0.58f
        val shouldAnimate =
            previousTint != backgroundColor ||
                previousTextColor != textColor ||
                kotlin.math.abs(button.alpha - targetAlpha) > 0.02f

        button.isEnabled = enabled
        if (!shouldAnimate) {
            button.alpha = targetAlpha
            button.backgroundTintList = ColorStateList.valueOf(backgroundColor)
            button.setTextColor(textColor)
            return
        }

        button.animate().cancel()
        button.animate()
            .alpha(targetAlpha)
            .setDuration(180L)
            .start()

        ValueAnimator.ofObject(ArgbEvaluator(), previousTint, backgroundColor).apply {
            duration = 180L
            addUpdateListener { animator ->
                button.backgroundTintList = ColorStateList.valueOf(animator.animatedValue as Int)
            }
            start()
        }

        ValueAnimator.ofObject(ArgbEvaluator(), previousTextColor, textColor).apply {
            duration = 180L
            addUpdateListener { animator ->
                button.setTextColor(animator.animatedValue as Int)
            }
            start()
        }
    }

    private fun applyRoleSwitchMood(switch: SwitchMaterial, roleKey: String) {
        val active = sectionSignalColor(roleKey)
        val activeTrack = ColorUtils.setAlphaComponent(active, 124)
        val inactiveThumb = getColorCompat(R.color.dex_text_secondary)
        val inactiveTrack = ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_border), 170)
        val disabledThumb = ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_text_secondary), 118)
        val disabledTrack = ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_border), 84)

        val thumbStates = arrayOf(
            intArrayOf(android.R.attr.state_enabled, android.R.attr.state_checked),
            intArrayOf(android.R.attr.state_enabled),
            intArrayOf()
        )
        val thumbColors = intArrayOf(
            active,
            inactiveThumb,
            disabledThumb
        )
        val trackStates = arrayOf(
            intArrayOf(android.R.attr.state_enabled, android.R.attr.state_checked),
            intArrayOf(android.R.attr.state_enabled),
            intArrayOf()
        )
        val trackColors = intArrayOf(
            activeTrack,
            inactiveTrack,
            disabledTrack
        )

        switch.thumbTintList = ColorStateList(thumbStates, thumbColors)
        switch.trackTintList = ColorStateList(trackStates, trackColors)
        switch.setTextColor(
            if (switch.isEnabled) getColorCompat(R.color.dex_text_secondary)
            else ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_text_secondary), 148)
        )
    }

    private fun refreshInteractionStates() {
        val roleKey = currentUserRole.lowercase(Locale.US)
        val roleSignal = sectionSignalColor(roleKey)
        val muted = getColorCompat(R.color.dex_button_muted)
        val healthy = getColorCompat(R.color.dex_button_healthy)
        val warn = getColorCompat(R.color.dex_button_warn)
        val accent = getColorCompat(R.color.dex_accent)

        applyActionButtonState(binding.testVoiceButton, ttsReady, if (ttsReady) accent else muted, android.graphics.Color.BLACK)
        applyActionButtonState(binding.setupVoiceButton, true, muted)
        applyActionButtonState(binding.setupWakeWordButton, true, muted)
        applyActionButtonState(binding.wakeModeButton, true, if (wakeModeEnabled) roleSignal else accent, android.graphics.Color.BLACK)
        applyActionButtonState(binding.requestAndroidPermissionsButton, binding.requestAndroidPermissionsButton.isEnabled, muted)
        applyActionButtonState(binding.answerCallButton, binding.answerCallButton.isEnabled, healthy)
        applyActionButtonState(binding.declineCallButton, binding.declineCallButton.isEnabled, warn)
        applyActionButtonState(binding.approveActionButton, binding.approveActionButton.isEnabled, healthy)
        applyActionButtonState(binding.cancelActionButton, binding.cancelActionButton.isEnabled, warn)
        applyActionButtonState(binding.subscribeNowButton, binding.subscribeNowButton.visibility == View.VISIBLE, accent, android.graphics.Color.BLACK)
        applyActionButtonState(binding.manageBillingButton, binding.manageBillingButton.visibility == View.VISIBLE, muted)
        listOf(
            binding.safetyNotifyTrustedContactSwitch,
            binding.safetyFollowUpSwitch,
            binding.phonePermissionSwitch,
            binding.calendarPermissionSwitch,
            binding.notificationsPermissionSwitch,
            binding.autoAnswerKnownContactsSwitch,
            binding.autoAnswerAnyCallerSwitch,
            binding.autoDeclineSpamSwitch
        ).forEach { applyRoleSwitchMood(it, roleKey) }
    }

    private fun beginSectionRefresh(label: TextView, card: MaterialCardView, roleKey: String) {
        val motion = dashboardMotionProfile(roleKey)
        label.text = sectionStatusCopy(roleKey, isLoading = true)
        label.setTextColor(sectionSignalColor(roleKey))
        label.backgroundTintList = ColorStateList.valueOf(sectionChipTint(roleKey, isLoading = true))
        label.alpha = 1f
        label.translationY = -motion.statusLiftDp * resources.displayMetrics.density
        label.scaleX = 0.985f
        label.scaleY = 0.985f
        label.animate().cancel()
        label.animate()
            .translationY(0f)
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(motion.pulseDurationMs)
            .start()
        card.strokeColor = sectionEdgeColor(roleKey, active = true)
        card.strokeWidth = strokeWidthDp(2)
        card.animate().cancel()
        card.animate()
            .translationZ(roleCardElevationPx(roleKey, active = true))
            .setDuration(motion.pulseDurationMs)
            .start()
        startLoadingPulse(label)
    }

    private fun completeSectionRefresh(label: TextView, card: MaterialCardView, roleKey: String) {
        val motion = dashboardMotionProfile(roleKey)
        label.clearAnimation()
        label.animate().cancel()
        label.alpha = 0.84f
        label.text = sectionStatusCopy(roleKey, isLoading = false)
        label.setTextColor(sectionLiveColor(roleKey))
        label.backgroundTintList = ColorStateList.valueOf(sectionChipTint(roleKey, isLoading = false))
        label.translationY = 0f
        label.scaleX = 1f
        label.scaleY = 1f
        label.animate()
            .alpha(0.84f)
            .setDuration((motion.pulseDurationMs * 0.8f).toLong())
            .start()
        card.strokeColor = sectionEdgeColor(roleKey, active = false)
        card.strokeWidth = strokeWidthDp(1)
        card.animate().cancel()
        card.animate()
            .translationZ(roleCardElevationPx(roleKey, active = false))
            .setDuration((motion.pulseDurationMs * 0.8f).toLong())
            .start()
    }

    private fun showDashboardLoadingStates() {
        val currentRoleKey = currentUserRole.lowercase(Locale.US)
        beginSectionRefresh(binding.userDashboardStatus, binding.userDashboardCard, currentRoleKey)
        binding.userDashboardChatCount.text = getString(R.string.dashboard_loading_value)
        binding.userDashboardLessonCount.text = getString(R.string.dashboard_loading_value)
        binding.userDashboardQuizScore.text = getString(R.string.dashboard_loading_value)
        binding.learningQuizPreview.text = getString(R.string.dashboard_loading_detail)
        startLoadingPulse(
            binding.userDashboardChatCount,
            binding.userDashboardLessonCount,
            binding.userDashboardQuizScore,
            binding.learningQuizPreview
        )
        if (currentUserRole == "affiliate") {
            beginSectionRefresh(binding.affiliateDashboardStatus, binding.affiliateDashboardCard, "affiliate")
            binding.affiliatePromoCode.text = getString(R.string.affiliate_dashboard_loading)
            binding.affiliateEarnings.text = getString(R.string.dashboard_loading_value)
            binding.affiliateSignups.text = getString(R.string.dashboard_loading_value)
            binding.affiliatePaidSubs.text = getString(R.string.dashboard_loading_value)
            startLoadingPulse(
                binding.affiliatePromoCode,
                binding.affiliateEarnings,
                binding.affiliateSignups,
                binding.affiliatePaidSubs
            )
        }
        if (currentUserRole == "admin") {
            beginSectionRefresh(binding.adminDashboardStatus, binding.adminDashboardCard, "admin")
            binding.adminStatsValue.text = getString(R.string.admin_dashboard_loading)
            startLoadingPulse(binding.adminStatsValue)
        }
    }

    private fun showBillingLoadingState() {
        beginSectionRefresh(binding.billingStatusTag, binding.billingCard, currentUserRole.lowercase(Locale.US))
        binding.billingStatusText.text = getString(R.string.billing_status_loading)
        binding.billingDetailText.text = getString(R.string.billing_detail_loading)
        startLoadingPulse(binding.billingStatusText, binding.billingDetailText)
    }

    private fun showLearningLoadingState() {
        beginSectionRefresh(binding.learningCenterStatus, binding.learningCenterCard, currentUserRole.lowercase(Locale.US))
        binding.learningProfileSummary.text = getString(R.string.learning_profile_loading)
        binding.learningReminderSummary.text = getString(R.string.learning_reminder_loading)
        startLoadingPulse(binding.learningProfileSummary, binding.learningReminderSummary)
    }

    private fun updateDashboardHeader() {
        val name = currentUserName.ifBlank {
            binding.emailInput.text?.toString()?.substringBefore("@").orEmpty().ifBlank { "Dex user" }
        }
        val roleKey = currentUserRole.lowercase(Locale.US)
        binding.dashboardWelcome.text = getString(R.string.dashboard_welcome, name)
        binding.dashboardRole.text = getString(R.string.dashboard_role, roleLabel(currentUserRole))
        binding.dashboardAccess.text = getString(R.string.dashboard_access, accessLabel(currentAccessType))
        binding.dashboardSummary.text = when (roleKey) {
            "admin" -> getString(R.string.dashboard_summary_admin)
            "affiliate" -> getString(R.string.dashboard_summary_affiliate)
            else -> getString(R.string.dashboard_summary_user)
        }
        binding.dashboardOverline.text = when (roleKey) {
            "admin" -> getString(R.string.dashboard_overline_admin)
            "affiliate" -> getString(R.string.dashboard_overline_affiliate)
            else -> getString(R.string.dashboard_overline_user)
        }
        binding.dashboardCreativeFooter.text = when (roleKey) {
            "admin" -> getString(R.string.dashboard_creative_footer_admin)
            "affiliate" -> getString(R.string.dashboard_creative_footer_affiliate)
            else -> getString(R.string.dashboard_creative_footer_user)
        }
        binding.dashboardHeroSurface.setBackgroundResource(
            when (roleKey) {
                "admin" -> R.drawable.dashboard_hero_surface_admin
                "affiliate" -> R.drawable.dashboard_hero_surface_affiliate
                else -> R.drawable.dashboard_hero_surface
            }
        )
        val chipTint = getColorCompat(R.color.dex_chip_start)
        binding.dashboardRole.backgroundTintList = ColorStateList.valueOf(chipTint)
        binding.dashboardAccess.backgroundTintList = ColorStateList.valueOf(chipTint)
        binding.dashboardOverline.setTextColor(
            when (roleKey) {
                "admin" -> getColorCompat(R.color.dex_admin_signal)
                "affiliate" -> getColorCompat(R.color.dex_affiliate_signal)
                else -> getColorCompat(R.color.dex_user_signal)
            }
        )
        binding.dashboardSignalTall.backgroundTintList = ColorStateList.valueOf(
            getColorCompat(R.color.dex_border_soft)
        )
        binding.dashboardSignalMid.backgroundTintList = ColorStateList.valueOf(
            getColorCompat(R.color.dex_border_soft)
        )
        binding.dashboardSignalShort.backgroundTintList = ColorStateList.valueOf(
            getColorCompat(R.color.dex_border_soft)
        )
        applyRoleDashboardMood(roleKey)
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

    private fun getColorCompat(colorRes: Int): Int = ContextCompat.getColor(this, colorRes)

    private fun dpToPx(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun applyRoleDashboardMood(roleKey: String) {
        val defaultPanel = getColorCompat(R.color.dex_panel)
        val defaultStroke = getColorCompat(R.color.dex_border)
        val allRoleCards = listOf(
            binding.dashboardCard,
            binding.userDashboardCard,
            binding.learningCenterCard,
            binding.safetyProfileCard,
            binding.lifeSectionsCard,
            binding.billingCard,
            binding.affiliateDashboardCard,
            binding.adminDashboardCard,
            binding.themeCard,
            binding.serverCard,
            binding.permissionsCard,
            binding.backgroundAccessCard,
            binding.callMonitorCard,
            binding.voiceCard,
            binding.conversationCard
        )
        allRoleCards.forEach { card ->
            card.setCardBackgroundColor(defaultPanel)
            card.strokeColor = defaultStroke
            card.cardElevation = 0f
            card.translationZ = 0f
        }

        val roleCards = when (roleKey) {
            "admin" -> listOf(
                binding.dashboardCard,
                binding.adminDashboardCard,
                binding.serverCard,
                binding.permissionsCard,
                binding.backgroundAccessCard,
                binding.callMonitorCard,
                binding.voiceCard,
                binding.conversationCard,
                binding.safetyProfileCard,
                binding.themeCard
            )
            "affiliate" -> listOf(
                binding.dashboardCard,
                binding.userDashboardCard,
                binding.learningCenterCard,
                binding.affiliateDashboardCard
            )
            else -> listOf(
                binding.dashboardCard,
                binding.userDashboardCard,
                binding.learningCenterCard,
                binding.safetyProfileCard,
                binding.lifeSectionsCard,
                binding.billingCard,
                binding.voiceCard,
                binding.conversationCard
            )
        }
        val panelColor = getColorCompat(R.color.dex_panel)
        roleCards.forEach { card ->
            card.setCardBackgroundColor(panelColor)
            card.strokeColor = sectionEdgeColor(roleKey, active = false)
            card.cardElevation = roleCardElevationPx(roleKey, active = false)
            card.translationZ = roleCardElevationPx(roleKey, active = false)
        }
        applyRoleOutputStripMood(roleKey)
        applyRoleInputMood(roleKey)
    }

    private fun applyRoleOutputStripMood(roleKey: String) {
        val primaryTone = getColorCompat(R.color.dex_user_readout)
        val secondaryTone = getColorCompat(R.color.dex_user_readout_alt)
        listOf(
            binding.learningLessonOutputStrip,
            binding.safetyProfileMessageStrip,
            binding.activityLogValue.parent as View
        ).forEach { strip ->
            strip.backgroundTintList = ColorStateList.valueOf(primaryTone)
        }
        listOf(
            binding.learningQuizPreview.parent as View,
            binding.safetyDiagnosticsStrip
        ).forEach { strip ->
            strip.backgroundTintList = ColorStateList.valueOf(secondaryTone)
        }
    }

    private fun fetchDashboardData() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        showDashboardLoadingStates()
        lifecycleScope.launch {
            var userDashboardPending = 2
            fun finishUserDashboardRefresh() {
                userDashboardPending -= 1
                if (userDashboardPending <= 0) {
                    completeSectionRefresh(
                        binding.userDashboardStatus,
                        binding.userDashboardCard,
                        currentUserRole.lowercase(Locale.US)
                    )
                }
            }
            getJsonArray("$serverUrl/dex/history", token)
                .onSuccess { history ->
                    binding.userDashboardChatCount.text = getString(R.string.chat_history_count, history.length())
                    pulseDashboardValues(binding.userDashboardChatCount)
                    finishUserDashboardRefresh()
                }
                .onFailure {
                    binding.userDashboardChatCount.text = getString(R.string.chat_history_count, 0)
                    pulseDashboardValues(binding.userDashboardChatCount)
                    finishUserDashboardRefresh()
                }
            getJson("$serverUrl/dex/learning/history", token)
                .onSuccess { response ->
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
                    if (binding.learningQuizPreview.text.isNullOrBlank()) {
                        binding.learningQuizPreview.text = dashboardActivityEmptyCopy()
                    }
                    val showUserHint = lessons == 0 && streak == 0 && nextLesson?.optString("topic").isNullOrBlank()
                    val activeUserHint =
                        if (streak > 0) getString(R.string.dashboard_active_hint_streak)
                        else if (lessons > 0 || !nextLesson?.optString("topic").isNullOrBlank()) getString(R.string.dashboard_active_hint_lessons)
                        else null
                    setHintBand(
                        binding.userDashboardHint,
                        if (showUserHint) dashboardHintCopy() else activeUserHint,
                        if (streak > 0) HintTone.HEALTHY else if (showUserHint) HintTone.NEXT_STEP else HintTone.READY
                    )
                    pulseDashboardValues(
                        binding.userDashboardLessonCount,
                        binding.userDashboardQuizScore,
                        binding.learningQuizPreview
                    )
                    finishUserDashboardRefresh()
                }
                .onFailure {
                    binding.userDashboardLessonCount.text = getString(R.string.lesson_history_count, 0)
                    binding.userDashboardQuizScore.text = getString(
                        R.string.quiz_score_summary,
                        getString(R.string.quiz_score_empty)
                    )
                    binding.learningQuizPreview.text = dashboardActivityEmptyCopy()
                    setHintBand(binding.userDashboardHint, dashboardHintCopy(), HintTone.NEXT_STEP)
                    pulseDashboardValues(
                        binding.userDashboardLessonCount,
                        binding.userDashboardQuizScore,
                        binding.learningQuizPreview
                    )
                    finishUserDashboardRefresh()
                }
            if (currentUserRole == "affiliate") {
                getJson("$serverUrl/affiliate/dashboard", token)
                    .onSuccess { response ->
                        binding.affiliatePromoCode.text = getString(R.string.affiliate_promo_code, response.optString("promoCode").ifBlank { "-" })
                        val earningsValue = response.optDouble("earnings", 0.0) / 100.0
                        binding.affiliateEarnings.text = getString(R.string.affiliate_earnings, String.format(Locale.US, "%.2f", earningsValue))
                        binding.affiliateSignups.text = getString(R.string.affiliate_signups, response.optInt("signups"))
                        binding.affiliatePaidSubs.text = getString(R.string.affiliate_paid_subs, response.optInt("paidSubs"))
                        binding.affiliateWithdrawNote.text = getString(R.string.affiliate_withdraw_note)
                        val showAffiliateHint =
                            response.optString("promoCode").isBlank() &&
                                response.optInt("signups") == 0 &&
                                response.optInt("paidSubs") == 0 &&
                                response.optDouble("earnings", 0.0) == 0.0
                        setHintBand(
                            binding.affiliateDashboardHint,
                            if (showAffiliateHint) getString(R.string.affiliate_hint_empty)
                            else getString(R.string.affiliate_hint_active),
                            if (showAffiliateHint) HintTone.NEXT_STEP else HintTone.HEALTHY
                        )
                        pulseDashboardValues(
                            binding.affiliatePromoCode,
                            binding.affiliateEarnings,
                            binding.affiliateSignups,
                            binding.affiliatePaidSubs
                        )
                        completeSectionRefresh(
                            binding.affiliateDashboardStatus,
                            binding.affiliateDashboardCard,
                            "affiliate"
                        )
                    }
                    .onFailure {
                        binding.affiliatePromoCode.text = getString(R.string.affiliate_promo_code_empty)
                        binding.affiliateEarnings.text = getString(R.string.affiliate_earnings, "0.00")
                        binding.affiliateSignups.text = getString(R.string.affiliate_signups, 0)
                        binding.affiliatePaidSubs.text = getString(R.string.affiliate_paid_subs, 0)
                        binding.affiliateWithdrawNote.text = getString(R.string.affiliate_withdraw_note_empty)
                        setHintBand(binding.affiliateDashboardHint, getString(R.string.affiliate_hint_empty), HintTone.NEXT_STEP)
                        pulseDashboardValues(
                            binding.affiliatePromoCode,
                            binding.affiliateEarnings,
                            binding.affiliateSignups,
                            binding.affiliatePaidSubs
                        )
                        completeSectionRefresh(
                            binding.affiliateDashboardStatus,
                            binding.affiliateDashboardCard,
                            "affiliate"
                        )
                    }
            }
            if (currentUserRole == "admin") {
                getJson("$serverUrl/admin/stats", token)
                    .onSuccess { response ->
                        binding.adminStatsValue.text = getString(
                            R.string.admin_stats_summary,
                            response.optInt("totalUsers"),
                            response.optInt("affiliateCount"),
                            response.optInt("activeToday"),
                            response.optInt("learningLessons")
                        )
                        val showAdminHint =
                            response.optInt("totalUsers") == 0 &&
                                response.optInt("affiliateCount") == 0 &&
                                response.optInt("activeToday") == 0 &&
                                response.optInt("learningLessons") == 0
                        setHintBand(
                            binding.adminDashboardHint,
                            if (showAdminHint) getString(R.string.admin_hint_empty)
                            else getString(R.string.admin_hint_active),
                            if (showAdminHint) HintTone.NEXT_STEP else HintTone.HEALTHY
                        )
                        pulseDashboardValues(binding.adminStatsValue, binding.adminBackendValue)
                        completeSectionRefresh(
                            binding.adminDashboardStatus,
                            binding.adminDashboardCard,
                            "admin"
                        )
                    }
                    .onFailure {
                        binding.adminStatsValue.text = getString(R.string.admin_stats_empty)
                        setHintBand(binding.adminDashboardHint, getString(R.string.admin_hint_empty), HintTone.NEXT_STEP)
                        pulseDashboardValues(binding.adminStatsValue, binding.adminBackendValue)
                        completeSectionRefresh(
                            binding.adminDashboardStatus,
                            binding.adminDashboardCard,
                            "admin"
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

    private fun saveSafetyProfile() {
        val emergencyPersonName = binding.safetyNameInput.text?.toString()?.trim().orEmpty()
        val emergencyBirthday = normalizeBirthdayInput(binding.safetyBirthdayInput.text?.toString()?.trim().orEmpty())
        val emergencyContact = binding.safetyContactInput.text?.toString()?.trim().orEmpty()
        val contactPermission = binding.safetyNotifyTrustedContactSwitch.isChecked
        val comfortStyle = binding.safetyComfortInput.text?.toString()?.trim().orEmpty()
        val groundingStyle = binding.safetyGroundingInput.text?.toString()?.trim().orEmpty()
        val followUpOptIn = binding.safetyFollowUpSwitch.isChecked
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_EMERGENCY_PROFILE_NAME, emergencyPersonName)
            .putString(KEY_EMERGENCY_PROFILE_BIRTHDAY, emergencyBirthday)
            .putString(KEY_EMERGENCY_CONTACT, emergencyContact)
            .putBoolean(KEY_EMERGENCY_CONTACT_PERMISSION, contactPermission)
            .putString(KEY_SAFETY_COMFORT_STYLE, comfortStyle)
            .putString(KEY_SAFETY_GROUNDING_STYLE, groundingStyle)
            .putBoolean(KEY_SAFETY_FOLLOW_UP_OPT_IN, followUpOptIn)
            .apply()
        if (binding.safetyBirthdayInput.text?.toString()?.trim().orEmpty() != emergencyBirthday) {
            binding.safetyBirthdayInput.setText(emergencyBirthday)
        }
        val confirmedName = emergencyPersonName.ifBlank { resolveEmergencyPersonName() }
        val confirmedBirthday = emergencyBirthday.ifBlank { getString(R.string.safety_birthday_unknown) }
        val localSaveReply = getString(R.string.safety_profile_saved_named, confirmedName, confirmedBirthday)
        val token = authToken
        val serverUrl = currentServerUrl()
        if (token.isNullOrBlank() || serverUrl.isBlank()) {
            val reply = getString(R.string.safety_profile_saved_local_only)
            binding.safetyProfileMessage.text = reply
            binding.lastReplyValue.text = localSaveReply
            refreshSafetyDiagnostics()
            speakDex(localSaveReply, R.string.voice_speaking, resumeWakeModeAfterSpeech = false)
            return
        }
        val updates = listOf(
            "safety_person_name" to emergencyPersonName,
            "safety_birthday" to emergencyBirthday,
            "emergency_contact" to emergencyContact,
            "comfort_style" to binding.safetyComfortInput.text?.toString()?.trim().orEmpty(),
            "grounding_preference" to binding.safetyGroundingInput.text?.toString()?.trim().orEmpty(),
            "emergency_contact_permission" to if (contactPermission) "1" else "0",
            "safety_follow_up_opt_in" to if (binding.safetyFollowUpSwitch.isChecked) "1" else "0",
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
            val reply =
                if (failed) {
                    getString(R.string.safety_profile_saved_local_only)
                } else {
                    localSaveReply
                }
            binding.safetyProfileMessage.text = reply
            binding.lastReplyValue.text = localSaveReply
            if (!failed) {
                fetchSafetyPreferences()
            }
            speakDex(localSaveReply, R.string.voice_speaking, resumeWakeModeAfterSpeech = false)
            refreshSafetyDiagnostics()
        }
    }

    private fun testSafetyCheckIn() {
        val reply = getString(R.string.safety_check_in_scheduled)
        DexSafetyCheckInScheduler.scheduleOneTimeCheckIn(
            context = this,
            delayMinutes = 1,
            title = getString(R.string.safety_check_in_title),
            text = buildSafetyCheckInMessage(SAFETY_MOOD_GENERAL, emergency = false),
            voiceCheckIn = true,
            kind = "safety",
            mood = SAFETY_MOOD_GENERAL
        )
        binding.safetyProfileMessage.text = reply
        binding.lastReplyValue.text = reply
        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = false)
        refreshSafetyDiagnostics()
    }

    private fun testEmergencySms() {
        val savedContact = resolveEmergencyTrustedContact()
        val phoneNumber = normalizeSmsPhoneNumber(savedContact)
        if (phoneNumber.isBlank()) {
            val reply = getString(R.string.test_emergency_sms_missing_contact)
            binding.safetyProfileMessage.text = reply
            binding.lastReplyValue.text = reply
            refreshSafetyDiagnostics(lastStatus = reply)
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = false)
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            val reply = getString(R.string.local_emergency_sms_permission_missing)
            binding.safetyProfileMessage.text = reply
            binding.lastReplyValue.text = reply
            refreshSafetyDiagnostics(lastStatus = reply)
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = false)
            return
        }

        val userName = resolveEmergencyPersonName()
        val body = getString(R.string.test_emergency_sms_body, userName)
        val status = sendLocalEmergencySmsWithStatus(
            phoneNumber = phoneNumber,
            smsBody = body,
            startedAt = SystemClock.elapsedRealtime(),
            countForCooldown = false,
            triggerReason = "manual emergency sms test"
        )
        appendActivityLog("Safety", "manual emergency sms test -> $status")
        val reply = getString(R.string.test_emergency_sms_sent)
        binding.safetyProfileMessage.text = reply
        binding.lastReplyValue.text = listOf(reply, status).joinToString(" ")
        refreshSafetyDiagnostics(lastStatus = status, lastTrigger = "manual emergency sms test")
        speakDex(binding.lastReplyValue.text.toString(), R.string.voice_speaking, resumeWakeModeAfterSpeech = false)
    }

    private fun previewEmergencyPlan() {
        val personName = resolveEmergencyPersonName()
        val birthday = resolveEmergencyBirthday()
        val contact = resolveEmergencyTrustedContact()
        val contactAlerts = if (binding.safetyNotifyTrustedContactSwitch.isChecked) {
            getString(R.string.safety_preview_enabled)
        } else {
            getString(R.string.safety_preview_disabled)
        }
        val followUps = if (binding.safetyFollowUpSwitch.isChecked) {
            getString(R.string.safety_preview_enabled)
        } else {
            getString(R.string.safety_preview_disabled)
        }
        val reply = if (contact.isNotBlank()) {
            getString(R.string.safety_emergency_preview_with_contact, personName, birthday, contact, contactAlerts, followUps)
        } else {
            getString(R.string.safety_emergency_preview_without_contact, personName, birthday, contactAlerts, followUps)
        }
        binding.safetyProfileMessage.text = reply
        binding.lastReplyValue.text = reply
        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = false)
    }

    private fun resolveEmergencyPersonName(): String {
        val typedName = if (::binding.isInitialized) {
            binding.safetyNameInput.text?.toString()?.trim().orEmpty()
        } else {
            ""
        }
        if (typedName.isNotBlank()) return typedName
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedName = prefs.getString(KEY_EMERGENCY_PROFILE_NAME, null).orEmpty().trim()
        if (savedName.isNotBlank()) return savedName
        if (currentUserName.isNotBlank()) return currentUserName.trim()
        return getString(R.string.dex_user_fallback_name)
    }

    private fun resolveEmergencyBirthday(): String {
        val typedBirthday = if (::binding.isInitialized) {
            binding.safetyBirthdayInput.text?.toString()?.trim().orEmpty()
        } else {
            ""
        }
        if (typedBirthday.isNotBlank()) return formatBirthdayForSpeech(typedBirthday)
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return formatBirthdayForSpeech(
            prefs.getString(KEY_EMERGENCY_PROFILE_BIRTHDAY, null)
            .orEmpty()
            .trim()
            .ifBlank { getString(R.string.safety_birthday_unknown) }
        )
    }

    private fun normalizeBirthdayInput(value: String): String {
        val trimmed = value.trim()
        if (trimmed.isBlank() || trimmed == getString(R.string.safety_birthday_unknown)) return trimmed
        val digits = trimmed.filter { it.isDigit() }
        if (digits.length == 8 && trimmed.none { it == '/' || it == '-' }) {
            val month = digits.substring(0, 2)
            val day = digits.substring(2, 4)
            val year = digits.substring(4, 8)
            return "$month/$day/$year"
        }
        val numericMatch = Regex("""^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$""").matchEntire(trimmed)
        if (numericMatch != null) {
            val month = numericMatch.groupValues[1].padStart(2, '0')
            val day = numericMatch.groupValues[2].padStart(2, '0')
            val rawYear = numericMatch.groupValues[3]
            val year = if (rawYear.length == 2) "19$rawYear" else rawYear
            return "$month/$day/$year"
        }
        return trimmed
    }

    private fun formatBirthdayForSpeech(value: String): String {
        val trimmed = normalizeBirthdayInput(value)
        if (trimmed.isBlank() || trimmed == getString(R.string.safety_birthday_unknown)) return trimmed
        val numericMatch = Regex("""^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$""").matchEntire(trimmed)
        if (numericMatch != null) {
            val month = numericMatch.groupValues[1].padStart(2, '0')
            val day = numericMatch.groupValues[2].padStart(2, '0')
            val rawYear = numericMatch.groupValues[3]
            val year = if (rawYear.length == 2) "19$rawYear" else rawYear
            return "$month/$day/$year"
        }
        return trimmed.replace(Regex(""",(?=\S)"""), ", ")
    }

    private fun resolveEmergencyTrustedContact(): String {
        val typedContact = if (::binding.isInitialized) {
            binding.safetyContactInput.text?.toString()?.trim().orEmpty()
        } else {
            ""
        }
        if (typedContact.isNotBlank()) return typedContact
        return getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_EMERGENCY_CONTACT, null)
            .orEmpty()
            .trim()
    }

    private fun buildEmergencySpokenReply(baseReply: String? = null): String {
        val assistedPersonName = resolveEmergencyPersonName()
        val reply = baseReply?.trim().orEmpty()
        if (reply.isBlank()) {
            return getString(R.string.local_emergency_reply, assistedPersonName)
        }
        if (reply.contains(assistedPersonName, ignoreCase = true)) {
            return reply
        }
        return "$assistedPersonName, $reply"
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
                    val spokenSegments = buildSpokenLessonSegments(title, body)
                    binding.conversationStatus.text = "Dex is teaching your lesson."
                    binding.lastReplyValue.text = spokenSegments.firstOrNull().orEmpty()
                    speakDexSequence(spokenSegments, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
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
                    val parsedQuestions =
                        buildList {
                            for (i in 0 until (questions?.length() ?: 0)) {
                                val item = questions?.optJSONObject(i) ?: continue
                                add(
                                    QuizQuestion(
                                        question = item.optString("question"),
                                        answer = item.optString("answer"),
                                        explanation = item.optString("explanation")
                                    )
                                )
                            }
                        }
                    if (parsedQuestions.isEmpty()) {
                        binding.learningQuizPreview.text = getString(R.string.learning_quiz_failed)
                    } else {
                        val quizTitle = quiz.optString("title").ifBlank { "Quiz" }
                        restoreWakeEngineAfterQuiz = wakeWordEngineActive
                        if (wakeWordEngineActive) {
                            wakeWordEngine?.stop()
                            wakeWordEngineActive = false
                        }
                        activeQuizSession = QuizSession(quiz = quiz, title = quizTitle, questions = parsedQuestions)
                        binding.conversationStatus.text = "Dex is giving your quiz."
                        binding.lastReplyValue.text = "Quiz ready: $quizTitle"
                        speakDexSequence(
                            listOf(
                                "I built a quiz based on your lesson. $quizTitle.",
                                formatCurrentQuizQuestion(activeQuizSession!!)
                            ),
                            R.string.voice_speaking,
                            resumeWakeModeAfterSpeech = false
                        ) {
                            startQuizAnswerListening()
                        }
                    }
                }
            }.onFailure {
                binding.learningQuizPreview.text = getString(R.string.learning_quiz_failed)
            }
        }
    }

    private fun buildSpokenLesson(title: String, body: String): String {
        val cleaned = body
            .replace("**", "")
            .replace(Regex("[“”]"), "\"")
            .replace(Regex("\\s+"), " ")
            .trim()
        if (cleaned.isBlank()) {
            return getString(R.string.learning_lesson_spoken_title_only, title)
        }
        val intro = "Today's lesson is $title."
        val bodySnippet = cleaned.take(700)
        return "$intro $bodySnippet"
    }

    private fun buildSpokenQuiz(title: String, questions: JSONArray?): String {
        val firstQuestion = questions?.optJSONObject(0)?.optString("question").orEmpty()
        val secondQuestion = questions?.optJSONObject(1)?.optString("question").orEmpty()
        return when {
            firstQuestion.isBlank() -> getString(R.string.learning_quiz_spoken_title_only, title)
            secondQuestion.isBlank() -> "I built a quiz based on your lesson. $title. First question: $firstQuestion"
            else -> "I built a quiz based on your lesson. $title. First question: $firstQuestion Second question: $secondQuestion"
        }
    }

    private fun buildSpokenLessonSegments(title: String, body: String): List<String> {
        val cleaned = body
            .replace("**", "")
            .replace(Regex("[â€œâ€]"), "\"")
            .trim()
        if (cleaned.isBlank()) {
            return listOf(getString(R.string.learning_lesson_spoken_title_only, title))
        }
        val sections =
            cleaned
                .split(Regex("\\n\\s*\\n"))
                .map { it.replace(Regex("\\s+"), " ").trim() }
                .filter { it.isNotBlank() }
                .take(5)
        return buildList {
            add("Today's lesson is $title.")
            addAll(sections)
        }
    }

    private fun formatCurrentQuizQuestion(session: QuizSession): String {
        val question = session.questions.getOrNull(session.currentIndex)?.question.orEmpty()
        return "Question ${session.currentIndex + 1}. $question. Say your answer when you're ready."
    }

    private fun repeatCurrentQuizQuestion() {
        val session = activeQuizSession ?: return
        speakDexSequence(
            listOf("Let's try that question again.", formatCurrentQuizQuestion(session)),
            R.string.voice_speaking,
            resumeWakeModeAfterSpeech = false
        ) {
            startQuizAnswerListening()
        }
    }

    private fun startQuizAnswerListening() {
        val recognizer = speechRecognizer ?: return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            return
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 3500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
        }
        listeningForQuizAnswer = true
        recognizer.cancel()
        recognizer.startListening(intent)
    }

    private fun handleQuizAnswerTranscript(transcript: String) {
        val session = activeQuizSession ?: return
        val answer = transcript.trim()
        if (answer.isBlank()) {
            repeatCurrentQuizQuestion()
            return
        }
        session.answers += answer
        binding.learningQuizPreview.append("\nAnswer ${session.currentIndex + 1}: $answer")
        session.currentIndex += 1
        if (session.currentIndex >= session.questions.size) {
            submitQuizSession(session)
            return
        }
        speakDexSequence(
            listOf("Got it.", formatCurrentQuizQuestion(session)),
            R.string.voice_speaking,
            resumeWakeModeAfterSpeech = false
        ) {
            startQuizAnswerListening()
        }
    }

    private fun submitQuizSession(session: QuizSession) {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            val payload = JSONObject().apply {
                put("quiz", session.quiz)
                put("answers", JSONArray(session.answers))
            }
            val result = postJson("$serverUrl/dex/learning/quiz/submit", payload, token)
            result.onSuccess { response ->
                activeQuizSession = null
                maybeRestoreWakeEngineAfterQuiz()
                val score = response.optInt("score", 0)
                val total = response.optInt("totalQuestions", session.questions.size)
                val percentage = response.optInt("percentage", 0)
                val results = response.optJSONArray("results")
                val missed = results?.let {
                    (0 until it.length())
                        .mapNotNull { index -> it.optJSONObject(index) }
                        .firstOrNull { item -> !item.optBoolean("correct", false) }
                }
                val summary = buildString {
                    append("Quiz complete. You got $score out of $total correct. That's $percentage percent.")
                    missed?.optString("explanation")?.takeIf { it.isNotBlank() }?.let {
                        append(" Here's one thing to remember: $it")
                    }
                }
                binding.learningQuizPreview.append("\n\n$summary")
                binding.lastReplyValue.text = summary
                binding.conversationStatus.text = summary
                speakDex(summary, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                fetchDashboardData()
            }.onFailure {
                activeQuizSession = null
                maybeRestoreWakeEngineAfterQuiz()
                val reply = getString(R.string.learning_quiz_failed)
                binding.learningQuizPreview.append("\n\n$reply")
                binding.lastReplyValue.text = reply
                binding.conversationStatus.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            }
        }
    }

    private fun maybeRestoreWakeEngineAfterQuiz() {
        if (restoreWakeEngineAfterQuiz && wakeModeEnabled) {
            wakeWordEngineActive = wakeWordEngine?.start() == true
        }
        restoreWakeEngineAfterQuiz = false
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

    private fun dexGamesScoreLine(): String {
        return getString(
            R.string.dex_games_score_line,
            dexGamesCorrect,
            dexGamesPlayed,
            dexGamesCurrentStreak,
            dexGamesBestStreak
        )
    }

    private fun favoriteDexMiniGame(): DexMiniGameType? {
        val counts = listOf(
            DexMiniGameType.GUESS_NUMBER to dexGuessPlays,
            DexMiniGameType.RIDDLE to dexRiddlePlays,
            DexMiniGameType.TRIVIA to dexTriviaPlays,
            DexMiniGameType.MEMORY to dexMemoryPlays,
            DexMiniGameType.WOULD_YOU_RATHER to dexWouldYouRatherPlays
        )
        val best = counts.maxByOrNull { it.second } ?: return null
        return if (best.second > 0) best.first else null
    }

    private fun favoriteDexMiniGameLabel(): String? {
        return when (favoriteDexMiniGame()) {
            DexMiniGameType.GUESS_NUMBER -> getString(R.string.dex_games_guess_number)
            DexMiniGameType.RIDDLE -> getString(R.string.dex_games_riddle)
            DexMiniGameType.TRIVIA -> getString(R.string.dex_games_trivia)
            DexMiniGameType.MEMORY -> getString(R.string.dex_games_memory)
            DexMiniGameType.WOULD_YOU_RATHER -> getString(R.string.dex_games_would_you_rather)
            DexMiniGameType.NONE, null -> null
        }
    }

    private fun dexMiniGameLabel(type: DexMiniGameType): String = when (type) {
        DexMiniGameType.GUESS_NUMBER -> getString(R.string.dex_games_guess_number)
        DexMiniGameType.RIDDLE -> getString(R.string.dex_games_riddle)
        DexMiniGameType.TRIVIA -> getString(R.string.dex_games_trivia)
        DexMiniGameType.MEMORY -> getString(R.string.dex_games_memory)
        DexMiniGameType.WOULD_YOU_RATHER -> getString(R.string.dex_games_would_you_rather)
        DexMiniGameType.NONE -> getString(R.string.dex_games_title)
    }

    private fun todaysDexChallengeGame(): DexMiniGameType {
        val rotation = listOf(
            DexMiniGameType.GUESS_NUMBER,
            DexMiniGameType.RIDDLE,
            DexMiniGameType.TRIVIA,
            DexMiniGameType.MEMORY,
            DexMiniGameType.WOULD_YOU_RATHER
        )
        val favoriteOffset = when (favoriteDexMiniGame()) {
            DexMiniGameType.RIDDLE -> 1
            DexMiniGameType.TRIVIA -> 2
            DexMiniGameType.MEMORY -> 3
            DexMiniGameType.WOULD_YOU_RATHER -> 4
            else -> 0
        }
        val index = (LocalDate.now().dayOfYear + favoriteOffset) % rotation.size
        return rotation[index]
    }

    private fun isTodayDexChallengeComplete(): Boolean {
        return dexGamesChallengeCompletedDate == LocalDate.now().toString()
    }

    private fun dexGamesChallengeLine(): String {
        val challengeLabel = dexMiniGameLabel(todaysDexChallengeGame())
        return if (isTodayDexChallengeComplete()) {
            getString(R.string.dex_games_challenge_done, challengeLabel)
        } else {
            getString(R.string.dex_games_challenge_open, challengeLabel)
        }
    }

    private fun dexGamesUnlockTier(level: Int = dexGamesUnlockLevel()): String {
        return when (level) {
            3 -> getString(R.string.dex_games_unlock_tier_legend)
            2 -> getString(R.string.dex_games_unlock_tier_star)
            1 -> getString(R.string.dex_games_unlock_tier_spark)
            else -> getString(R.string.dex_games_unlock_tier_new)
        }
    }

    private fun dexGamesUnlockLevel(): Int {
        return when {
            dexGamesChallengeClears >= 20 -> 3
            dexGamesChallengeClears >= 10 -> 2
            dexGamesChallengeClears >= 5 -> 1
            else -> 0
        }
    }

    private fun dexGamesTierHaloAlpha(accessoryHaloVisible: Boolean): Float {
        if (accessoryHaloVisible) return 1f
        return when (dexGamesUnlockLevel()) {
            3 -> 0.9f
            2 -> 0.62f
            1 -> 0.42f
            else -> 0f
        }
    }

    private fun dexGamesUnlockLine(): String {
        return getString(
            R.string.dex_games_unlock_line,
            dexGamesChallengeClears,
            dexGamesUnlockTier()
        )
    }

    private fun dexGamesUnlockPerkLine(level: Int = dexGamesUnlockLevel()): String {
        return when (level) {
            3 -> getString(R.string.dex_companion_rewards_perk_legend)
            2 -> getString(R.string.dex_companion_rewards_perk_star)
            1 -> getString(R.string.dex_companion_rewards_perk_spark)
            else -> getString(R.string.dex_companion_rewards_perk_new)
        }
    }

    private fun defaultDexCosmetics(): Set<String> = setOf(
        skinCosmeticKey(DEX_COMPANION_SKIN_SKY),
        skinCosmeticKey(DEX_COMPANION_SKIN_MINT),
        accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_NONE),
        faceStyleCosmeticKey(DEX_COMPANION_FACE_CLASSIC),
        bubbleStyleCosmeticKey(DEX_COMPANION_BUBBLE_SOFT)
    )

    private fun skinCosmeticKey(value: String) = "skin:$value"
    private fun accessoryCosmeticKey(value: String) = "accessory:$value"
    private fun faceStyleCosmeticKey(value: String) = "face:$value"
    private fun bubbleStyleCosmeticKey(value: String) = "bubble:$value"

    private fun dexSkinCost(value: String): Int = when (value.lowercase(Locale.US)) {
        DEX_COMPANION_SKIN_SUNSET -> 6
        DEX_COMPANION_SKIN_VIOLET -> 8
        else -> 0
    }

    private fun dexAccessoryCost(value: String): Int = when (value.lowercase(Locale.US)) {
        DEX_COMPANION_ACCESSORY_HEADPHONES -> 4
        DEX_COMPANION_ACCESSORY_GLASSES -> 6
        DEX_COMPANION_ACCESSORY_HALO -> 10
        else -> 0
    }

    private fun dexFaceStyleCost(value: String): Int = when (value.lowercase(Locale.US)) {
        DEX_COMPANION_FACE_WINK -> 3
        DEX_COMPANION_FACE_PIXEL -> 5
        else -> 0
    }

    private fun dexBubbleStyleCost(value: String): Int = when (value.lowercase(Locale.US)) {
        DEX_COMPANION_BUBBLE_GLOW -> 4
        DEX_COMPANION_BUBBLE_BOLD -> 4
        else -> 0
    }

    private fun dexSkinLabel(value: String): String = when (value.lowercase(Locale.US)) {
        DEX_COMPANION_SKIN_MINT -> getString(R.string.dex_companion_skin_mint)
        DEX_COMPANION_SKIN_SUNSET -> getString(R.string.dex_companion_skin_sunset)
        DEX_COMPANION_SKIN_VIOLET -> getString(R.string.dex_companion_skin_violet)
        else -> getString(R.string.dex_companion_skin_sky)
    }

    private fun dexAccessoryLabel(value: String): String = when (value.lowercase(Locale.US)) {
        DEX_COMPANION_ACCESSORY_HEADPHONES -> getString(R.string.dex_companion_accessory_headphones)
        DEX_COMPANION_ACCESSORY_GLASSES -> getString(R.string.dex_companion_accessory_glasses)
        DEX_COMPANION_ACCESSORY_HALO -> getString(R.string.dex_companion_accessory_halo)
        else -> getString(R.string.dex_companion_accessory_none)
    }

    private fun dexFaceStyleLabel(value: String): String = when (value.lowercase(Locale.US)) {
        DEX_COMPANION_FACE_WINK -> getString(R.string.dex_companion_face_style_wink)
        DEX_COMPANION_FACE_PIXEL -> getString(R.string.dex_companion_face_style_pixel)
        else -> getString(R.string.dex_companion_face_style_classic)
    }

    private fun dexBubbleStyleLabel(value: String): String = when (value.lowercase(Locale.US)) {
        DEX_COMPANION_BUBBLE_GLOW -> getString(R.string.dex_companion_bubble_style_glow)
        DEX_COMPANION_BUBBLE_BOLD -> getString(R.string.dex_companion_bubble_style_bold)
        else -> getString(R.string.dex_companion_bubble_style_soft)
    }

    private fun ownedPremiumDexCosmeticsCount(): Int = ownedDexCosmetics.count { it !in defaultDexCosmetics() }

    private fun dexCoinsLine(): String = getString(R.string.dex_coins_line, dexCoins)

    private fun dexDailySpecialKeys(): List<String> = listOf(
        skinCosmeticKey(DEX_COMPANION_SKIN_SUNSET),
        skinCosmeticKey(DEX_COMPANION_SKIN_VIOLET),
        accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_HALO),
        faceStyleCosmeticKey(DEX_COMPANION_FACE_PIXEL),
        bubbleStyleCosmeticKey(DEX_COMPANION_BUBBLE_GLOW),
        "game:${DexMiniGameType.MEMORY.name}",
        "game:${DexMiniGameType.TRIVIA.name}"
    )

    private fun todaysDexShopSpecialKey(): String =
        dexDailySpecialKeys()[LocalDate.now().dayOfYear % dexDailySpecialKeys().size]

    private fun discountedDexCost(key: String, baseCost: Int): Int {
        if (baseCost <= 0) return 0
        val specialKey = todaysDexShopSpecialKey()
        return if (key == specialKey) max(1, baseCost - 1) else baseCost
    }

    private fun todaysDexShopSpecialLine(): String {
        val specialKey = todaysDexShopSpecialKey()
        val (label, cost) = when (specialKey) {
            skinCosmeticKey(DEX_COMPANION_SKIN_SUNSET) ->
                dexSkinLabel(DEX_COMPANION_SKIN_SUNSET) to discountedDexCost(specialKey, dexSkinCost(DEX_COMPANION_SKIN_SUNSET))
            skinCosmeticKey(DEX_COMPANION_SKIN_VIOLET) ->
                dexSkinLabel(DEX_COMPANION_SKIN_VIOLET) to discountedDexCost(specialKey, dexSkinCost(DEX_COMPANION_SKIN_VIOLET))
            accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_HALO) ->
                dexAccessoryLabel(DEX_COMPANION_ACCESSORY_HALO) to discountedDexCost(specialKey, dexAccessoryCost(DEX_COMPANION_ACCESSORY_HALO))
            faceStyleCosmeticKey(DEX_COMPANION_FACE_PIXEL) ->
                dexFaceStyleLabel(DEX_COMPANION_FACE_PIXEL) to discountedDexCost(specialKey, dexFaceStyleCost(DEX_COMPANION_FACE_PIXEL))
            bubbleStyleCosmeticKey(DEX_COMPANION_BUBBLE_GLOW) ->
                dexBubbleStyleLabel(DEX_COMPANION_BUBBLE_GLOW) to discountedDexCost(specialKey, dexBubbleStyleCost(DEX_COMPANION_BUBBLE_GLOW))
            "game:${DexMiniGameType.MEMORY.name}" ->
                dexMiniGameLabel(DexMiniGameType.MEMORY) to discountedDexCost(specialKey, dexMiniGameCost(DexMiniGameType.MEMORY))
            else ->
                dexMiniGameLabel(DexMiniGameType.TRIVIA) to discountedDexCost(specialKey, dexMiniGameCost(DexMiniGameType.TRIVIA))
        }
        return getString(R.string.dex_shop_daily_special, label, cost)
    }

    private fun decorateFeaturedShopItem(key: String, label: String): String {
        return if (key == todaysDexShopSpecialKey()) {
            getString(R.string.dex_shop_best_pick, label)
        } else {
            label
        }
    }

    private fun dexShopOfferLine(): String {
        val cosmeticOffers = listOf(
            Triple(skinCosmeticKey(DEX_COMPANION_SKIN_SUNSET), dexSkinLabel(DEX_COMPANION_SKIN_SUNSET), dexSkinCost(DEX_COMPANION_SKIN_SUNSET)),
            Triple(accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_HALO), dexAccessoryLabel(DEX_COMPANION_ACCESSORY_HALO), dexAccessoryCost(DEX_COMPANION_ACCESSORY_HALO)),
            Triple(faceStyleCosmeticKey(DEX_COMPANION_FACE_PIXEL), dexFaceStyleLabel(DEX_COMPANION_FACE_PIXEL), dexFaceStyleCost(DEX_COMPANION_FACE_PIXEL))
        ).filterNot { ownedDexCosmetics.contains(it.first) }
            .take(2)
            .joinToString(" | ") { (key, label, cost) -> getString(R.string.dex_shop_offer_item, label, discountedDexCost(key, cost)) }
            .ifBlank { getString(R.string.dex_shop_offer_owned_out) }

        val gameOffers = listOf(
            DexMiniGameType.TRIVIA,
            DexMiniGameType.MEMORY,
            DexMiniGameType.WOULD_YOU_RATHER
        ).joinToString(" | ") { type ->
            getString(R.string.dex_shop_offer_item, dexMiniGameLabel(type), discountedDexCost("game:${type.name}", dexMiniGameCost(type)))
        }

        return getString(R.string.dex_shop_offer_line, todaysDexShopSpecialLine(), cosmeticOffers, gameOffers)
    }

    private fun ensureDexCosmeticOwned(key: String, label: String, cost: Int): Boolean {
        val finalCost = discountedDexCost(key, cost)
        if (cost <= 0 || ownedDexCosmetics.contains(key)) return true
        if (dexCoins < finalCost) {
            binding.homeStyleMessage.text =
                getString(R.string.dex_cosmetic_need_coins, label, finalCost, dexCoins)
            setDexCompanionState(
                DEX_COMPANION_STATE_PENDING,
                bubbleOverride = getString(R.string.dex_cosmetic_need_coins_bubble, finalCost),
                revertAfterMs = 2200L
            )
            return false
        }
        dexCoins -= finalCost
        ownedDexCosmetics.add(key)
        saveDexGameStats()
        persistHomeLook()
        binding.homeStyleMessage.text =
            getString(R.string.dex_cosmetic_unlocked, label, finalCost, dexCoins)
        setDexCompanionState(
            DEX_COMPANION_STATE_EXCITED,
            bubbleOverride = shopUnlockBubble(label),
            revertAfterMs = 2200L
        )
        return true
    }

    private fun dexMiniGameCost(type: DexMiniGameType): Int = when (type) {
        DexMiniGameType.TRIVIA -> 2
        DexMiniGameType.MEMORY -> 3
        DexMiniGameType.WOULD_YOU_RATHER -> 1
        else -> 0
    }

    private fun maybeChargeDexGameEntry(type: DexMiniGameType, announce: Boolean): Boolean {
        val cost = discountedDexCost("game:${type.name}", dexMiniGameCost(type))
        if (cost <= 0) return true
        val label = dexMiniGameLabel(type)
        if (dexCoins < cost) {
            val reply = getString(R.string.dex_game_cost_locked, label, cost, dexCoins)
            binding.dexGameStatus.text = dexGamesStatusSummary(reply)
            setDexCompanionState(
                DEX_COMPANION_STATE_PENDING,
                bubbleOverride = getString(R.string.dex_game_cost_locked_bubble, cost),
                revertAfterMs = 2200L
            )
            if (announce) announceDexMiniGameReply(reply)
            return false
        }
        dexCoins -= cost
        saveDexGameStats()
        binding.dexGameStatus.text = dexGamesStatusSummary(
            getString(R.string.dex_game_cost_paid, label, cost, dexCoins)
        )
        setDexCompanionState(
            DEX_COMPANION_STATE_EXCITED,
            bubbleOverride = shopPlayBubble(label),
            revertAfterMs = 1800L
        )
        return true
    }

    private data class DexShopEntry(
        val label: String,
        val detail: String,
        val onSelect: () -> Unit,
    )

    private fun openDexShopDialog() {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.dex_shop_section_title))
            .setMessage(getString(R.string.dex_shop_balance, dexCoins))
            .setItems(
                arrayOf(
                    getString(R.string.dex_shop_section_looks),
                    getString(R.string.dex_shop_section_accessories),
                    getString(R.string.dex_shop_section_play)
                )
            ) { _, which ->
                when (which) {
                    0 -> openDexShopSectionDialog(
                        getString(R.string.dex_shop_section_looks),
                        getString(
                            R.string.dex_shop_section_looks_message,
                            featuredLooksShopItem()
                        ),
                        buildDexShopLooksEntries(),
                        getString(R.string.dex_shop_bubble_looks, featuredLooksShopItem())
                    )
                    1 -> openDexShopSectionDialog(
                        getString(R.string.dex_shop_section_accessories),
                        getString(
                            R.string.dex_shop_section_accessories_message,
                            featuredAccessoriesShopItem()
                        ),
                        buildDexShopAccessoryEntries(),
                        getString(R.string.dex_shop_bubble_accessories, featuredAccessoriesShopItem())
                    )
                    else -> openDexShopSectionDialog(
                        getString(R.string.dex_shop_section_play),
                        getString(
                            R.string.dex_shop_section_play_message,
                            featuredPlayShopItem()
                        ),
                        buildDexShopPlayEntries(),
                        getString(R.string.dex_shop_bubble_play, featuredPlayShopItem())
                    )
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
        setDexCompanionState(
            DEX_COMPANION_STATE_EXCITED,
            bubbleOverride = "Shop is open.",
            revertAfterMs = 1800L
        )
    }

    private fun featuredLooksShopItem(): String {
        val candidates = listOf(
            Triple(skinCosmeticKey(DEX_COMPANION_SKIN_VIOLET), dexSkinLabel(DEX_COMPANION_SKIN_VIOLET), dexSkinCost(DEX_COMPANION_SKIN_VIOLET)),
            Triple(skinCosmeticKey(DEX_COMPANION_SKIN_SUNSET), dexSkinLabel(DEX_COMPANION_SKIN_SUNSET), dexSkinCost(DEX_COMPANION_SKIN_SUNSET)),
            Triple(faceStyleCosmeticKey(DEX_COMPANION_FACE_PIXEL), dexFaceStyleLabel(DEX_COMPANION_FACE_PIXEL), dexFaceStyleCost(DEX_COMPANION_FACE_PIXEL)),
            Triple(bubbleStyleCosmeticKey(DEX_COMPANION_BUBBLE_GLOW), dexBubbleStyleLabel(DEX_COMPANION_BUBBLE_GLOW), dexBubbleStyleCost(DEX_COMPANION_BUBBLE_GLOW))
        )
        val featured = candidates.firstOrNull { !ownedDexCosmetics.contains(it.first) } ?: candidates.first()
        return decorateFeaturedShopItem(
            featured.first,
            "${featured.second} ${discountedDexCost(featured.first, featured.third)}c"
        )
    }

    private fun featuredAccessoriesShopItem(): String {
        val candidates = listOf(
            Triple(accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_HALO), dexAccessoryLabel(DEX_COMPANION_ACCESSORY_HALO), dexAccessoryCost(DEX_COMPANION_ACCESSORY_HALO)),
            Triple(accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_GLASSES), dexAccessoryLabel(DEX_COMPANION_ACCESSORY_GLASSES), dexAccessoryCost(DEX_COMPANION_ACCESSORY_GLASSES)),
            Triple(accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_HEADPHONES), dexAccessoryLabel(DEX_COMPANION_ACCESSORY_HEADPHONES), dexAccessoryCost(DEX_COMPANION_ACCESSORY_HEADPHONES))
        )
        val featured = candidates.firstOrNull { !ownedDexCosmetics.contains(it.first) } ?: candidates.first()
        return decorateFeaturedShopItem(
            featured.first,
            "${featured.second} ${discountedDexCost(featured.first, featured.third)}c"
        )
    }

    private fun featuredPlayShopItem(): String {
        val candidates = listOf(
            DexMiniGameType.MEMORY,
            DexMiniGameType.TRIVIA,
            DexMiniGameType.WOULD_YOU_RATHER
        )
        val favorite = favoriteDexMiniGame()
        val featured = candidates.firstOrNull { it != favorite } ?: candidates.first()
        val featuredKey = "game:${featured.name}"
        return decorateFeaturedShopItem(
            featuredKey,
            "${dexMiniGameLabel(featured)} ${discountedDexCost(featuredKey, dexMiniGameCost(featured))}c"
        )
    }

    private fun openDexShopSectionDialog(
        title: String,
        message: String,
        entries: List<DexShopEntry>,
        bubble: String,
    ) {
        val labels = entries.map { "${it.label}\n${it.detail}" }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage("${getString(R.string.dex_shop_balance, dexCoins)}\n\n$message")
            .setItems(labels) { _, which ->
                entries.getOrNull(which)?.onSelect?.invoke()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
        setDexCompanionState(
            DEX_COMPANION_STATE_TALKING,
            bubbleOverride = bubble,
            revertAfterMs = 2200L
        )
    }

    private fun buildDexShopLooksEntries(): List<DexShopEntry> {
        val entries = mutableListOf<DexShopEntry>()
        entries += cosmeticShopEntry(
            label = dexSkinLabel(DEX_COMPANION_SKIN_SUNSET),
            key = skinCosmeticKey(DEX_COMPANION_SKIN_SUNSET),
            cost = dexSkinCost(DEX_COMPANION_SKIN_SUNSET)
        ) {
            currentDexCompanionSkin = DEX_COMPANION_SKIN_SUNSET
        }
        entries += cosmeticShopEntry(
            label = dexSkinLabel(DEX_COMPANION_SKIN_VIOLET),
            key = skinCosmeticKey(DEX_COMPANION_SKIN_VIOLET),
            cost = dexSkinCost(DEX_COMPANION_SKIN_VIOLET)
        ) {
            currentDexCompanionSkin = DEX_COMPANION_SKIN_VIOLET
        }
        entries += cosmeticShopEntry(
            label = dexFaceStyleLabel(DEX_COMPANION_FACE_PIXEL),
            key = faceStyleCosmeticKey(DEX_COMPANION_FACE_PIXEL),
            cost = dexFaceStyleCost(DEX_COMPANION_FACE_PIXEL)
        ) {
            currentDexCompanionFaceStyle = DEX_COMPANION_FACE_PIXEL
        }
        entries += cosmeticShopEntry(
            label = dexBubbleStyleLabel(DEX_COMPANION_BUBBLE_GLOW),
            key = bubbleStyleCosmeticKey(DEX_COMPANION_BUBBLE_GLOW),
            cost = dexBubbleStyleCost(DEX_COMPANION_BUBBLE_GLOW)
        ) {
            currentDexCompanionBubbleStyle = DEX_COMPANION_BUBBLE_GLOW
        }
        entries += cosmeticShopEntry(
            label = dexBubbleStyleLabel(DEX_COMPANION_BUBBLE_BOLD),
            key = bubbleStyleCosmeticKey(DEX_COMPANION_BUBBLE_BOLD),
            cost = dexBubbleStyleCost(DEX_COMPANION_BUBBLE_BOLD)
        ) {
            currentDexCompanionBubbleStyle = DEX_COMPANION_BUBBLE_BOLD
        }
        return entries
    }

    private fun buildDexShopAccessoryEntries(): List<DexShopEntry> = listOf(
        cosmeticShopEntry(
            label = dexAccessoryLabel(DEX_COMPANION_ACCESSORY_HEADPHONES),
            key = accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_HEADPHONES),
            cost = dexAccessoryCost(DEX_COMPANION_ACCESSORY_HEADPHONES)
        ) {
            currentDexCompanionAccessory = DEX_COMPANION_ACCESSORY_HEADPHONES
        },
        cosmeticShopEntry(
            label = dexAccessoryLabel(DEX_COMPANION_ACCESSORY_GLASSES),
            key = accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_GLASSES),
            cost = dexAccessoryCost(DEX_COMPANION_ACCESSORY_GLASSES)
        ) {
            currentDexCompanionAccessory = DEX_COMPANION_ACCESSORY_GLASSES
        },
        cosmeticShopEntry(
            label = dexAccessoryLabel(DEX_COMPANION_ACCESSORY_HALO),
            key = accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_HALO),
            cost = dexAccessoryCost(DEX_COMPANION_ACCESSORY_HALO)
        ) {
            currentDexCompanionAccessory = DEX_COMPANION_ACCESSORY_HALO
        }
    )

    private fun buildDexShopPlayEntries(): List<DexShopEntry> = listOf(
        gameShopEntry(DexMiniGameType.TRIVIA) { startTriviaGame() },
        gameShopEntry(DexMiniGameType.MEMORY) { startMemoryGame() },
        gameShopEntry(DexMiniGameType.WOULD_YOU_RATHER) { startWouldYouRatherGame() }
    )

    private fun cosmeticShopEntry(
        label: String,
        key: String,
        cost: Int,
        equip: () -> Unit,
    ): DexShopEntry {
        val owned = ownedDexCosmetics.contains(key)
        val finalCost = discountedDexCost(key, cost)
        val baseDetail = if (owned) {
            getString(R.string.dex_shop_equip_suffix)
        } else {
            getString(R.string.dex_shop_buy_suffix, finalCost)
        }
        val detail = decorateShopDetail(baseDetail, cosmeticShopHint(key))
        return DexShopEntry(label, detail) {
            if (!ensureDexCosmeticOwned(key, label, cost)) return@DexShopEntry
            equip()
            updateDexCompanionControls()
            applyDexCompanionUi()
            persistHomeLook()
            if (owned) {
                binding.homeStyleMessage.text = "$label equipped."
                setDexCompanionState(
                    DEX_COMPANION_STATE_EXCITED,
                    bubbleOverride = shopEquipBubble(label),
                    revertAfterMs = 1800L
                )
            }
        }
    }

    private fun shopUnlockBubble(label: String): String {
        return getString(R.string.dex_shop_bubble_unlocked, label)
    }

    private fun shopEquipBubble(label: String): String {
        return getString(R.string.dex_shop_bubble_equipped, label)
    }

    private fun shopPlayBubble(label: String): String {
        return getString(R.string.dex_shop_bubble_play_bought, label)
    }

    private fun gameShopEntry(type: DexMiniGameType, start: () -> Unit): DexShopEntry {
        val label = dexMiniGameLabel(type)
        val cost = discountedDexCost("game:${type.name}", dexMiniGameCost(type))
        val baseDetail = getString(R.string.dex_shop_play_suffix, cost)
        val detail = decorateShopDetail(
            baseDetail,
            when {
                favoriteDexMiniGame() == type -> getString(R.string.dex_shop_hint_your_favorite)
                todaysDexChallengeGame() == type -> getString(R.string.dex_shop_hint_challenge_pick)
                else -> null
            }
        )
        return DexShopEntry(label, detail) {
            start()
        }
    }

    private fun decorateShopDetail(baseDetail: String, hint: String?): String {
        return if (hint.isNullOrBlank()) baseDetail
        else getString(R.string.dex_shop_hint_format, baseDetail, hint)
    }

    private fun cosmeticShopHint(key: String): String? {
        val personality = currentDexCompanionPersonality.lowercase(Locale.US)
        return when {
            key == accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_HALO) &&
                personality == DEX_COMPANION_PERSONALITY_GUARDIAN ->
                getString(R.string.dex_shop_hint_matches_your_vibe)
            key == accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_HEADPHONES) &&
                personality == DEX_COMPANION_PERSONALITY_STUDY_BUDDY ->
                getString(R.string.dex_shop_hint_matches_your_vibe)
            key == accessoryCosmeticKey(DEX_COMPANION_ACCESSORY_GLASSES) &&
                personality == DEX_COMPANION_PERSONALITY_BESTIE ->
                getString(R.string.dex_shop_hint_matches_your_vibe)
            key == bubbleStyleCosmeticKey(DEX_COMPANION_BUBBLE_BOLD) &&
                personality == DEX_COMPANION_PERSONALITY_COACH ->
                getString(R.string.dex_shop_hint_matches_your_vibe)
            else -> null
        }
    }

    private fun dexCompanionShelfBadge(level: Int): String {
        val tier = dexGamesUnlockTier(level)
        return when {
            dexCompanionRewardsPreviewLevel == level ->
                getString(R.string.dex_companion_rewards_shelf_preview, tier)
            currentDexCompanionTierStyleOverride == level ->
                getString(R.string.dex_companion_rewards_shelf_pinned, tier)
            dexGamesUnlockLevel() >= level ->
                getString(R.string.dex_companion_rewards_shelf_ready, tier)
            else ->
                getString(R.string.dex_companion_rewards_shelf_locked, tier)
        }
    }

    private fun dexCompanionRewardsShelfLine(): String {
        return getString(
            R.string.dex_companion_rewards_shelf_line,
            dexCompanionShelfBadge(1),
            dexCompanionShelfBadge(2),
            dexCompanionShelfBadge(3)
        )
    }

    private fun dexCompanionRewardsBodyText(): String {
        val favorite = favoriteDexMiniGameLabel()
            ?: getString(R.string.dex_companion_rewards_favorite_none)
        val previewLevel = dexCompanionRewardsPreviewLevel
        val styleLine = currentDexCompanionTierStyleOverride?.let {
            if (it == dexGamesUnlockLevel()) {
                getString(R.string.dex_companion_rewards_style_pinned_live, dexGamesUnlockTier(it))
            } else {
                getString(R.string.dex_companion_rewards_style_pinned, dexGamesUnlockTier(it))
            }
        } ?: getString(R.string.dex_companion_rewards_style_live)
        val body = if (previewLevel == null) {
            getString(
                R.string.dex_companion_rewards_value,
                dexGamesUnlockTier(),
                styleLine,
                dexGamesUnlockPerkLine(),
                dexGamesChallengeClears,
                favorite
            )
        } else {
            getString(
                R.string.dex_companion_rewards_value_preview,
                dexGamesUnlockTier(),
                dexGamesUnlockTier(previewLevel),
                dexGamesUnlockPerkLine(previewLevel),
                dexGamesChallengeClears,
                favorite
            )
        }
        return "$body\n${dexCoinsLine()}\n${getString(R.string.dex_companion_rewards_owned_line, ownedPremiumDexCosmeticsCount())}\n${dexShopOfferLine()}"
    }

    private fun dexCompanionRewardsSummary(): CharSequence {
        val builder = SpannableStringBuilder()
        builder.append(dexCompanionRewardsBodyText())
        builder.append('\n')
        appendDexCompanionRewardShelf(builder)
        builder.append('\n')
        val hintStart = builder.length
        builder.append(getString(R.string.dex_companion_rewards_tap_hint))
        builder.setSpan(
            ForegroundColorSpan(getColorCompat(R.color.dex_text_secondary)),
            hintStart,
            builder.length,
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
        )
        return builder
    }

    private fun appendDexCompanionRewardShelf(builder: SpannableStringBuilder) {
        val labelStart = builder.length
        builder.append("Shelf:")
        builder.setSpan(
            ForegroundColorSpan(getColorCompat(R.color.dex_text_secondary)),
            labelStart,
            builder.length,
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
        )
        builder.append(' ')
        appendDexCompanionRewardBadge(builder, 1)
        builder.append(' ')
        appendDexCompanionRewardBadge(builder, 2)
        builder.append(' ')
        appendDexCompanionRewardBadge(builder, 3)
    }

    private fun appendDexCompanionRewardBadge(builder: SpannableStringBuilder, level: Int) {
        val badgeText = dexCompanionShelfBadge(level)
        val (fgColor, bgColor) = when {
            dexCompanionRecentUnlockLevel == level ->
                android.graphics.Color.WHITE to android.graphics.Color.parseColor("#F59E0B")
            dexCompanionRewardsPreviewLevel == level ->
                android.graphics.Color.WHITE to android.graphics.Color.parseColor("#5B7CFF")
            currentDexCompanionTierStyleOverride == level ->
                android.graphics.Color.WHITE to android.graphics.Color.parseColor("#8B5CF6")
            dexGamesUnlockLevel() >= level ->
                android.graphics.Color.parseColor("#0F172A") to android.graphics.Color.parseColor("#8FE3B0")
            else ->
                android.graphics.Color.parseColor("#C7D2E4") to android.graphics.Color.parseColor("#334155")
        }
        val start = builder.length
        builder.append(badgeText)
        builder.setSpan(StyleSpan(Typeface.BOLD), start, builder.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        builder.setSpan(ForegroundColorSpan(fgColor), start, builder.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        builder.setSpan(BackgroundColorSpan(bgColor), start, builder.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }

    private fun celebrateDexCompanionRewardUnlock(level: Int) {
        dexCompanionRecentUnlockLevel = level
        mainHandler.removeCallbacks(dexCompanionRecentUnlockResetRunnable)
        mainHandler.postDelayed(dexCompanionRecentUnlockResetRunnable, 3600L)
    }

    private fun cycleDexCompanionRewardsPreview() {
        dexCompanionRewardsPreviewLevel = when (dexCompanionRewardsPreviewLevel) {
            null -> 0
            0 -> 1
            1 -> 2
            2 -> 3
            else -> null
        }
        val previewLevel = dexCompanionRewardsPreviewLevel
        val bubble = if (previewLevel == null) {
            getString(R.string.dex_companion_rewards_preview_live, dexGamesUnlockTier())
        } else {
            getString(R.string.dex_companion_rewards_preview_switched, dexGamesUnlockTier(previewLevel))
        }
        updateDexCompanionControls()
        applyDexCompanionUi()
        setDexCompanionState(
            DEX_COMPANION_STATE_EXCITED,
            bubbleOverride = bubble,
            revertAfterMs = 2200L
        )
    }

    private fun pinDexCompanionRewardsLook() {
        val previewLevel = dexCompanionRewardsPreviewLevel
        val unlockedLevel = dexGamesUnlockLevel()
        val bubble = when {
            previewLevel == null && currentDexCompanionTierStyleOverride != null -> {
                currentDexCompanionTierStyleOverride = null
                getString(R.string.dex_companion_rewards_pin_cleared)
            }
            previewLevel == null -> {
                currentDexCompanionTierStyleOverride = null
                getString(R.string.dex_companion_rewards_pin_cleared)
            }
            previewLevel > unlockedLevel -> {
                getString(R.string.dex_companion_rewards_pin_locked, dexGamesUnlockTier(previewLevel))
            }
            else -> {
                currentDexCompanionTierStyleOverride =
                    if (previewLevel == unlockedLevel) null else previewLevel
                getString(R.string.dex_companion_rewards_pin_saved, dexGamesUnlockTier(previewLevel))
            }
        }
        updateDexCompanionControls()
        applyDexCompanionUi()
        persistHomeLook()
        setDexCompanionState(
            DEX_COMPANION_STATE_EXCITED,
            bubbleOverride = bubble,
            revertAfterMs = 2400L
        )
    }

    private fun refreshDexCompanionRewardsPanel(unlockCelebration: Boolean = false) {
        updateDexCompanionControls()
        applyDexCompanionUi()
        if (!unlockCelebration || binding.dexCompanionRewardsValue.visibility != View.VISIBLE) return
        binding.dexCompanionRewardsValue.animate().cancel()
        binding.dexCompanionRewardsValue.scaleX = 1f
        binding.dexCompanionRewardsValue.scaleY = 1f
        binding.dexCompanionRewardsValue.alpha = 1f
        val pulseUpX = ObjectAnimator.ofFloat(binding.dexCompanionRewardsValue, View.SCALE_X, 1f, 1.04f)
        val pulseUpY = ObjectAnimator.ofFloat(binding.dexCompanionRewardsValue, View.SCALE_Y, 1f, 1.04f)
        val pulseFade = ObjectAnimator.ofFloat(binding.dexCompanionRewardsValue, View.ALPHA, 1f, 0.94f, 1f)
        val pulseDownX = ObjectAnimator.ofFloat(binding.dexCompanionRewardsValue, View.SCALE_X, 1.04f, 1f)
        val pulseDownY = ObjectAnimator.ofFloat(binding.dexCompanionRewardsValue, View.SCALE_Y, 1.04f, 1f)
        AnimatorSet().apply {
            playTogether(pulseUpX, pulseUpY, pulseFade)
            duration = 190L
            play(pulseDownX).with(pulseDownY).after(pulseUpX)
            start()
        }
    }

    private fun dexGamesProfileLine(): String {
        val favorite = favoriteDexMiniGameLabel()
        return if (favorite.isNullOrBlank()) {
            getString(R.string.dex_games_profile_line_default)
        } else {
            getString(R.string.dex_games_profile_line_favorite, favorite)
        }
    }

    private fun dexGamesStatusSummary(base: String): String {
        return "$base\n${dexCoinsLine()}\n${dexGamesScoreLine()}\n${dexGamesProfileLine()}\n${dexGamesChallengeLine()}\n${dexGamesUnlockLine()}"
    }

    private fun saveDexGameStats() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putInt(KEY_DEX_GAMES_PLAYED, dexGamesPlayed)
            .putInt(KEY_DEX_GAMES_CORRECT, dexGamesCorrect)
            .putInt(KEY_DEX_GAMES_STREAK, dexGamesCurrentStreak)
            .putInt(KEY_DEX_GAMES_BEST_STREAK, dexGamesBestStreak)
            .putInt(KEY_DEX_GAMES_GUESS_PLAYS, dexGuessPlays)
            .putInt(KEY_DEX_GAMES_RIDDLE_PLAYS, dexRiddlePlays)
            .putInt(KEY_DEX_GAMES_TRIVIA_PLAYS, dexTriviaPlays)
            .putInt(KEY_DEX_GAMES_MEMORY_PLAYS, dexMemoryPlays)
            .putInt(KEY_DEX_GAMES_WYR_PLAYS, dexWouldYouRatherPlays)
            .putString(KEY_DEX_GAMES_CHALLENGE_DONE_DATE, dexGamesChallengeCompletedDate)
            .putInt(KEY_DEX_GAMES_CHALLENGE_CLEARS, dexGamesChallengeClears)
            .putInt(KEY_DEX_COINS, dexCoins)
            .putStringSet(KEY_DEX_COMPANION_OWNED_COSMETICS, ownedDexCosmetics)
            .apply()
    }

    private fun recordDexMiniGameStart(type: DexMiniGameType) {
        when (type) {
            DexMiniGameType.GUESS_NUMBER -> dexGuessPlays += 1
            DexMiniGameType.RIDDLE -> dexRiddlePlays += 1
            DexMiniGameType.TRIVIA -> dexTriviaPlays += 1
            DexMiniGameType.MEMORY -> dexMemoryPlays += 1
            DexMiniGameType.WOULD_YOU_RATHER -> dexWouldYouRatherPlays += 1
            DexMiniGameType.NONE -> Unit
        }
        saveDexGameStats()
    }

    private fun dexGamesChallengeRewardLine(type: DexMiniGameType): String {
        val label = dexMiniGameLabel(type)
        return if (dexGamesCurrentStreak > 1) {
            getString(R.string.dex_games_challenge_reward_streak, label, dexGamesCurrentStreak)
        } else {
            getString(R.string.dex_games_challenge_reward, label)
        }
    }

    private fun dexGamesUnlockRewardLine(): String? {
        return when (dexGamesChallengeClears) {
            5 -> getString(R.string.dex_games_unlock_reward, getString(R.string.dex_games_unlock_tier_spark))
            10 -> getString(R.string.dex_games_unlock_reward, getString(R.string.dex_games_unlock_tier_star))
            20 -> getString(R.string.dex_games_unlock_reward, getString(R.string.dex_games_unlock_tier_legend))
            else -> null
        }
    }

    private fun dexGamesUnlockBubbleLine(): String? {
        return when (dexGamesChallengeClears) {
            5 -> getString(R.string.dex_games_unlock_bubble_spark)
            10 -> getString(R.string.dex_games_unlock_bubble_star)
            20 -> getString(R.string.dex_games_unlock_bubble_legend)
            else -> null
        }
    }

    private fun recordDexChallengeCompletion(type: DexMiniGameType): DexChallengeReward? {
        if (type != todaysDexChallengeGame() || isTodayDexChallengeComplete()) return null
        dexGamesChallengeCompletedDate = LocalDate.now().toString()
        dexGamesChallengeClears += 1
        dexCoins += 5
        saveDexGameStats()
        val unlockedLevel = dexGamesUnlockLevel()
        if (dexGamesUnlockBubbleLine() != null) {
            celebrateDexCompanionRewardUnlock(unlockedLevel)
        }
        return DexChallengeReward(
            reply = listOfNotNull(
            dexGamesChallengeRewardLine(type),
            getString(R.string.dex_coins_earned_challenge, 5, dexCoins),
            dexGamesUnlockRewardLine()
            ).joinToString(" "),
            bubble = dexGamesUnlockBubbleLine()
        )
    }

    private fun recordDexGameResult(correct: Boolean, countsAsScoredRound: Boolean = true) {
        dexGamesPlayed += 1
        if (countsAsScoredRound && correct) {
            dexGamesCorrect += 1
            dexGamesCurrentStreak += 1
            dexGamesBestStreak = max(dexGamesBestStreak, dexGamesCurrentStreak)
            dexCoins += 2
        } else if (correct) {
            dexCoins += 1
        } else if (countsAsScoredRound) {
            dexGamesCurrentStreak = 0
        }
        saveDexGameStats()
    }

    private fun breakDexGameStreak() {
        if (dexGamesCurrentStreak == 0) return
        dexGamesCurrentStreak = 0
        saveDexGameStats()
    }

    private fun startGuessNumberGame(announce: Boolean = false) {
        activeDexMiniGame = DexMiniGameType.GUESS_NUMBER
        recordDexMiniGameStart(DexMiniGameType.GUESS_NUMBER)
        dexGuessTarget = (1..20).random()
        dexGuessAttempts = 0
        binding.dexGameInput.setText("")
        val prompt = getString(R.string.dex_game_guess_prompt)
        val status = dexGamesStatusSummary(getString(R.string.dex_game_guess_status))
        binding.dexGamePrompt.text = prompt
        binding.dexGameStatus.text = status
        binding.submitDexGameAnswerButton.text = getString(R.string.dex_game_submit)
        binding.nextDexGameRoundButton.text = getString(R.string.dex_game_new_round)
        setDexCompanionState(
            DEX_COMPANION_STATE_EXCITED,
            bubbleOverride = getString(R.string.dex_game_guess_bubble),
            revertAfterMs = 2600L
        )
        if (announce) {
            announceDexMiniGameReply(prompt)
        }
    }

    private fun startRiddleGame(announce: Boolean = false) {
        activeDexMiniGame = DexMiniGameType.RIDDLE
        recordDexMiniGameStart(DexMiniGameType.RIDDLE)
        currentRiddleIndex = (currentRiddleIndex + 1).mod(DEX_RIDDLES.size)
        val riddle = DEX_RIDDLES[currentRiddleIndex]
        binding.dexGameInput.setText("")
        binding.dexGamePrompt.text = riddle.prompt
        binding.dexGameStatus.text = dexGamesStatusSummary(getString(R.string.dex_game_riddle_status))
        binding.submitDexGameAnswerButton.text = getString(R.string.dex_game_submit)
        binding.nextDexGameRoundButton.text = getString(R.string.dex_game_next_riddle)
        setDexCompanionState(
            DEX_COMPANION_STATE_THINKING,
            bubbleOverride = getString(R.string.dex_game_riddle_bubble),
            revertAfterMs = 2600L
        )
        if (announce) {
            announceDexMiniGameReply(riddle.prompt)
        }
    }

    private fun startTriviaGame(announce: Boolean = false) {
        if (!maybeChargeDexGameEntry(DexMiniGameType.TRIVIA, announce)) return
        activeDexMiniGame = DexMiniGameType.TRIVIA
        recordDexMiniGameStart(DexMiniGameType.TRIVIA)
        currentTriviaIndex = (currentTriviaIndex + 1).mod(DEX_TRIVIA_QUESTIONS.size)
        val trivia = DEX_TRIVIA_QUESTIONS[currentTriviaIndex]
        binding.dexGameInput.setText("")
        binding.dexGamePrompt.text = trivia.prompt
        binding.dexGameStatus.text = dexGamesStatusSummary(getString(R.string.dex_game_trivia_status))
        binding.submitDexGameAnswerButton.text = getString(R.string.dex_game_submit)
        binding.nextDexGameRoundButton.text = getString(R.string.dex_game_next_trivia)
        setDexCompanionState(
            DEX_COMPANION_STATE_THINKING,
            bubbleOverride = getString(R.string.dex_game_trivia_bubble),
            revertAfterMs = 2600L
        )
        if (announce) {
            announceDexMiniGameReply(trivia.prompt)
        }
    }

    private fun startMemoryGame(announce: Boolean = false) {
        if (!maybeChargeDexGameEntry(DexMiniGameType.MEMORY, announce)) return
        val continuing = activeDexMiniGame == DexMiniGameType.MEMORY && currentMemoryRound > 0
        activeDexMiniGame = DexMiniGameType.MEMORY
        recordDexMiniGameStart(DexMiniGameType.MEMORY)
        currentMemoryRound = if (continuing) currentMemoryRound + 1 else 1
        val sequenceLength = minOf(2 + currentMemoryRound, 5)
        currentMemorySequence = List(sequenceLength) {
            DEX_MEMORY_TOKENS.random()
        }
        val prompt = getString(R.string.dex_game_memory_prompt, currentMemorySequence.joinToString(", "))
        binding.dexGameInput.setText("")
        binding.dexGamePrompt.text = prompt
        binding.dexGameStatus.text = dexGamesStatusSummary(getString(R.string.dex_game_memory_status, currentMemoryRound))
        binding.submitDexGameAnswerButton.text = getString(R.string.dex_game_submit)
        binding.nextDexGameRoundButton.text = getString(R.string.dex_game_next_memory)
        setDexCompanionState(
            DEX_COMPANION_STATE_THINKING,
            bubbleOverride = getString(R.string.dex_game_memory_bubble),
            revertAfterMs = 2600L
        )
        if (announce) {
            announceDexMiniGameReply(prompt)
        }
    }

    private fun startWouldYouRatherGame(announce: Boolean = false) {
        if (!maybeChargeDexGameEntry(DexMiniGameType.WOULD_YOU_RATHER, announce)) return
        activeDexMiniGame = DexMiniGameType.WOULD_YOU_RATHER
        recordDexMiniGameStart(DexMiniGameType.WOULD_YOU_RATHER)
        currentWouldYouRatherIndex = (currentWouldYouRatherIndex + 1).mod(DEX_WOULD_YOU_RATHERS.size)
        val round = DEX_WOULD_YOU_RATHERS[currentWouldYouRatherIndex]
        binding.dexGameInput.setText("")
        binding.dexGamePrompt.text = round.prompt
        binding.dexGameStatus.text = dexGamesStatusSummary(getString(R.string.dex_game_wyr_status))
        binding.submitDexGameAnswerButton.text = getString(R.string.dex_game_share_answer)
        binding.nextDexGameRoundButton.text = getString(R.string.dex_game_next_round)
        setDexCompanionState(
            DEX_COMPANION_STATE_EXCITED,
            bubbleOverride = getString(R.string.dex_game_wyr_bubble),
            revertAfterMs = 2600L
        )
        if (announce) {
            announceDexMiniGameReply(round.prompt)
        }
    }

    private fun submitDexGameAnswer(answerOverride: String? = null, announce: Boolean = false) {
        val answer = answerOverride?.trim().orEmpty().ifBlank {
            binding.dexGameInput.text?.toString()?.trim().orEmpty()
        }
        if (activeDexMiniGame == DexMiniGameType.NONE) {
            val reply = getString(R.string.dex_game_pick_one_first)
            binding.dexGameStatus.text = reply
            if (announce) announceDexMiniGameReply(reply)
            return
        }
        if (answer.isBlank()) {
            val reply = getString(R.string.dex_game_answer_needed)
            binding.dexGameStatus.text = reply
            if (announce) announceDexMiniGameReply(reply)
            return
        }
        when (activeDexMiniGame) {
            DexMiniGameType.GUESS_NUMBER -> handleGuessNumberAnswer(answer, announce)
            DexMiniGameType.RIDDLE -> handleRiddleAnswer(answer, announce)
            DexMiniGameType.TRIVIA -> handleTriviaAnswer(answer, announce)
            DexMiniGameType.MEMORY -> handleMemoryAnswer(answer, announce)
            DexMiniGameType.WOULD_YOU_RATHER -> handleWouldYouRatherAnswer(answer, announce)
            DexMiniGameType.NONE -> Unit
        }
    }

    private fun playNextDexMiniGameRound(announce: Boolean = false) {
        when (activeDexMiniGame) {
            DexMiniGameType.GUESS_NUMBER -> startGuessNumberGame(announce)
            DexMiniGameType.RIDDLE -> startRiddleGame(announce)
            DexMiniGameType.TRIVIA -> startTriviaGame(announce)
            DexMiniGameType.MEMORY -> startMemoryGame(announce)
            DexMiniGameType.WOULD_YOU_RATHER -> startWouldYouRatherGame(announce)
            DexMiniGameType.NONE -> {
                val reply = getString(R.string.dex_game_pick_one_first)
                binding.dexGameStatus.text = reply
                if (announce) announceDexMiniGameReply(reply)
            }
        }
    }

    private fun handleGuessNumberAnswer(answer: String, announce: Boolean = false) {
        val guess = answer.toIntOrNull()
            ?: Regex("(\\d{1,2})").find(answer)?.groupValues?.getOrNull(1)?.toIntOrNull()
        if (guess == null) {
            val reply = getString(R.string.dex_game_guess_number_needed)
            binding.dexGameStatus.text = reply
            if (announce) announceDexMiniGameReply(reply)
            return
        }
        dexGuessAttempts += 1
        val baseReply = when {
            guess < dexGuessTarget -> getString(R.string.dex_game_guess_low, dexGuessAttempts)
            guess > dexGuessTarget -> getString(R.string.dex_game_guess_high, dexGuessAttempts)
            else -> getString(R.string.dex_game_guess_correct, dexGuessAttempts)
        }
        val reward = if (guess == dexGuessTarget) {
            recordDexGameResult(correct = true)
            recordDexChallengeCompletion(DexMiniGameType.GUESS_NUMBER)
        } else null
        val reply = listOfNotNull(baseReply, reward?.reply).joinToString(" ")
        binding.dexGameStatus.text = dexGamesStatusSummary(reply)
        refreshDexCompanionRewardsPanel(unlockCelebration = reward?.bubble != null)
        binding.dexGameInput.setText("")
        setDexCompanionState(
            if (guess == dexGuessTarget) DEX_COMPANION_STATE_EXCITED else DEX_COMPANION_STATE_TALKING,
            bubbleOverride = reward?.bubble ?: reply,
            revertAfterMs = 2600L
        )
        if (announce) announceDexMiniGameReply(reply)
    }

    private fun handleRiddleAnswer(answer: String, announce: Boolean = false) {
        val riddle = DEX_RIDDLES.getOrNull(currentRiddleIndex) ?: return
        val normalized = answer.lowercase(Locale.US).trim()
        val isCorrect = normalized.contains(riddle.answer.lowercase(Locale.US))
        val baseReply = if (isCorrect) {
            getString(R.string.dex_game_riddle_correct, riddle.answer)
        } else {
            getString(R.string.dex_game_riddle_try_again)
        }
        val reward = if (isCorrect) {
            recordDexGameResult(correct = true)
            recordDexChallengeCompletion(DexMiniGameType.RIDDLE)
        } else {
            breakDexGameStreak()
            null
        }
        val reply = listOfNotNull(baseReply, reward?.reply).joinToString(" ")
        binding.dexGameStatus.text = dexGamesStatusSummary(reply)
        refreshDexCompanionRewardsPanel(unlockCelebration = reward?.bubble != null)
        if (isCorrect) {
            binding.dexGameInput.setText("")
        }
        setDexCompanionState(
            if (isCorrect) DEX_COMPANION_STATE_EXCITED else DEX_COMPANION_STATE_THINKING,
            bubbleOverride = reward?.bubble ?: reply,
            revertAfterMs = 2800L
        )
        if (announce) announceDexMiniGameReply(reply)
    }

    private fun handleTriviaAnswer(answer: String, announce: Boolean = false) {
        val trivia = DEX_TRIVIA_QUESTIONS.getOrNull(currentTriviaIndex) ?: return
        val normalized = answer.lowercase(Locale.US).trim()
        val isCorrect = trivia.answers.any { accepted ->
            normalized.contains(accepted.lowercase(Locale.US))
        }
        val baseReply = if (isCorrect) {
            getString(R.string.dex_game_trivia_correct, trivia.reveal)
        } else {
            getString(R.string.dex_game_trivia_try_again)
        }
        val reward = if (isCorrect) {
            recordDexGameResult(correct = true)
            recordDexChallengeCompletion(DexMiniGameType.TRIVIA)
        } else {
            breakDexGameStreak()
            null
        }
        val reply = listOfNotNull(baseReply, reward?.reply).joinToString(" ")
        binding.dexGameStatus.text = dexGamesStatusSummary(reply)
        refreshDexCompanionRewardsPanel(unlockCelebration = reward?.bubble != null)
        if (isCorrect) {
            binding.dexGameInput.setText("")
        }
        setDexCompanionState(
            if (isCorrect) DEX_COMPANION_STATE_EXCITED else DEX_COMPANION_STATE_THINKING,
            bubbleOverride = reward?.bubble ?: reply,
            revertAfterMs = 2800L
        )
        if (announce) announceDexMiniGameReply(reply)
    }

    private fun handleMemoryAnswer(answer: String, announce: Boolean = false) {
        if (currentMemorySequence.isEmpty()) {
            val reply = getString(R.string.dex_game_pick_one_first)
            binding.dexGameStatus.text = reply
            if (announce) announceDexMiniGameReply(reply)
            return
        }
        val normalizedAnswer = answer
            .lowercase(Locale.US)
            .replace(Regex("[^a-z0-9,\\s]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
        val guessed = normalizedAnswer
            .split(Regex("[,\\s]+"))
            .filter { it.isNotBlank() }
        val expected = currentMemorySequence.map { it.lowercase(Locale.US) }
        val isCorrect = guessed == expected
        val baseReply = if (isCorrect) {
            getString(R.string.dex_game_memory_correct, currentMemoryRound + 1)
        } else {
            getString(R.string.dex_game_memory_try_again, currentMemorySequence.joinToString(", "))
        }
        val reward = if (isCorrect) {
            recordDexGameResult(correct = true)
            recordDexChallengeCompletion(DexMiniGameType.MEMORY)
        } else {
            breakDexGameStreak()
            null
        }
        val reply = listOfNotNull(baseReply, reward?.reply).joinToString(" ")
        binding.dexGameStatus.text = dexGamesStatusSummary(reply)
        refreshDexCompanionRewardsPanel(unlockCelebration = reward?.bubble != null)
        if (isCorrect) {
            binding.dexGameInput.setText("")
        }
        setDexCompanionState(
            if (isCorrect) DEX_COMPANION_STATE_EXCITED else DEX_COMPANION_STATE_THINKING,
            bubbleOverride = reward?.bubble ?: reply,
            revertAfterMs = 2800L
        )
        if (announce) announceDexMiniGameReply(reply)
    }

    private fun handleWouldYouRatherAnswer(answer: String, announce: Boolean = false) {
        val round = DEX_WOULD_YOU_RATHERS.getOrNull(currentWouldYouRatherIndex) ?: return
        val trimmed = answer.trim()
        val baseReply = getString(R.string.dex_game_wyr_reply, trimmed, round.followUp)
        recordDexGameResult(correct = true, countsAsScoredRound = false)
        val reward = recordDexChallengeCompletion(DexMiniGameType.WOULD_YOU_RATHER)
        val reply = listOfNotNull(baseReply, reward?.reply).joinToString(" ")
        binding.dexGameStatus.text = dexGamesStatusSummary(reply)
        refreshDexCompanionRewardsPanel(unlockCelebration = reward?.bubble != null)
        binding.dexGameInput.setText("")
        setDexCompanionState(
            DEX_COMPANION_STATE_TALKING,
            bubbleOverride = reward?.bubble ?: getString(R.string.dex_game_wyr_bubble_reply),
            revertAfterMs = 2400L
        )
        if (announce) announceDexMiniGameReply(reply)
    }

    private fun announceDexMiniGameReply(reply: String) {
        binding.conversationStatus.text = reply
        binding.lastReplyValue.text = reply
        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
    }

    private fun startFavoriteDexMiniGame(announce: Boolean = false) {
        when (favoriteDexMiniGame()) {
            DexMiniGameType.RIDDLE -> startRiddleGame(announce)
            DexMiniGameType.TRIVIA -> startTriviaGame(announce)
            DexMiniGameType.MEMORY -> startMemoryGame(announce)
            DexMiniGameType.WOULD_YOU_RATHER -> startWouldYouRatherGame(announce)
            DexMiniGameType.GUESS_NUMBER, DexMiniGameType.NONE, null -> startGuessNumberGame(announce)
        }
    }

    private fun startTodaysDexChallenge(announce: Boolean = false) {
        when (todaysDexChallengeGame()) {
            DexMiniGameType.RIDDLE -> startRiddleGame(announce)
            DexMiniGameType.TRIVIA -> startTriviaGame(announce)
            DexMiniGameType.MEMORY -> startMemoryGame(announce)
            DexMiniGameType.WOULD_YOU_RATHER -> startWouldYouRatherGame(announce)
            DexMiniGameType.GUESS_NUMBER, DexMiniGameType.NONE -> startGuessNumberGame(announce)
        }
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
        showBillingLoadingState()
        lifecycleScope.launch {
            val result = getJson("$serverUrl/payments/status", token)
            result.onSuccess { response ->
                currentAccessType = response.optString("access_type").ifBlank { currentAccessType }
                currentTrialDaysLeft = if (response.has("trialDaysLeft")) response.optInt("trialDaysLeft") else null
                hasBillingCustomer = !response.optString("stripe_customer_id").isNullOrBlank()
                updateBillingUi()
                completeSectionRefresh(
                    binding.billingStatusTag,
                    binding.billingCard,
                    currentUserRole.lowercase(Locale.US)
                )
            }.onFailure {
                updateBillingUi()
                completeSectionRefresh(
                    binding.billingStatusTag,
                    binding.billingCard,
                    currentUserRole.lowercase(Locale.US)
                )
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
            else -> billingUnknownDetailCopy()
        }
        setHintBand(
            binding.billingHint,
            if (access == "unknown") billingHintCopy() else billingActiveHintCopy(access),
            when (access) {
                "paid", "unlimited" -> HintTone.HEALTHY
                "trial" -> HintTone.READY
                else -> HintTone.NEXT_STEP
            }
        )
        binding.subscribeNowButton.visibility = if (access == "paid" || access == "unlimited") View.GONE else View.VISIBLE
        binding.manageBillingButton.visibility = if (hasBillingCustomer || access == "paid") View.VISIBLE else View.GONE
        pulseDashboardValues(binding.billingStatusText, binding.billingDetailText)
        refreshInteractionStates()
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
        applyDexCompanionUi()
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
            .putBoolean(KEY_DEX_COMPANION_VISIBLE, currentDexCompanionVisible)
            .putString(KEY_DEX_COMPANION_MOOD, currentDexCompanionMood)
            .putString(KEY_DEX_COMPANION_SIZE, currentDexCompanionSize)
            .putString(KEY_DEX_COMPANION_SIDE, currentDexCompanionSide)
            .putString(KEY_DEX_COMPANION_FACE_STYLE, currentDexCompanionFaceStyle)
            .putString(KEY_DEX_COMPANION_BUBBLE_STYLE, currentDexCompanionBubbleStyle)
            .putString(KEY_DEX_COMPANION_SKIN, currentDexCompanionSkin)
            .putString(KEY_DEX_COMPANION_ACCESSORY, currentDexCompanionAccessory)
            .putString(KEY_DEX_COMPANION_NAME, currentDexCompanionName)
            .putString(KEY_DEX_COMPANION_VOICE, currentDexCompanionVoice)
            .putString(KEY_DEX_COMPANION_PERSONALITY, currentDexCompanionPersonality)
            .putBoolean(KEY_DEX_COMPANION_INTRO_DISMISSED, dexCompanionIntroDismissed)
            .putBoolean(KEY_DEX_COMPANION_INTRO_GREETED, dexCompanionIntroGreeted)
            .putFloat(KEY_DEX_COMPANION_OFFSET_X, currentDexCompanionOffsetX)
            .putFloat(KEY_DEX_COMPANION_OFFSET_Y, currentDexCompanionOffsetY)
            .putInt(KEY_DEX_COMPANION_TIER_STYLE_OVERRIDE, currentDexCompanionTierStyleOverride ?: -1)
            .commit()
    }

    private fun updateAdvancedStyleUi(show: Boolean) {
        isAdvancedStyleVisible = show
        binding.advancedHomeStyleGroup.visibility = if (show) View.VISIBLE else View.GONE
        binding.toggleAdvancedStyleButton.text = getString(
            if (show) R.string.home_style_customize_less else R.string.home_style_customize_more
        )
    }

    private fun updateDexCompanionIntroUi() {
        val shouldShowIntro =
            !authToken.isNullOrBlank() &&
                !currentUserRole.equals("admin", ignoreCase = true) &&
                !dexCompanionIntroDismissed
        binding.dexCompanionIntroStrip.visibility = if (shouldShowIntro) View.VISIBLE else View.GONE
        maybeShowDexCompanionIntroGreeting(shouldShowIntro)
    }

    private fun maybeShowDexCompanionIntroGreeting(showingIntro: Boolean) {
        val canGreet =
            showingIntro &&
                currentDexCompanionVisible &&
                !dexCompanionIntroGreeted &&
                binding.dexCompanionCard.visibility == View.VISIBLE
        if (!canGreet) return
        dexCompanionIntroGreeted = true
        dexCompanionBubbleOverride = dexCompanionIntroGreetingLine()
        dexCompanionState = DEX_COMPANION_STATE_EXCITED
        applyDexCompanionUi()
        playDexCompanionEventAnimation(DEX_COMPANION_STATE_EXCITED)
        mainHandler.removeCallbacks(dexCompanionStateResetRunnable)
        mainHandler.postDelayed(dexCompanionStateResetRunnable, 3600L)
        persistHomeLook()
    }

    private fun dexCompanionIntroGreetingLine(): String {
        val name = currentDexCompanionName.ifBlank { "Dex" }
        return when (currentDexCompanionPersonality.lowercase(Locale.US)) {
            DEX_COMPANION_PERSONALITY_BESTIE -> "$name is here. Drag me around and make me cute."
            DEX_COMPANION_PERSONALITY_GUARDIAN -> "$name is here. Place me where you want quick support."
            DEX_COMPANION_PERSONALITY_STUDY_BUDDY -> "$name is here. Set me up and lets build your space."
            else -> "$name is here. Move me, style me, and make this yours."
        }
    }

    private fun applyDexCompanionPersonalityPreset() {
        when (currentDexCompanionPersonality.lowercase(Locale.US)) {
            DEX_COMPANION_PERSONALITY_BESTIE -> {
                currentDexCompanionMood = DEX_COMPANION_MOOD_PLAYFUL
                currentDexCompanionVoice = DEX_COMPANION_VOICE_PLAYFUL
                currentDexCompanionSkin = DEX_COMPANION_SKIN_VIOLET
                currentDexCompanionAccessory = DEX_COMPANION_ACCESSORY_GLASSES
                currentDexCompanionFaceStyle = DEX_COMPANION_FACE_WINK
                currentDexCompanionBubbleStyle = DEX_COMPANION_BUBBLE_GLOW
            }
            DEX_COMPANION_PERSONALITY_GUARDIAN -> {
                currentDexCompanionMood = DEX_COMPANION_MOOD_FOCUS
                currentDexCompanionVoice = DEX_COMPANION_VOICE_DIRECT
                currentDexCompanionSkin = DEX_COMPANION_SKIN_SUNSET
                currentDexCompanionAccessory = DEX_COMPANION_ACCESSORY_HALO
                currentDexCompanionFaceStyle = DEX_COMPANION_FACE_CLASSIC
                currentDexCompanionBubbleStyle = DEX_COMPANION_BUBBLE_BOLD
            }
            DEX_COMPANION_PERSONALITY_STUDY_BUDDY -> {
                currentDexCompanionMood = DEX_COMPANION_MOOD_FOCUS
                currentDexCompanionVoice = DEX_COMPANION_VOICE_SUPPORTIVE
                currentDexCompanionSkin = DEX_COMPANION_SKIN_MINT
                currentDexCompanionAccessory = DEX_COMPANION_ACCESSORY_HEADPHONES
                currentDexCompanionFaceStyle = DEX_COMPANION_FACE_PIXEL
                currentDexCompanionBubbleStyle = DEX_COMPANION_BUBBLE_SOFT
            }
            else -> {
                currentDexCompanionMood = DEX_COMPANION_MOOD_FOCUS
                currentDexCompanionVoice = DEX_COMPANION_VOICE_DIRECT
                currentDexCompanionSkin = DEX_COMPANION_SKIN_SKY
                currentDexCompanionAccessory = DEX_COMPANION_ACCESSORY_NONE
                currentDexCompanionFaceStyle = DEX_COMPANION_FACE_CLASSIC
                currentDexCompanionBubbleStyle = DEX_COMPANION_BUBBLE_BOLD
            }
        }
    }

    private fun handleDexCompanionTap() {
        if (binding.dexCompanionCard.visibility != View.VISIBLE) return
        val message = when {
            binding.dexCompanionIntroStrip.visibility == View.VISIBLE -> "You can drag me or tune my style below."
            pendingAction != null -> "I have something ready for you below."
            dexCompanionState == DEX_COMPANION_STATE_SLEEPING -> "Wake mode is resting right now."
            else -> dexCompanionTapLine()
        }
        setDexCompanionState(DEX_COMPANION_STATE_EXCITED, bubbleOverride = message, revertAfterMs = 2600L)
        if (binding.dexCompanionIntroStrip.visibility == View.VISIBLE || binding.themeCard.visibility == View.VISIBLE) {
            binding.contentScrollView.post {
                binding.contentScrollView.smoothScrollTo(0, binding.themeCard.top - dpToPx(16))
            }
        }
    }

    private fun handleDexCompanionDoubleTap() {
        if (binding.dexCompanionCard.visibility != View.VISIBLE) return
        cycleDexCompanionMood()
    }

    private fun handleDexCompanionLongPress() {
        if (binding.dexCompanionCard.visibility != View.VISIBLE) return
        val message = when (currentDexCompanionPersonality.lowercase(Locale.US)) {
            DEX_COMPANION_PERSONALITY_BESTIE -> getString(R.string.dex_companion_quick_menu_bestie)
            DEX_COMPANION_PERSONALITY_GUARDIAN -> getString(R.string.dex_companion_quick_menu_guardian)
            DEX_COMPANION_PERSONALITY_STUDY_BUDDY -> getString(R.string.dex_companion_quick_menu_study_buddy)
            else -> getString(R.string.dex_companion_quick_menu_coach)
        }
        setDexCompanionState(
            DEX_COMPANION_STATE_PENDING,
            bubbleOverride = message,
            revertAfterMs = 2800L
        )
        binding.dexCompanionCard.post {
            showDexCompanionQuickMenu(binding.dexCompanionCard)
        }
    }

    private fun showDexCompanionQuickMenu(anchor: View) {
        val popup = PopupMenu(this, anchor, Gravity.END)
        popup.menu.add(0, 1, 0, getString(R.string.dex_companion_quick_action_customize))
        popup.menu.add(0, 2, 1, getString(R.string.dex_companion_quick_action_mood))
        popup.menu.add(0, 3, 2, getString(R.string.dex_companion_quick_action_personality))
        popup.menu.add(0, 4, 3, getString(R.string.dex_companion_quick_action_hide))
        popup.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> {
                    openDexCompanionCustomization()
                    true
                }
                2 -> {
                    cycleDexCompanionMood()
                    true
                }
                3 -> {
                    cycleDexCompanionPersonality()
                    true
                }
                4 -> {
                    hideDexCompanionForNow()
                    true
                }
                else -> false
            }
        }
        popup.show()
    }

    private fun openDexCompanionCustomization() {
        setDexCompanionState(
            DEX_COMPANION_STATE_EXCITED,
            bubbleOverride = getString(R.string.dex_companion_customize_opening),
            revertAfterMs = 2600L
        )
        binding.contentScrollView.post {
            binding.contentScrollView.smoothScrollTo(0, binding.themeCard.top - dpToPx(16))
        }
        binding.dexCompanionNameInput.requestFocus()
    }

    private fun cycleDexCompanionMood() {
        currentDexCompanionMood = when (currentDexCompanionMood.lowercase(Locale.US)) {
            DEX_COMPANION_MOOD_CALM -> DEX_COMPANION_MOOD_PLAYFUL
            DEX_COMPANION_MOOD_PLAYFUL -> DEX_COMPANION_MOOD_FOCUS
            else -> DEX_COMPANION_MOOD_CALM
        }
        updateDexCompanionControls()
        val moodLabel = when (currentDexCompanionMood.lowercase(Locale.US)) {
            DEX_COMPANION_MOOD_PLAYFUL -> getString(R.string.dex_companion_mood_playful)
            DEX_COMPANION_MOOD_FOCUS -> getString(R.string.dex_companion_mood_focus)
            else -> getString(R.string.dex_companion_mood_calm)
        }
        setDexCompanionState(
            DEX_COMPANION_STATE_EXCITED,
            bubbleOverride = getString(R.string.dex_companion_mood_switched, moodLabel),
            revertAfterMs = 2600L
        )
        persistHomeLook()
        binding.contentScrollView.post {
            binding.contentScrollView.smoothScrollTo(0, binding.themeCard.top - dpToPx(16))
        }
    }

    private fun cycleDexCompanionPersonality() {
        currentDexCompanionPersonality = when (currentDexCompanionPersonality.lowercase(Locale.US)) {
            DEX_COMPANION_PERSONALITY_COACH -> DEX_COMPANION_PERSONALITY_BESTIE
            DEX_COMPANION_PERSONALITY_BESTIE -> DEX_COMPANION_PERSONALITY_GUARDIAN
            DEX_COMPANION_PERSONALITY_GUARDIAN -> DEX_COMPANION_PERSONALITY_STUDY_BUDDY
            else -> DEX_COMPANION_PERSONALITY_COACH
        }
        applyDexCompanionPersonalityPreset()
        updateDexCompanionControls()
        applyDexCompanionUi()
        val personalityLabel = when (currentDexCompanionPersonality.lowercase(Locale.US)) {
            DEX_COMPANION_PERSONALITY_BESTIE -> getString(R.string.dex_companion_personality_bestie)
            DEX_COMPANION_PERSONALITY_GUARDIAN -> getString(R.string.dex_companion_personality_guardian)
            DEX_COMPANION_PERSONALITY_STUDY_BUDDY -> getString(R.string.dex_companion_personality_study_buddy)
            else -> getString(R.string.dex_companion_personality_coach)
        }
        setDexCompanionState(
            DEX_COMPANION_STATE_EXCITED,
            bubbleOverride = getString(R.string.dex_companion_personality_switched, personalityLabel),
            revertAfterMs = 2800L
        )
        persistHomeLook()
        binding.contentScrollView.post {
            binding.contentScrollView.smoothScrollTo(0, binding.themeCard.top - dpToPx(16))
        }
    }

    private fun hideDexCompanionForNow() {
        currentDexCompanionVisible = false
        updateDexCompanionControls()
        persistHomeLook()
        binding.homeStyleMessage.text = getString(R.string.dex_companion_hidden_for_now)
        applyDexCompanionUi()
    }

    private fun dexCompanionTapLine(): String {
        return when (currentDexCompanionPersonality.lowercase(Locale.US)) {
            DEX_COMPANION_PERSONALITY_BESTIE -> "Hey. Want to switch my vibe a little?"
            DEX_COMPANION_PERSONALITY_GUARDIAN -> "I am ready. Adjust anything you need."
            DEX_COMPANION_PERSONALITY_STUDY_BUDDY -> "Want to tune my setup for focus?"
            else -> "Want to fine-tune me a bit?"
        }
    }

    private fun updateDexCompanionControls() {
        updateDexCompanionIntroUi()
        if (binding.dexCompanionVisibleSwitch.isChecked != currentDexCompanionVisible) {
            binding.dexCompanionVisibleSwitch.isChecked = currentDexCompanionVisible
        }
        val companionName = binding.dexCompanionNameInput.text?.toString().orEmpty()
        if (companionName != currentDexCompanionName) {
            binding.dexCompanionNameInput.setText(currentDexCompanionName)
            binding.dexCompanionNameInput.setSelection(binding.dexCompanionNameInput.text?.length ?: 0)
        }
        binding.dexCompanionPersonalityToggle.check(
            when (currentDexCompanionPersonality.lowercase(Locale.US)) {
                DEX_COMPANION_PERSONALITY_BESTIE -> R.id.dexCompanionPersonalityBestieButton
                DEX_COMPANION_PERSONALITY_GUARDIAN -> R.id.dexCompanionPersonalityGuardianButton
                DEX_COMPANION_PERSONALITY_STUDY_BUDDY -> R.id.dexCompanionPersonalityStudyBuddyButton
                else -> R.id.dexCompanionPersonalityCoachButton
            }
        )
        binding.dexCompanionMoodToggle.check(
            when (currentDexCompanionMood.lowercase(Locale.US)) {
                DEX_COMPANION_MOOD_PLAYFUL -> R.id.dexCompanionMoodPlayfulButton
                DEX_COMPANION_MOOD_FOCUS -> R.id.dexCompanionMoodFocusButton
                else -> R.id.dexCompanionMoodCalmButton
            }
        )
        binding.dexCompanionSizeToggle.check(
            when (currentDexCompanionSize.lowercase(Locale.US)) {
                DEX_COMPANION_SIZE_SMALL -> R.id.dexCompanionSizeSmallButton
                DEX_COMPANION_SIZE_LARGE -> R.id.dexCompanionSizeLargeButton
                else -> R.id.dexCompanionSizeMediumButton
            }
        )
        binding.dexCompanionSideToggle.check(
            when (currentDexCompanionSide.lowercase(Locale.US)) {
                DEX_COMPANION_SIDE_LEFT -> R.id.dexCompanionSideLeftButton
                else -> R.id.dexCompanionSideRightButton
            }
        )
        binding.dexCompanionFaceStyleToggle.check(
            when (currentDexCompanionFaceStyle.lowercase(Locale.US)) {
                DEX_COMPANION_FACE_WINK -> R.id.dexCompanionFaceStyleWinkButton
                DEX_COMPANION_FACE_PIXEL -> R.id.dexCompanionFaceStylePixelButton
                else -> R.id.dexCompanionFaceStyleClassicButton
            }
        )
        binding.dexCompanionBubbleStyleToggle.check(
            when (currentDexCompanionBubbleStyle.lowercase(Locale.US)) {
                DEX_COMPANION_BUBBLE_GLOW -> R.id.dexCompanionBubbleStyleGlowButton
                DEX_COMPANION_BUBBLE_BOLD -> R.id.dexCompanionBubbleStyleBoldButton
                else -> R.id.dexCompanionBubbleStyleSoftButton
            }
        )
        binding.dexCompanionSkinToggle.check(
            when (currentDexCompanionSkin.lowercase(Locale.US)) {
                DEX_COMPANION_SKIN_MINT -> R.id.dexCompanionSkinMintButton
                DEX_COMPANION_SKIN_SUNSET -> R.id.dexCompanionSkinSunsetButton
                DEX_COMPANION_SKIN_VIOLET -> R.id.dexCompanionSkinVioletButton
                else -> R.id.dexCompanionSkinSkyButton
            }
        )
        binding.dexCompanionAccessoryToggle.check(
            when (currentDexCompanionAccessory.lowercase(Locale.US)) {
                DEX_COMPANION_ACCESSORY_HEADPHONES -> R.id.dexCompanionAccessoryHeadphonesButton
                DEX_COMPANION_ACCESSORY_GLASSES -> R.id.dexCompanionAccessoryGlassesButton
                DEX_COMPANION_ACCESSORY_HALO -> R.id.dexCompanionAccessoryHaloButton
                else -> R.id.dexCompanionAccessoryNoneButton
            }
        )
        binding.dexCompanionVoiceToggle.check(
            when (currentDexCompanionVoice.lowercase(Locale.US)) {
                DEX_COMPANION_VOICE_PLAYFUL -> R.id.dexCompanionVoicePlayfulButton
                DEX_COMPANION_VOICE_DIRECT -> R.id.dexCompanionVoiceDirectButton
                else -> R.id.dexCompanionVoiceSupportiveButton
            }
        )
        binding.dexCompanionRewardsValue.text = dexCompanionRewardsSummary()
    }

    private fun applyDexCompanionUi() {
        val loggedIn = !authToken.isNullOrBlank()
        val shouldShowCompanion = loggedIn && currentDexCompanionVisible
        binding.dexCompanionCard.visibility = if (shouldShowCompanion) View.VISIBLE else View.GONE
        if (!shouldShowCompanion) {
            stopDexCompanionAnimation()
            mainHandler.removeCallbacks(dexCompanionBlinkRunnable)
            mainHandler.removeCallbacks(dexCompanionStateResetRunnable)
            dexCompanionBlinkScheduled = false
            return
        }

        binding.dexCompanionCard.bringToFront()

        val skinColors = dexCompanionSkinColors()
        val accentColor = skinColors.accent
        val bubbleTint = ColorUtils.blendARGB(accentColor, android.graphics.Color.WHITE, 0.76f)
        val unlockLevel = dexCompanionRewardsPreviewLevel ?: currentDexCompanionTierStyleOverride ?: dexGamesUnlockLevel()
        val unlockAccent = when (unlockLevel) {
            3 -> android.graphics.Color.parseColor("#D8C4FF")
            2 -> android.graphics.Color.parseColor("#7ED6FF")
            1 -> android.graphics.Color.parseColor("#F5C451")
            else -> accentColor
        }
        val cardTint = ColorUtils.setAlphaComponent(ColorUtils.blendARGB(accentColor, unlockAccent, if (unlockLevel > 0) 0.42f else 0f), 78)
        val faceTint = ColorUtils.blendARGB(accentColor, skinColors.faceBase, 0.18f)
        val labelTint = ColorUtils.blendARGB(unlockAccent, android.graphics.Color.WHITE, 0.82f)
        val activeState = dexCompanionState.ifBlank { deriveDexCompanionState() }
        val isPixelFace = currentDexCompanionFaceStyle.lowercase(Locale.US) == DEX_COMPANION_FACE_PIXEL
        val isWinkFace = currentDexCompanionFaceStyle.lowercase(Locale.US) == DEX_COMPANION_FACE_WINK
        val bubbleStyle = currentDexCompanionBubbleStyle.lowercase(Locale.US)

        val styledBubbleTint = when (bubbleStyle) {
            DEX_COMPANION_BUBBLE_GLOW -> ColorUtils.blendARGB(accentColor, android.graphics.Color.WHITE, 0.58f)
            DEX_COMPANION_BUBBLE_BOLD -> ColorUtils.blendARGB(accentColor, android.graphics.Color.BLACK, 0.18f)
            else -> bubbleTint
        }
        binding.dexCompanionBubble.backgroundTintList = ColorStateList.valueOf(styledBubbleTint)
        binding.dexCompanionCard.setCardBackgroundColor(ColorUtils.setAlphaComponent(skinColors.card, 220))
        binding.dexCompanionCard.strokeColor = cardTint
        binding.dexCompanionCard.strokeWidth = dpToPx(if (unlockLevel >= 3) 2 else 1)
        binding.dexCompanionFace.setCardBackgroundColor(ColorUtils.blendARGB(faceTint, android.graphics.Color.WHITE, 0.2f))
        binding.dexCompanionFace.strokeColor = labelTint
        binding.dexCompanionFace.radius = dpToPx(
            when (currentDexCompanionSize.lowercase(Locale.US)) {
                DEX_COMPANION_SIZE_SMALL -> if (isPixelFace) 18 else 24
                DEX_COMPANION_SIZE_LARGE -> if (isPixelFace) 26 else 34
                else -> if (isPixelFace) 22 else 30
            }
        ).toFloat()
        binding.dexCompanionLabel.setTextColor(labelTint)
        binding.dexCompanionLabel.text = currentDexCompanionName
        val statusSpec = dexCompanionStatusSpec(activeState, accentColor)
        val previewingRewards = dexCompanionRewardsPreviewLevel != null
        val pinnedRewards = !previewingRewards && currentDexCompanionTierStyleOverride != null
        val tierSuffix = when (unlockLevel) {
            3 -> if (previewingRewards) " | Legend preview" else " | Legend"
            2 -> if (previewingRewards) " | Star preview" else " | Star"
            1 -> if (previewingRewards) " | Spark preview" else " | Spark"
            else -> ""
        }
        val statusSuffix = if (pinnedRewards && tierSuffix.isNotBlank()) "$tierSuffix pinned" else tierSuffix
        binding.dexCompanionStatusChip.text = getString(statusSpec.labelRes) + statusSuffix
        binding.dexCompanionStatusChip.backgroundTintList = ColorStateList.valueOf(statusSpec.chipColor)
        binding.dexCompanionStatusChip.setTextColor(statusSpec.textColor)
        binding.dexCompanionStatusDot.backgroundTintList = ColorStateList.valueOf(statusSpec.dotColor)
        binding.dexCompanionBubble.setTextColor(
            if (bubbleStyle == DEX_COMPANION_BUBBLE_BOLD) android.graphics.Color.WHITE else getColorCompat(R.color.dex_background)
        )

        val bubbleText = dexCompanionBubbleOverride ?: companionBubbleForState(activeState)
        binding.dexCompanionBubble.text =
            if (bubbleStyle == DEX_COMPANION_BUBBLE_BOLD) bubbleText.uppercase(Locale.US) else bubbleText
        binding.dexCompanionBubble.textSize = when (bubbleStyle) {
            DEX_COMPANION_BUBBLE_BOLD -> 11f
            DEX_COMPANION_BUBBLE_GLOW -> 12.5f
            else -> 12f
        }

        val faceSize = dpToPx(
            when (currentDexCompanionSize.lowercase(Locale.US)) {
                DEX_COMPANION_SIZE_SMALL -> 70
                DEX_COMPANION_SIZE_LARGE -> 96
                else -> 82
            }
        )
        binding.dexCompanionFace.layoutParams = binding.dexCompanionFace.layoutParams.apply {
            width = faceSize
            height = (faceSize * 1.12f).toInt()
        }

        val mouthWidth = dpToPx(companionMouthWidthDp(activeState))
        binding.dexCompanionMouth.layoutParams = binding.dexCompanionMouth.layoutParams.apply {
            width = mouthWidth
        }
        binding.dexCompanionMouth.alpha = companionMouthAlpha(activeState)
        binding.dexCompanionBubble.alpha = when (bubbleStyle) {
            DEX_COMPANION_BUBBLE_GLOW -> 1f
            else -> companionBubbleAlpha(activeState)
        }
        binding.dexCompanionBubble.rotation = companionBubbleRotation(activeState)
        val eyeScale = companionEyeScale(activeState)
        binding.dexCompanionEyeLeft.scaleY = eyeScale
        binding.dexCompanionEyeRight.scaleY = if (isWinkFace && activeState == DEX_COMPANION_STATE_IDLE) 0.35f else eyeScale
        binding.dexCompanionEyeLeft.scaleX = if (isPixelFace) 1.25f else if (activeState == DEX_COMPANION_STATE_TALKING) 1.08f else 1f
        binding.dexCompanionEyeRight.scaleX = if (isPixelFace) 1.25f else if (activeState == DEX_COMPANION_STATE_TALKING) 1.08f else 1f
        binding.dexCompanionFace.scaleX = companionFaceScale(activeState)
        binding.dexCompanionFace.scaleY = companionFaceScale(activeState)
        binding.dexCompanionCard.alpha = if (activeState == DEX_COMPANION_STATE_PENDING) 1f else 0.98f
        binding.dexCompanionLabel.alpha = if (isPixelFace) 0.88f else 1f
        val accessoryTint = ColorUtils.blendARGB(unlockAccent, android.graphics.Color.WHITE, 0.34f)
        binding.dexCompanionHalo.backgroundTintList = ColorStateList.valueOf(accessoryTint)
        listOf(
            binding.dexCompanionHeadphonesBand,
            binding.dexCompanionHeadphonesLeft,
            binding.dexCompanionHeadphonesRight,
            binding.dexCompanionGlassesBridge
        ).forEach { it.backgroundTintList = ColorStateList.valueOf(accessoryTint) }
        listOf(binding.dexCompanionGlassesLeft, binding.dexCompanionGlassesRight).forEach {
            it.backgroundTintList = ColorStateList.valueOf(accessoryTint)
        }
        val tierHaloVisible = unlockLevel > 0
        val accessoryHaloVisible = currentDexCompanionAccessory.lowercase(Locale.US) == DEX_COMPANION_ACCESSORY_HALO
        binding.dexCompanionHalo.visibility =
            if (accessoryHaloVisible || tierHaloVisible) View.VISIBLE else View.GONE
        binding.dexCompanionHalo.alpha = dexGamesTierHaloAlpha(accessoryHaloVisible)
        val showHeadphones = currentDexCompanionAccessory.lowercase(Locale.US) == DEX_COMPANION_ACCESSORY_HEADPHONES
        binding.dexCompanionHeadphonesBand.visibility = if (showHeadphones) View.VISIBLE else View.GONE
        binding.dexCompanionHeadphonesLeft.visibility = if (showHeadphones) View.VISIBLE else View.GONE
        binding.dexCompanionHeadphonesRight.visibility = if (showHeadphones) View.VISIBLE else View.GONE
        binding.dexCompanionGlassesRow.visibility =
            if (currentDexCompanionAccessory.lowercase(Locale.US) == DEX_COMPANION_ACCESSORY_GLASSES) View.VISIBLE else View.GONE

        (binding.dexCompanionCard.layoutParams as? FrameLayout.LayoutParams)?.let { params ->
            val sideGravity = if (currentDexCompanionSide.lowercase(Locale.US) == DEX_COMPANION_SIDE_LEFT) {
                Gravity.BOTTOM or Gravity.START
            } else {
                Gravity.BOTTOM or Gravity.END
            }
            params.gravity = sideGravity
            val sideMargin = dpToPx(18)
            params.marginStart = sideMargin
            params.marginEnd = sideMargin
            params.bottomMargin = dpToPx(22)
            binding.dexCompanionCard.layoutParams = params
        }
        applyDexCompanionDragPosition()
        maybeShowDexCompanionIntroGreeting(binding.dexCompanionIntroStrip.visibility == View.VISIBLE)

        startDexCompanionAnimation()
        scheduleDexCompanionBlink()
    }

    private fun applyDexCompanionDragPosition() {
        binding.dexCompanionCard.translationX = currentDexCompanionOffsetX
        binding.dexCompanionCard.translationY = currentDexCompanionOffsetY
        binding.dexCompanionCard.post {
            val parentWidth = binding.root.width
            val parentHeight = binding.root.height
            val cardWidth = binding.dexCompanionCard.width
            val cardHeight = binding.dexCompanionCard.height
            if (parentWidth <= 0 || parentHeight <= 0 || cardWidth <= 0 || cardHeight <= 0) return@post
            val minX = dpToPx(8).toFloat()
            val maxX = (parentWidth - cardWidth - dpToPx(8)).toFloat()
            val minY = dpToPx(56).toFloat()
            val maxY = (parentHeight - cardHeight - dpToPx(8)).toFloat()
            val currentX = binding.dexCompanionCard.left + currentDexCompanionOffsetX
            val currentY = binding.dexCompanionCard.top + currentDexCompanionOffsetY
            val clampedX = currentX.coerceIn(minX, maxX)
            val clampedY = currentY.coerceIn(minY, maxY)
            currentDexCompanionOffsetX = clampedX - binding.dexCompanionCard.left
            currentDexCompanionOffsetY = clampedY - binding.dexCompanionCard.top
            binding.dexCompanionCard.translationX = currentDexCompanionOffsetX
            binding.dexCompanionCard.translationY = currentDexCompanionOffsetY
        }
    }

    private fun deriveDexCompanionState(): String {
        return when {
            pendingAction != null -> DEX_COMPANION_STATE_PENDING
            shouldResumeCallListeningAfterSpeech || isListeningForCallCommand || lastCallState == TelephonyManager.CALL_STATE_RINGING -> DEX_COMPANION_STATE_ALERT
            dexChatInFlight -> DEX_COMPANION_STATE_THINKING
            isListeningForDexCommand || awaitingWakeCommand || conversationActive -> DEX_COMPANION_STATE_LISTENING
            !wakeModeEnabled -> DEX_COMPANION_STATE_SLEEPING
            else -> DEX_COMPANION_STATE_IDLE
        }
    }

    private fun setDexCompanionState(
        state: String,
        bubbleOverride: String? = null,
        revertAfterMs: Long? = null
    ) {
        dexCompanionState = state
        dexCompanionBubbleOverride = bubbleOverride
        applyDexCompanionUi()
        if (state != DEX_COMPANION_STATE_IDLE) {
            playDexCompanionEventAnimation(state)
        }
        mainHandler.removeCallbacks(dexCompanionStateResetRunnable)
        if (revertAfterMs != null) {
            mainHandler.postDelayed(dexCompanionStateResetRunnable, revertAfterMs)
        }
    }

    private fun restoreDexCompanionState() {
        mainHandler.removeCallbacks(dexCompanionStateResetRunnable)
        dexCompanionBubbleOverride = null
        dexCompanionState = deriveDexCompanionState()
        applyDexCompanionUi()
    }

    private fun companionBubbleForState(state: String): String {
        val base = companionBaseLineForState(state)
        return companionVoiceCopy(base)
    }

    private fun companionBaseLineForState(state: String): String {
        val context = deriveDexCompanionContext()
        return when (currentDexCompanionPersonality.lowercase(Locale.US)) {
            DEX_COMPANION_PERSONALITY_BESTIE -> when (state) {
                DEX_COMPANION_STATE_SLEEPING -> "Catch me when you need me."
                DEX_COMPANION_STATE_LISTENING -> when (context) {
                    DexCompanionContext.TEXT -> "Tell me the message."
                    DexCompanionContext.CALL -> "Okay, what do you want to do with the call?"
                    DexCompanionContext.LESSON -> "Tell me what you want to learn."
                    DexCompanionContext.SAFETY -> "Talk to me. I am here."
                    else -> "Tell me."
                }
                DEX_COMPANION_STATE_EXCITED -> when (context) {
                    DexCompanionContext.LESSON -> "Nice, lets learn."
                    DexCompanionContext.TEXT -> "Okay, lets send it."
                    else -> "Okay, lets go."
                }
                DEX_COMPANION_STATE_TALKING -> when (context) {
                    DexCompanionContext.LESSON -> "I am breaking it down with you."
                    DexCompanionContext.SAFETY -> "I am staying with you."
                    else -> "I am with you."
                }
                DEX_COMPANION_STATE_PENDING -> when (context) {
                    DexCompanionContext.TEXT -> "Your text is ready."
                    DexCompanionContext.CALL -> "Call plan is ready."
                    DexCompanionContext.LESSON -> "Your next step is ready."
                    else -> "I have it ready."
                }
                DEX_COMPANION_STATE_ALERT -> when (context) {
                    DexCompanionContext.CALL -> "Hey, someone is calling."
                    DexCompanionContext.SAFETY -> "Hey, stay with me."
                    else -> "Hey, this needs you."
                }
                else -> "I am right here."
            }
            DEX_COMPANION_PERSONALITY_GUARDIAN -> when (state) {
                DEX_COMPANION_STATE_SLEEPING -> "I am standing by."
                DEX_COMPANION_STATE_LISTENING -> when (context) {
                    DexCompanionContext.SAFETY -> "I am listening carefully."
                    DexCompanionContext.CALL -> "State the call action."
                    DexCompanionContext.TEXT -> "State the reply."
                    else -> "I am listening carefully."
                }
                DEX_COMPANION_STATE_EXCITED -> when (context) {
                    DexCompanionContext.CALL -> "We are acting now."
                    DexCompanionContext.SAFETY -> "Support is in motion."
                    else -> "We are moving now."
                }
                DEX_COMPANION_STATE_TALKING -> when (context) {
                    DexCompanionContext.LESSON -> "Stay with the steps."
                    DexCompanionContext.SAFETY -> "Stay with me."
                    else -> "Stay with me."
                }
                DEX_COMPANION_STATE_PENDING -> when (context) {
                    DexCompanionContext.TEXT -> "Reply prepared."
                    DexCompanionContext.CALL -> "Call action prepared."
                    DexCompanionContext.SAFETY -> "Support action prepared."
                    else -> "This is prepared."
                }
                DEX_COMPANION_STATE_ALERT -> when (context) {
                    DexCompanionContext.CALL -> "Incoming call. Attention needed."
                    DexCompanionContext.SAFETY -> "Safety response needed."
                    else -> "Attention needed."
                }
                else -> "I am here with you."
            }
            DEX_COMPANION_PERSONALITY_STUDY_BUDDY -> when (state) {
                DEX_COMPANION_STATE_SLEEPING -> "I will be ready."
                DEX_COMPANION_STATE_LISTENING -> when (context) {
                    DexCompanionContext.LESSON -> "Go ahead, I am tracking it."
                    DexCompanionContext.TEXT -> "Go ahead with the reply."
                    else -> "Go ahead."
                }
                DEX_COMPANION_STATE_EXCITED -> when (context) {
                    DexCompanionContext.LESSON -> "Nice, lets work."
                    else -> "Nice, lets work."
                }
                DEX_COMPANION_STATE_TALKING -> when (context) {
                    DexCompanionContext.LESSON -> "Working through it."
                    DexCompanionContext.TEXT -> "Drafting it clearly."
                    else -> "Working through it."
                }
                DEX_COMPANION_STATE_PENDING -> when (context) {
                    DexCompanionContext.LESSON -> "This is ready to review."
                    DexCompanionContext.TEXT -> "Reply is ready to review."
                    else -> "This is ready to review."
                }
                DEX_COMPANION_STATE_ALERT -> when (context) {
                    DexCompanionContext.CALL -> "Quick call check."
                    DexCompanionContext.SAFETY -> "Quick support check."
                    else -> "Quick check."
                }
                else -> "Ready when you are."
            }
            else -> when (state) {
                DEX_COMPANION_STATE_SLEEPING -> "I am resting until you need me."
                DEX_COMPANION_STATE_LISTENING -> when (context) {
                    DexCompanionContext.CALL -> "I am listening for the call command."
                    DexCompanionContext.TEXT -> "I am listening for the reply."
                    DexCompanionContext.LESSON -> "I am listening for the next step."
                    DexCompanionContext.SAFETY -> "I am listening carefully."
                    else -> "I am listening."
                }
                DEX_COMPANION_STATE_EXCITED -> when (context) {
                    DexCompanionContext.LESSON -> "Okay, lets learn."
                    DexCompanionContext.TEXT -> "Okay, lets send it."
                    else -> "Okay, lets do it."
                }
                DEX_COMPANION_STATE_TALKING -> when (context) {
                    DexCompanionContext.LESSON -> "Teaching this step by step."
                    DexCompanionContext.SAFETY -> "Talking it through with care."
                    else -> "Talking it through."
                }
                DEX_COMPANION_STATE_PENDING -> when (context) {
                    DexCompanionContext.TEXT -> "I have the text ready."
                    DexCompanionContext.CALL -> "I have the call ready."
                    DexCompanionContext.LESSON -> "I have the lesson ready."
                    DexCompanionContext.SAFETY -> "I have support ready."
                    else -> "I have this ready."
                }
                DEX_COMPANION_STATE_ALERT -> when (context) {
                    DexCompanionContext.CALL -> "Incoming call."
                    DexCompanionContext.SAFETY -> "Safety support is needed."
                    else -> "Something needs you."
                }
                else -> when (currentDexCompanionMood.lowercase(Locale.US)) {
                    DEX_COMPANION_MOOD_PLAYFUL -> getString(R.string.dex_companion_bubble_playful)
                    DEX_COMPANION_MOOD_FOCUS -> getString(R.string.dex_companion_bubble_focus)
                    else -> getString(R.string.dex_companion_bubble_calm)
                }
            }
        }
    }

    private fun deriveDexCompanionContext(): DexCompanionContext {
        val now = SystemClock.elapsedRealtime()
        return when {
            lastEmergencyTriggerReason.isNotBlank() && now - lastLocalEmergencySmsSentAt < 5 * 60_000L -> DexCompanionContext.SAFETY
            activeQuizSession != null || listeningForQuizAnswer ||
                binding.conversationStatus.text?.contains("lesson", ignoreCase = true) == true ||
                binding.conversationStatus.text?.contains("quiz", ignoreCase = true) == true -> DexCompanionContext.LESSON
            lastCallState == TelephonyManager.CALL_STATE_RINGING ||
                isListeningForCallCommand ||
                pendingReminderCallTriggerAt != null ||
                pendingReminderCallTargetName != null -> DexCompanionContext.CALL
            pendingIncomingSmsSender != null ||
                pendingIncomingSmsValue != null ||
                pendingIncomingSmsBody != null ||
                pendingIncomingSmsReplyChoice ||
                pendingNotificationText != null ||
                pendingNotificationReplyChoice ||
                pendingReminderSmsTriggerAt != null ||
                pendingReminderSmsTarget != null ||
                pendingReminderSmsBody != null ||
                pendingSmsRecipient != null ||
                pendingAction?.kind == PendingActionKind.SMS_DRAFT -> DexCompanionContext.TEXT
            else -> DexCompanionContext.GENERAL
        }
    }

    private fun companionVoiceCopy(base: String): String {
        val name = currentDexCompanionName.ifBlank { "Dex" }
        return when (currentDexCompanionVoice.lowercase(Locale.US)) {
            DEX_COMPANION_VOICE_PLAYFUL -> "$base $name is in."
            DEX_COMPANION_VOICE_DIRECT -> when {
                base.equals(getString(R.string.dex_companion_bubble_listening), true) -> "$name is listening."
                base.equals(getString(R.string.dex_companion_bubble_pending), true) -> "$name has this ready."
                base.equals(getString(R.string.dex_companion_bubble_alert), true) -> "$name needs your attention."
                else -> "$name: $base"
            }
            else -> "$name says: $base"
        }
    }

    private fun companionMouthWidthDp(state: String): Int {
        return when (state) {
            DEX_COMPANION_STATE_SLEEPING -> 8
            DEX_COMPANION_STATE_LISTENING -> 10
            DEX_COMPANION_STATE_EXCITED -> 26
            DEX_COMPANION_STATE_THINKING -> 12
            DEX_COMPANION_STATE_TALKING -> 20
            DEX_COMPANION_STATE_PENDING -> 22
            DEX_COMPANION_STATE_ALERT -> 14
            else -> when (currentDexCompanionMood.lowercase(Locale.US)) {
                DEX_COMPANION_MOOD_PLAYFUL -> 24
                DEX_COMPANION_MOOD_FOCUS -> 12
                else -> 18
            }
        }
    }

    private fun companionMouthAlpha(state: String): Float {
        return when (state) {
            DEX_COMPANION_STATE_SLEEPING -> 0.65f
            DEX_COMPANION_STATE_EXCITED, DEX_COMPANION_STATE_PENDING -> 1f
            DEX_COMPANION_STATE_LISTENING, DEX_COMPANION_STATE_ALERT, DEX_COMPANION_STATE_THINKING -> 0.82f
            else -> when (currentDexCompanionMood.lowercase(Locale.US)) {
                DEX_COMPANION_MOOD_PLAYFUL -> 1f
                DEX_COMPANION_MOOD_FOCUS -> 0.84f
                else -> 0.92f
            }
        }
    }

    private fun companionBubbleAlpha(state: String): Float {
        return when (state) {
            DEX_COMPANION_STATE_SLEEPING -> 0.9f
            DEX_COMPANION_STATE_THINKING -> 0.97f
            DEX_COMPANION_STATE_LISTENING, DEX_COMPANION_STATE_TALKING -> 1f
            DEX_COMPANION_STATE_PENDING -> 0.99f
            else -> when (currentDexCompanionMood.lowercase(Locale.US)) {
                DEX_COMPANION_MOOD_PLAYFUL -> 1f
                DEX_COMPANION_MOOD_FOCUS -> 0.96f
                else -> 0.98f
            }
        }
    }

    private fun companionBubbleRotation(state: String): Float {
        return when (state) {
            DEX_COMPANION_STATE_THINKING -> -0.6f
            DEX_COMPANION_STATE_EXCITED -> -2f
            DEX_COMPANION_STATE_PENDING -> -1f
            else -> {
                val idleProfile = dexCompanionPersonalityIdleProfile()
                if (state == DEX_COMPANION_STATE_IDLE) idleProfile.bubbleRotation
                else if (currentDexCompanionMood.lowercase(Locale.US) == DEX_COMPANION_MOOD_PLAYFUL) -1.5f
                else 0f
            }
        }
    }

    private fun companionEyeScale(state: String): Float {
        return when (state) {
            DEX_COMPANION_STATE_SLEEPING -> 0.45f
            DEX_COMPANION_STATE_LISTENING -> 1.25f
            DEX_COMPANION_STATE_EXCITED -> 1.15f
            DEX_COMPANION_STATE_THINKING -> 0.9f
            DEX_COMPANION_STATE_ALERT -> 0.85f
            else -> if (state == DEX_COMPANION_STATE_IDLE) dexCompanionPersonalityIdleProfile().eyeScale else 1f
        }
    }

    private fun companionFaceScale(state: String): Float {
        return when (state) {
            DEX_COMPANION_STATE_EXCITED -> 1.05f
            DEX_COMPANION_STATE_PENDING -> 1.03f
            else -> if (state == DEX_COMPANION_STATE_IDLE) dexCompanionPersonalityIdleProfile().faceScale else 1f
        }
    }

    private data class DexCompanionSkinColors(
        val accent: Int,
        val card: Int,
        val faceBase: Int,
    )

    private data class DexCompanionIdleProfile(
        val bobDistanceDp: Int,
        val durationMs: Long,
        val labelShiftDp: Int,
        val bubbleRotation: Float,
        val eyeScale: Float,
        val faceScale: Float,
        val blinkDelayMs: Long,
    )

    private data class DexCompanionStatusSpec(
        val labelRes: Int,
        val chipColor: Int,
        val dotColor: Int,
        val textColor: Int,
    )

    private fun dexCompanionStatusSpec(state: String, accentColor: Int): DexCompanionStatusSpec {
        val textColor = android.graphics.Color.WHITE
        return when (state) {
            DEX_COMPANION_STATE_SLEEPING -> DexCompanionStatusSpec(
                labelRes = R.string.dex_companion_status_sleeping,
                chipColor = ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_button_muted), 228),
                dotColor = ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_text_secondary), 170),
                textColor = textColor
            )
            DEX_COMPANION_STATE_LISTENING -> DexCompanionStatusSpec(
                labelRes = R.string.dex_companion_status_listening,
                chipColor = ColorUtils.setAlphaComponent(accentColor, 210),
                dotColor = accentColor,
                textColor = textColor
            )
            DEX_COMPANION_STATE_THINKING -> DexCompanionStatusSpec(
                labelRes = R.string.dex_companion_status_thinking,
                chipColor = ColorUtils.setAlphaComponent(ColorUtils.blendARGB(accentColor, android.graphics.Color.WHITE, 0.2f), 220),
                dotColor = ColorUtils.blendARGB(accentColor, android.graphics.Color.WHITE, 0.35f),
                textColor = textColor
            )
            DEX_COMPANION_STATE_TALKING -> DexCompanionStatusSpec(
                labelRes = R.string.dex_companion_status_talking,
                chipColor = ColorUtils.setAlphaComponent(ColorUtils.blendARGB(accentColor, android.graphics.Color.BLACK, 0.2f), 230),
                dotColor = accentColor,
                textColor = textColor
            )
            DEX_COMPANION_STATE_PENDING -> DexCompanionStatusSpec(
                labelRes = R.string.dex_companion_status_pending,
                chipColor = ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_button_healthy), 230),
                dotColor = getColorCompat(R.color.dex_button_healthy),
                textColor = textColor
            )
            DEX_COMPANION_STATE_ALERT -> DexCompanionStatusSpec(
                labelRes = R.string.dex_companion_status_alert,
                chipColor = ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_button_warn), 235),
                dotColor = getColorCompat(R.color.dex_admin_signal),
                textColor = textColor
            )
            else -> DexCompanionStatusSpec(
                labelRes = R.string.dex_companion_status_ready,
                chipColor = ColorUtils.setAlphaComponent(getColorCompat(R.color.dex_hint_ready_bg), 220),
                dotColor = accentColor,
                textColor = textColor
            )
        }
    }

    private fun dexCompanionPersonalityIdleProfile(): DexCompanionIdleProfile {
        return when (currentDexCompanionPersonality.lowercase(Locale.US)) {
            DEX_COMPANION_PERSONALITY_BESTIE -> DexCompanionIdleProfile(
                bobDistanceDp = 9,
                durationMs = 1550L,
                labelShiftDp = 3,
                bubbleRotation = -2.2f,
                eyeScale = 1.08f,
                faceScale = 1.04f,
                blinkDelayMs = 1600L
            )
            DEX_COMPANION_PERSONALITY_GUARDIAN -> DexCompanionIdleProfile(
                bobDistanceDp = 3,
                durationMs = 2550L,
                labelShiftDp = 0,
                bubbleRotation = 0f,
                eyeScale = 0.96f,
                faceScale = 1.01f,
                blinkDelayMs = 3400L
            )
            DEX_COMPANION_PERSONALITY_STUDY_BUDDY -> DexCompanionIdleProfile(
                bobDistanceDp = 4,
                durationMs = 2350L,
                labelShiftDp = 1,
                bubbleRotation = -0.5f,
                eyeScale = 1.02f,
                faceScale = 1.02f,
                blinkDelayMs = 2800L
            )
            else -> DexCompanionIdleProfile(
                bobDistanceDp = 5,
                durationMs = 1950L,
                labelShiftDp = 1,
                bubbleRotation = -0.8f,
                eyeScale = 1f,
                faceScale = 1.03f,
                blinkDelayMs = 2200L
            )
        }
    }

    private fun dexCompanionSkinColors(): DexCompanionSkinColors {
        return when (currentDexCompanionSkin.lowercase(Locale.US)) {
            DEX_COMPANION_SKIN_MINT -> DexCompanionSkinColors(
                accent = getColorCompat(R.color.dex_affiliate_signal),
                card = getColorCompat(R.color.dex_affiliate_panel),
                faceBase = getColorCompat(R.color.dex_affiliate_readout)
            )
            DEX_COMPANION_SKIN_SUNSET -> DexCompanionSkinColors(
                accent = getColorCompat(R.color.dex_admin_signal),
                card = getColorCompat(R.color.dex_admin_panel),
                faceBase = getColorCompat(R.color.dex_admin_readout)
            )
            DEX_COMPANION_SKIN_VIOLET -> DexCompanionSkinColors(
                accent = android.graphics.Color.parseColor("#B18CFF"),
                card = android.graphics.Color.parseColor("#241E33"),
                faceBase = android.graphics.Color.parseColor("#34284A")
            )
            else -> DexCompanionSkinColors(
                accent = runCatching { android.graphics.Color.parseColor(currentAccentColor) }
                    .getOrElse { getColorCompat(R.color.dex_accent) },
                card = getColorCompat(R.color.dex_panel),
                faceBase = getColorCompat(R.color.dex_user_readout)
            )
        }
    }

    private fun startDexCompanionAnimation() {
        stopDexCompanionAnimation()
        val idleProfile = dexCompanionPersonalityIdleProfile()
        val motionKey = if (dexCompanionState == DEX_COMPANION_STATE_EXCITED || dexCompanionState == DEX_COMPANION_STATE_PENDING) {
            DEX_COMPANION_MOOD_PLAYFUL
        } else if (dexCompanionState == DEX_COMPANION_STATE_ALERT || dexCompanionState == DEX_COMPANION_STATE_LISTENING) {
            DEX_COMPANION_MOOD_FOCUS
        } else {
            currentDexCompanionMood.lowercase(Locale.US)
        }
        val bobDistance = dpToPx(
            when {
                dexCompanionState == DEX_COMPANION_STATE_IDLE -> idleProfile.bobDistanceDp
                motionKey == DEX_COMPANION_MOOD_PLAYFUL -> 8
                motionKey == DEX_COMPANION_MOOD_FOCUS -> 4
                else -> 6
            }
        ).toFloat()
        val duration = when {
            dexCompanionState == DEX_COMPANION_STATE_IDLE -> idleProfile.durationMs
            motionKey == DEX_COMPANION_MOOD_PLAYFUL -> 1700L
            motionKey == DEX_COMPANION_MOOD_FOCUS -> 2400L
            else -> 2100L
        }
        val faceAnimator = ObjectAnimator.ofFloat(binding.dexCompanionFace, View.TRANSLATION_Y, 0f, -bobDistance, 0f).apply {
            this.duration = duration
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
        }
        val faceDriftAnimator = ObjectAnimator.ofFloat(
            binding.dexCompanionFace,
            View.TRANSLATION_X,
            0f,
            when {
                motionKey == DEX_COMPANION_MOOD_PLAYFUL -> dpToPx(4).toFloat()
                dexCompanionState == DEX_COMPANION_STATE_ALERT -> -dpToPx(2).toFloat()
                else -> dpToPx(2).toFloat()
            },
            0f
        ).apply {
            this.duration = duration + 450L
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
        }
        val faceTiltAnimator = ObjectAnimator.ofFloat(
            binding.dexCompanionFace,
            View.ROTATION,
            -2.5f,
            if (motionKey == DEX_COMPANION_MOOD_PLAYFUL) 3.5f else 2f,
            -2.5f
        ).apply {
            this.duration = duration + 700L
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
        }
        val bubbleAnimator = ObjectAnimator.ofFloat(
            binding.dexCompanionBubble,
            View.TRANSLATION_Y,
            0f,
            -(bobDistance * 0.5f),
            0f
        ).apply {
            this.duration = duration
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
        }
        val labelAnimator = ObjectAnimator.ofFloat(
            binding.dexCompanionLabel,
            View.TRANSLATION_X,
            0f,
            when {
                dexCompanionState == DEX_COMPANION_STATE_IDLE -> dpToPx(idleProfile.labelShiftDp).toFloat()
                motionKey == DEX_COMPANION_MOOD_PLAYFUL -> dpToPx(2).toFloat()
                else -> 0f
            },
            0f
        ).apply {
            this.duration = duration
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
        }
        val eyePulse = ObjectAnimator.ofFloat(
            binding.dexCompanionEyeLeft,
            View.ALPHA,
            0.72f,
            1f,
            0.78f
        ).apply {
            this.duration = duration - 120L
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
        }
        val eyePulseRight = ObjectAnimator.ofFloat(
            binding.dexCompanionEyeRight,
            View.ALPHA,
            0.78f,
            1f,
            0.72f
        ).apply {
            this.duration = duration - 120L
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
        }
        dexCompanionFloatAnimator = AnimatorSet().apply {
            playTogether(faceAnimator, faceDriftAnimator, faceTiltAnimator, bubbleAnimator, labelAnimator, eyePulse, eyePulseRight)
            start()
        }
    }

    private fun playDexCompanionEventAnimation(state: String) {
        dexCompanionEventAnimator?.cancel()
        binding.dexCompanionFace.scaleX = companionFaceScale(state)
        binding.dexCompanionFace.scaleY = companionFaceScale(state)
        binding.dexCompanionBubble.scaleX = 1f
        binding.dexCompanionBubble.scaleY = 1f
        val accessoryHaloVisible = currentDexCompanionAccessory.lowercase(Locale.US) == DEX_COMPANION_ACCESSORY_HALO
        binding.dexCompanionHalo.alpha =
            if (binding.dexCompanionHalo.visibility == View.VISIBLE) dexGamesTierHaloAlpha(accessoryHaloVisible) else 0f

        val role = currentDexCompanionPersonality.lowercase(Locale.US)
        val facePeak = when (role) {
            DEX_COMPANION_PERSONALITY_BESTIE -> 1.14f
            DEX_COMPANION_PERSONALITY_GUARDIAN -> 1.04f
            DEX_COMPANION_PERSONALITY_STUDY_BUDDY -> 1.06f
            else -> 1.08f
        }
        val bubblePeak = when (role) {
            DEX_COMPANION_PERSONALITY_BESTIE -> 1.1f
            DEX_COMPANION_PERSONALITY_GUARDIAN -> 1.03f
            DEX_COMPANION_PERSONALITY_STUDY_BUDDY -> 1.04f
            else -> 1.05f
        }
        val duration = when (role) {
            DEX_COMPANION_PERSONALITY_BESTIE -> 260L
            DEX_COMPANION_PERSONALITY_GUARDIAN -> 360L
            DEX_COMPANION_PERSONALITY_STUDY_BUDDY -> 320L
            else -> 300L
        }

        val facePulseX = ObjectAnimator.ofFloat(binding.dexCompanionFace, View.SCALE_X, 1f, facePeak, 1f).apply {
            this.duration = duration.toLong()
        }
        val facePulseY = ObjectAnimator.ofFloat(binding.dexCompanionFace, View.SCALE_Y, 1f, facePeak, 1f).apply {
            this.duration = duration.toLong()
        }
        val bubblePulseX = ObjectAnimator.ofFloat(binding.dexCompanionBubble, View.SCALE_X, 1f, bubblePeak, 1f).apply {
            this.duration = duration.toLong()
        }
        val bubblePulseY = ObjectAnimator.ofFloat(binding.dexCompanionBubble, View.SCALE_Y, 1f, bubblePeak, 1f).apply {
            this.duration = duration.toLong()
        }
        val labelLift = ObjectAnimator.ofFloat(
            binding.dexCompanionLabel,
            View.TRANSLATION_Y,
            0f,
            -dpToPx(if (role == DEX_COMPANION_PERSONALITY_BESTIE) 3 else 2).toFloat(),
            0f
        ).apply {
            this.duration = duration.toLong()
        }

        val animators = mutableListOf<Animator>(facePulseX, facePulseY, bubblePulseX, bubblePulseY, labelLift)
        if (role == DEX_COMPANION_PERSONALITY_GUARDIAN && state == DEX_COMPANION_STATE_ALERT && binding.dexCompanionHalo.visibility == View.VISIBLE) {
            animators += ObjectAnimator.ofFloat(binding.dexCompanionHalo, View.ALPHA, 0.3f, 1f, 0.55f).apply {
                this.duration = (duration + 120L)
            }
        }
        if (role == DEX_COMPANION_PERSONALITY_STUDY_BUDDY && currentDexCompanionAccessory == DEX_COMPANION_ACCESSORY_HEADPHONES) {
            animators += ObjectAnimator.ofFloat(
                binding.dexCompanionHeadphonesBand,
                View.TRANSLATION_Y,
                0f,
                -dpToPx(1).toFloat(),
                0f
            ).apply { this.duration = duration.toLong() }
        }

        dexCompanionEventAnimator = AnimatorSet().apply {
            playTogether(animators)
            start()
        }
    }

    private fun stopDexCompanionAnimation() {
        dexCompanionFloatAnimator?.cancel()
        dexCompanionFloatAnimator = null
        dexCompanionEventAnimator?.cancel()
        dexCompanionEventAnimator = null
        binding.dexCompanionFace.translationY = 0f
        binding.dexCompanionFace.translationX = 0f
        binding.dexCompanionFace.rotation = 0f
        binding.dexCompanionBubble.translationY = 0f
        binding.dexCompanionLabel.translationX = 0f
        binding.dexCompanionLabel.translationY = 0f
        binding.dexCompanionBubble.scaleX = 1f
        binding.dexCompanionBubble.scaleY = 1f
        binding.dexCompanionEyeLeft.scaleY = 1f
        binding.dexCompanionEyeRight.scaleY = 1f
        binding.dexCompanionEyeLeft.alpha = 1f
        binding.dexCompanionEyeRight.alpha = 1f
    }

    private fun scheduleDexCompanionBlink() {
        if (dexCompanionBlinkScheduled || binding.dexCompanionCard.visibility != View.VISIBLE) return
        val delay = when {
            dexCompanionState == DEX_COMPANION_STATE_IDLE -> dexCompanionPersonalityIdleProfile().blinkDelayMs
            currentDexCompanionMood.lowercase(Locale.US) == DEX_COMPANION_MOOD_PLAYFUL -> 1800L
            currentDexCompanionMood.lowercase(Locale.US) == DEX_COMPANION_MOOD_FOCUS -> 3200L
            else -> 2500L
        }
        dexCompanionBlinkScheduled = true
        mainHandler.postDelayed(dexCompanionBlinkRunnable, delay)
    }

    private fun blinkDexCompanion() {
        listOf(binding.dexCompanionEyeLeft, binding.dexCompanionEyeRight).forEach { eye ->
            eye.animate()
                .scaleY(0.15f)
                .setDuration(90L)
                .withEndAction {
                    eye.animate()
                        .scaleY(1f)
                        .setDuration(110L)
                        .start()
                }
                .start()
        }
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
                binding.safetyProfileCard,
                binding.lifeSectionsCard,
                binding.billingCard,
                binding.affiliateDashboardCard,
                binding.adminDashboardCard,
                binding.themeCard,
                binding.serverCard,
                binding.permissionsCard,
                binding.backgroundAccessCard,
                binding.callMonitorCard,
                binding.voiceCard,
                binding.conversationCard
            ).forEach { card ->
                card.setCardBackgroundColor(panelColor)
            }
            applyRoleDashboardMood(currentUserRole.lowercase(Locale.US))

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
            applyDexCompanionUi()
            true
        }.getOrDefault(false)
    }

    private fun refreshVoiceStatus() {
        val baseStatus = ttsStatusMessage ?: if (ttsReady) getString(R.string.voice_ready) else getString(R.string.voice_not_ready)
        val wakeStatus = when {
            wakeWordEngine?.isConfigured() == true -> getString(R.string.wake_engine_ready)
            else -> getString(R.string.wake_engine_setup_needed)
        }
        binding.voiceStatus.text = "$baseStatus\n$wakeStatus"
        binding.testVoiceButton.isEnabled = ttsReady
        refreshInteractionStates()
    }

    private fun updateWakeUi() {
        binding.wakeModeButton.text =
            if (wakeModeEnabled) getString(R.string.stop_wake_mode) else getString(R.string.start_wake_mode)
        if (!wakeModeEnabled) {
            binding.conversationStatus.text = getString(R.string.wake_mode_off)
        }
        refreshInteractionStates()
    }

    private fun updatePendingActionUi() {
        val action = pendingAction
        binding.pendingActionCard.visibility = if (action == null) View.GONE else View.VISIBLE
        if (action != null) {
            binding.pendingActionSummary.text = action.summary
            binding.pendingActionDetail.text = action.detail
        }
        if (action != null) {
            setDexCompanionState(
                DEX_COMPANION_STATE_PENDING,
                bubbleOverride = getString(R.string.dex_companion_bubble_pending),
                revertAfterMs = 2600L
            )
        } else {
            restoreDexCompanionState()
        }
        refreshInteractionStates()
    }

    private fun currentServerUrl(): String {
        val rawValue = binding.serverUrlInput.text?.toString()
        return normalizeServerUrl(rawValue)
    }

    private fun ensureDefaultWakeWordSetup() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val currentModel = prefs.getString(KEY_VOSK_MODEL_ASSET, null).orEmpty().trim()
        val currentPhrase = prefs.getString(KEY_VOSK_WAKE_PHRASE, null).orEmpty().trim()
        val editor = prefs.edit()
        var changed = false
        if (currentModel.isBlank()) {
            editor.putString(KEY_VOSK_MODEL_ASSET, DEFAULT_VOSK_MODEL_ASSET)
            changed = true
        }
        if (currentPhrase.isBlank()) {
            editor.putString(KEY_VOSK_WAKE_PHRASE, DEFAULT_VOSK_WAKE_PHRASE)
            changed = true
        }
        if (changed) editor.apply()
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

    @Suppress("UNUSED_PARAMETER")
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
        if (responseCode == 401) {
            return getString(R.string.auth_session_expired)
        }
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

    private fun isExpiredSessionMessage(message: String?): Boolean {
        val normalized = message?.trim()?.lowercase(Locale.US).orEmpty()
        if (normalized.isBlank()) return false
        return normalized.contains("session expired") ||
            normalized.contains("invalid or expired token") ||
            normalized.contains("expired token") ||
            normalized.contains("unauthorized")
    }

    private fun handleExpiredSession() {
        clearSession()
        val reply = getString(R.string.auth_session_expired)
        binding.authMessage.text = reply
        binding.conversationStatus.text = reply
        binding.lastReplyValue.text = reply
    }

    private fun login() {
        val email = binding.emailInput.text?.toString()?.trim().orEmpty()
        val password = binding.passwordInput.text?.toString().orEmpty()
        if (email.isBlank() || password.isBlank()) {
            binding.authMessage.text = getString(R.string.auth_email_password_required)
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
            binding.authMessage.text = getString(R.string.auth_email_password_required)
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
            binding.authMessage.text = getString(R.string.auth_backend_required)
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
                    binding.authMessage.text = getString(R.string.auth_token_missing)
                    return@onSuccess
                }
                saveSession(token, email, user)
                binding.authMessage.text = getString(R.string.connected_as, email)
            }.onFailure { error ->
                binding.authMessage.text = error.message ?: getString(R.string.auth_sign_in_failed)
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
            }.onFailure { error ->
                if (isExpiredSessionMessage(error.message)) {
                    handleExpiredSession()
                }
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
                val autoAnswerKnown = permissions?.optBoolean("autoAnswerKnownContacts") ?: false
                val autoAnswerAny = permissions?.optBoolean("autoAnswerAnyNonSpam") ?: false
                val autoDeclineSpam = permissions?.optBoolean("autoDeclineSpam") ?: true
                phoneBackendEnabled = phoneEnabled
                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putBoolean(KEY_PHONE_BACKEND_ENABLED, phoneEnabled)
                    .putBoolean(KEY_AUTO_ANSWER_KNOWN_CONTACTS, autoAnswerKnown)
                    .putBoolean(KEY_AUTO_ANSWER_ANY_NON_SPAM, autoAnswerAny)
                    .putBoolean(KEY_AUTO_DECLINE_SPAM, autoDeclineSpam)
                    .apply()
                applyPermissions(
                    mapOf(
                        "phone" to phoneEnabled,
                        "calendar" to (permissions?.optBoolean("calendar") ?: false),
                        "notifications" to (permissions?.optBoolean("notifications") ?: false),
                        "autoAnswerKnownContacts" to autoAnswerKnown,
                        "autoAnswerAnyNonSpam" to autoAnswerAny,
                        "autoDeclineSpam" to autoDeclineSpam
                    )
                )
                binding.permissionsMessage.text = getString(R.string.permissions_synced)
                refreshCallMonitorState()
            }.onFailure { error ->
                if (isExpiredSessionMessage(error.message)) {
                    handleExpiredSession()
                    setPermissionsLoading(false)
                    return@onFailure
                }
                binding.permissionsMessage.text = error.message ?: getString(R.string.permissions_load_failed)
                refreshCallMonitorState()
            }
        }
    }

    private fun fetchLearningReminderPreferences() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        showLearningLoadingState()
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
                        learningProfileMissingCopy()
                    } else {
                        getString(R.string.learning_profile_summary, language, level, focus)
                    }
                setHintBand(
                    binding.learningCenterHint,
                    if (preferences.optString("learning_target_language").isBlank()) {
                        learningHintCopy()
                    } else if (enabled && time.isNotBlank()) {
                        getString(R.string.learning_hint_active_reminder)
                    } else {
                        getString(R.string.learning_hint_active_ready)
                    },
                    if (preferences.optString("learning_target_language").isBlank()) {
                        HintTone.NEXT_STEP
                    } else if (enabled && time.isNotBlank()) {
                        HintTone.HEALTHY
                    } else {
                        HintTone.READY
                    }
                )
                binding.learningReminderSummary.text =
                    if (enabled && time.isNotBlank()) getString(R.string.learning_reminder_on, time)
                    else getString(R.string.learning_reminder_off)
                pulseDashboardValues(binding.learningProfileSummary, binding.learningReminderSummary)

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
                completeSectionRefresh(
                    binding.learningCenterStatus,
                    binding.learningCenterCard,
                    currentUserRole.lowercase(Locale.US)
                )
            }.onFailure {
                // Keep reminder sync quiet if preferences are unavailable.
                binding.learningProfileSummary.text = learningProfileMissingCopy()
                binding.learningReminderSummary.text = getString(R.string.learning_reminder_off)
                setHintBand(binding.learningCenterHint, learningHintCopy(), HintTone.NEXT_STEP)
                pulseDashboardValues(binding.learningProfileSummary, binding.learningReminderSummary)
                completeSectionRefresh(
                    binding.learningCenterStatus,
                    binding.learningCenterCard,
                    currentUserRole.lowercase(Locale.US)
                )
            }
        }
    }

    private fun fetchSafetyPreferences() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            val result = getJson("$serverUrl/dex/preferences", token)
            result.onSuccess { response ->
                val preferences = response.optJSONObject("preferences") ?: JSONObject()
                val emergencyPersonName = preferences.optString("safety_person_name")
                val emergencyBirthday = normalizeBirthdayInput(preferences.optString("safety_birthday"))
                val emergencyContact = preferences.optString("emergency_contact")
                val comfortStyle = preferences.optString("comfort_style").ifBlank { "calm" }
                val groundingPreference = preferences.optString("grounding_preference").ifBlank { "gentle" }
                val contactPermission = preferences.optString("emergency_contact_permission") == "1"
                val followUp = preferences.optString("safety_follow_up_opt_in") == "1"

                getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString(KEY_EMERGENCY_PROFILE_NAME, emergencyPersonName)
                    .putString(KEY_EMERGENCY_PROFILE_BIRTHDAY, emergencyBirthday)
                    .putString(KEY_EMERGENCY_CONTACT, emergencyContact)
                    .putBoolean(KEY_EMERGENCY_CONTACT_PERMISSION, contactPermission)
                    .putString(KEY_SAFETY_COMFORT_STYLE, comfortStyle)
                    .putString(KEY_SAFETY_GROUNDING_STYLE, groundingPreference)
                    .putBoolean(KEY_SAFETY_FOLLOW_UP_OPT_IN, followUp)
                    .apply()
                binding.safetyNameInput.setText(emergencyPersonName)
                binding.safetyBirthdayInput.setText(emergencyBirthday)
                binding.safetyContactInput.setText(emergencyContact)
                binding.safetyComfortInput.setText(comfortStyle)
                binding.safetyGroundingInput.setText(groundingPreference)
                binding.safetyNotifyTrustedContactSwitch.isChecked = contactPermission
                binding.safetyFollowUpSwitch.isChecked = followUp
                binding.safetyProfileSummary.text =
                    if (emergencyPersonName.isBlank() && emergencyBirthday.isBlank() && emergencyContact.isBlank()) {
                        getString(R.string.safety_profile_default)
                    } else {
                        getString(
                            R.string.safety_profile_loaded,
                            emergencyPersonName.ifBlank { resolveEmergencyPersonName() },
                            emergencyBirthday.ifBlank { getString(R.string.safety_birthday_unknown) },
                            comfortStyle.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() },
                            groundingPreference.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() },
                            emergencyContact
                        )
                    }
                binding.safetyProfileMessage.text =
                    if (contactPermission) getString(R.string.safety_notify_contact)
                    else getString(R.string.safety_contact_none)
                refreshSafetyDiagnostics()
            }.onFailure {
                binding.safetyProfileSummary.text = getString(R.string.safety_profile_default)
                binding.safetyProfileMessage.text = getString(R.string.safety_contact_none)
                refreshSafetyDiagnostics()
            }
        }
    }

    private fun fetchRelationshipAliases() {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        lifecycleScope.launch {
            val result = getJson("$serverUrl/dex/relationship-aliases", token)
            result.onSuccess { response ->
                relationshipAliases = parseRelationshipAliases(response.optJSONArray("aliases"))
                    .toMutableMap()
                    .apply { putAll(loadLocalRelationshipAliases()) }
                refreshRelationshipAliasSummary()
            }.onFailure {
                relationshipAliases = loadLocalRelationshipAliases()
                refreshRelationshipAliasSummary()
            }
        }
    }

    private fun parseRelationshipAliases(aliases: JSONArray?): Map<String, String> {
        val map = mutableMapOf<String, String>()
        val items = aliases ?: return emptyMap()
        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index) ?: continue
            val alias = item.optString("alias").trim().lowercase(Locale.US)
            val contactName = item.optString("contact_name").trim()
            if (alias.isNotBlank() && contactName.isNotBlank()) {
                map[alias] = contactName
            }
        }
        return map
    }

    private fun loadLocalRelationshipAliases(): Map<String, String> {
        val raw = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_LOCAL_RELATIONSHIP_ALIASES, null)
            .orEmpty()
        if (raw.isBlank()) return emptyMap()
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return emptyMap()
        val map = mutableMapOf<String, String>()
        json.keys().forEach { key ->
            val alias = key.trim().lowercase(Locale.US)
            val contactName = json.optString(key).trim()
            if (alias.isNotBlank() && contactName.isNotBlank()) {
                map[alias] = contactName
            }
        }
        return map
    }

    private fun persistLocalRelationshipAliases(aliases: Map<String, String>) {
        val json = JSONObject()
        aliases.toSortedMap().forEach { (alias, contactName) ->
            json.put(alias, contactName)
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LOCAL_RELATIONSHIP_ALIASES, json.toString())
            .apply()
    }

    private fun saveLocalRelationshipAlias() {
        val alias = binding.aliasNameInput.text?.toString()?.trim().orEmpty().lowercase(Locale.US)
        val contactName = binding.aliasContactInput.text?.toString()?.trim().orEmpty()
        if (alias.isBlank() || contactName.isBlank()) {
            binding.safetyProfileMessage.text = getString(R.string.alias_missing)
            return
        }
        val localAliases = loadLocalRelationshipAliases().toMutableMap()
        localAliases[alias] = contactName
        persistLocalRelationshipAliases(localAliases)
        relationshipAliases = relationshipAliases.toMutableMap().apply { put(alias, contactName) }
        binding.aliasNameInput.setText("")
        binding.aliasContactInput.setText("")
        binding.safetyProfileMessage.text = getString(R.string.alias_saved)
        refreshRelationshipAliasSummary()
    }

    private fun tryAutoLearnRelationshipAlias(spokenPhrase: String, contactName: String) {
        val alias = normalizeAutoLearnedAlias(spokenPhrase)
        if (!shouldAutoLearnAlias(alias, contactName)) return

        val existing = relationshipAliases[alias]
        if (!existing.isNullOrBlank() && normalizeContactLookupText(existing) == normalizeContactLookupText(contactName)) {
            return
        }

        val localAliases = loadLocalRelationshipAliases().toMutableMap()
        if (normalizeContactLookupText(localAliases[alias].orEmpty()) == normalizeContactLookupText(contactName)) {
            return
        }

        localAliases[alias] = contactName
        persistLocalRelationshipAliases(localAliases)
        relationshipAliases = relationshipAliases.toMutableMap().apply { put(alias, contactName) }
        refreshRelationshipAliasSummary()
        appendActivityLog("Learning", "Learned \"$alias\" as $contactName")
    }

    private fun normalizeAutoLearnedAlias(spokenPhrase: String): String {
        return spokenPhrase
            .trim()
            .lowercase(Locale.US)
            .replace(Regex("^(?:to\\s+|my\\s+|the\\s+)"), "")
            .replace(Regex("\\s+(?:for me|please)$"), "")
            .replace(Regex("[^a-z0-9 ]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun shouldAutoLearnAlias(alias: String, contactName: String): Boolean {
        if (alias.isBlank() || alias.length < 3) return false
        if (alias.all { it.isDigit() }) return false
        if (alias.split(" ").size > 4) return false
        if (normalizeContactLookupText(alias) == normalizeContactLookupText(contactName)) return false
        return alias !in setOf(
            "someone",
            "somebody",
            "person",
            "contact",
            "him",
            "her",
            "them",
            "that person"
        )
    }

    private fun clearLocalRelationshipAliases() {
        persistLocalRelationshipAliases(emptyMap())
        fetchRelationshipAliases()
        binding.safetyProfileMessage.text = getString(R.string.alias_clear_done)
    }

    private fun loadLocalContactActionPreferences(): Map<String, Map<String, Int>> {
        val raw = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_CONTACT_ACTION_PREFERENCES, null)
            .orEmpty()
        if (raw.isBlank()) return emptyMap()
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return emptyMap()
        val map = mutableMapOf<String, Map<String, Int>>()
        json.keys().forEach { contactKey ->
            val countsObject = json.optJSONObject(contactKey) ?: return@forEach
            val counts = mutableMapOf<String, Int>()
            countsObject.keys().forEach { actionKey ->
                val count = countsObject.optInt(actionKey, 0)
                if (count > 0) counts[actionKey] = count
            }
            if (counts.isNotEmpty()) {
                map[contactKey] = counts
            }
        }
        return map
    }

    private fun persistLocalContactActionPreferences(preferences: Map<String, Map<String, Int>>) {
        val json = JSONObject()
        preferences.toSortedMap().forEach { (contactKey, counts) ->
            val countsObject = JSONObject()
            counts.toSortedMap().forEach { (actionKey, count) ->
                if (count > 0) countsObject.put(actionKey, count)
            }
            json.put(contactKey, countsObject)
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_CONTACT_ACTION_PREFERENCES, json.toString())
            .apply()
    }

    private fun recordContactActionPreference(displayName: String, action: PendingContactAction, weight: Int = 1) {
        val contactKey = normalizeCompactContactText(displayName)
        if (contactKey.isBlank()) return
        val preferences = loadLocalContactActionPreferences().toMutableMap()
        val counts = preferences[contactKey]?.toMutableMap() ?: mutableMapOf()
        val actionKey = actionPreferenceKey(action)
        counts[actionKey] = (counts[actionKey] ?: 0) + max(1, weight)
        preferences[contactKey] = counts
        persistLocalContactActionPreferences(preferences)
    }

    private fun preferredContactAction(displayName: String): PendingContactAction? {
        val contactKey = normalizeCompactContactText(displayName)
        if (contactKey.isBlank()) return null
        val counts = loadLocalContactActionPreferences()[contactKey].orEmpty()
        if (counts.isEmpty()) return null
        val ranked = counts.entries.sortedByDescending { it.value }
        val top = ranked.firstOrNull() ?: return null
        val second = ranked.getOrNull(1)?.value ?: 0
        val total = counts.values.sum()
        if (total < 3 || top.value < 2 || top.value < second + 2) return null
        return actionPreferenceFromKey(top.key)
    }

    private fun actionPreferenceKey(action: PendingContactAction): String =
        when (action) {
            PendingContactAction.CALL -> "call"
            PendingContactAction.TEXT -> "text"
            PendingContactAction.EMAIL -> "email"
        }

    private fun actionPreferenceFromKey(actionKey: String): PendingContactAction? =
        when (actionKey) {
            "call" -> PendingContactAction.CALL
            "text" -> PendingContactAction.TEXT
            "email" -> PendingContactAction.EMAIL
            else -> null
        }

    private fun preferredContactActionLabel(action: PendingContactAction): String =
        when (action) {
            PendingContactAction.CALL -> "call"
            PendingContactAction.TEXT -> "text"
            PendingContactAction.EMAIL -> "email"
        }

    private fun preferredContactActionOptions(action: PendingContactAction): String =
        when (action) {
            PendingContactAction.CALL -> "call, text, or email"
            PendingContactAction.TEXT -> "text, call, or email"
            PendingContactAction.EMAIL -> "email, call, or text"
        }

    private fun refreshRelationshipAliasSummary() {
        if (!::binding.isInitialized) return
        val localAliases = loadLocalRelationshipAliases()
        binding.aliasSummaryValue.text =
            if (localAliases.isEmpty()) {
                getString(R.string.alias_summary_none)
            } else {
                localAliases.entries
                    .sortedBy { it.key }
                    .joinToString("\n") { "${it.key} -> ${it.value}" }
            }
    }

    private fun appendActivityLog(category: String, detail: String) {
        appendPersistentActivityLog(this, category, detail)
        refreshActivityLogFromPrefs()
    }

    private fun refreshActivityLogFromPrefs() {
        if (!::binding.isInitialized) return
        activityLogEntries.clear()
        activityLogEntries.addAll(readPersistentActivityLog(this))
        binding.activityLogValue.text =
            if (activityLogEntries.isEmpty()) getString(R.string.activity_log_empty)
            else activityLogEntries.joinToString("\n")
    }

    private fun refreshCallMessageLogFromPrefs() {
        if (!::binding.isInitialized) return
        val records = readPersistentCallMessageRecords(this)
        val visibleRecords =
            if (showUnhandledCallerMessagesOnly) records.filter { !it.handled } else records
        val messages = visibleRecords.map { formatSavedCallMessageForDisplay(it) }
        binding.callMessageActionButton.text =
            getString(
                if (showUnhandledCallerMessagesOnly) {
                    R.string.call_message_log_title_unhandled
                } else {
                    R.string.call_message_action_button
                }
            )
        binding.callMessageLogValue.text =
            if (messages.isEmpty()) {
                getString(
                    if (showUnhandledCallerMessagesOnly) {
                        R.string.call_message_log_empty_unhandled
                    } else {
                        R.string.call_message_log_empty
                    }
                )
            }
            else messages.joinToString("\n")
        binding.callMessageActionButton.isEnabled = readLatestPersistentCallMessage(this) != null
    }

    private fun toggleCallerMessageFilter() {
        showUnhandledCallerMessagesOnly = !showUnhandledCallerMessagesOnly
        refreshCallMessageLogFromPrefs()
    }

    private fun showSavedCallerMessageActions() {
        val latest = readLatestPersistentCallMessage(this)
        if (latest == null) {
            binding.callMonitorStatus.text = getString(R.string.call_message_log_empty)
            return
        }
        showSavedCallerMessageActions(latest)
    }

    private fun showSavedCallerMessagePicker() {
        val messages = readPersistentCallMessageRecords(this)
        if (messages.isEmpty()) {
            binding.callMonitorStatus.text = getString(R.string.call_message_log_empty)
            return
        }
        val labels = messages.map { describeSavedCallMessageForPicker(it) }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(R.string.call_message_picker_title)
            .setItems(labels) { _, which ->
                messages.getOrNull(which)?.let { showSavedCallerMessageActions(it) }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun showSavedCallerMessageActions(savedMessage: SavedCallMessage) {
        val actionTarget = resolveSavedCallMessageTarget(savedMessage)
        if (actionTarget == null) {
            val reply = getString(R.string.call_message_action_unavailable, savedMessage.callerLabel)
            binding.callMonitorStatus.text = reply
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return
        }

        PopupMenu(this, binding.callMessageActionButton).apply {
            menu.add(0, 1, 0, getString(R.string.call_message_action_call_back))
            menu.add(0, 2, 1, getString(R.string.call_message_action_text_back))
            if (!savedMessage.handled) {
                menu.add(0, 3, 2, getString(R.string.call_message_action_mark_handled))
            }
            if (readPersistentCallMessageRecords(this@MainActivity).any { !it.handled }) {
                menu.add(0, 5, 3, getString(R.string.call_message_action_mark_all_handled))
            }
            menu.add(0, 4, 4, getString(R.string.call_message_action_delete))
            setOnMenuItemClickListener { item ->
                when (item.itemId) {
                    1 -> {
                        placeVoiceRequestedCall(DirectCallRequest(actionTarget.displayName, actionTarget.value))
                        true
                    }
                    2 -> {
                        sendSmsDirect(
                            PendingAction(
                                kind = PendingActionKind.SMS_DRAFT,
                                summary = getString(R.string.call_message_draft_summary, actionTarget.displayName),
                                detail = getString(R.string.call_message_draft_detail, actionTarget.displayName),
                                targetName = actionTarget.displayName,
                                targetValue = actionTarget.value,
                                body = getString(R.string.call_message_text_back_body, actionTarget.displayName)
                            )
                        )
                        true
                    }
                    3 -> {
                        updateSavedCallMessage(savedMessage.copy(handled = true))
                        val reply = getString(R.string.call_message_marked_handled, savedMessage.callerLabel)
                        binding.callMonitorStatus.text = reply
                        true
                    }
                    4 -> {
                        deleteSavedCallMessage(savedMessage)
                        val reply = getString(R.string.call_message_deleted, savedMessage.callerLabel)
                        binding.callMonitorStatus.text = reply
                        true
                    }
                    5 -> {
                        markAllSavedCallerMessagesHandled()
                        true
                    }
                    else -> false
                }
            }
        }.show()
    }

    private fun resolveSavedCallMessageTarget(message: SavedCallMessage): ContactMatch? {
        val directNumber = message.phoneNumber?.trim()?.takeIf { it.isNotBlank() }
        if (directNumber != null) {
            return ContactMatch(message.callerLabel, directNumber)
        }
        return findBestPhoneContactMatch(message.callerLabel, requireExact = false)
    }

    private fun describeSavedCallMessageForPicker(message: SavedCallMessage): String {
        val base = "[${message.timeLabel}] ${message.callerLabel}: ${message.message}"
        return if (message.handled) "$base (${getString(R.string.call_message_handled_label)})" else base
    }

    private fun formatSavedCallMessageForDisplay(message: SavedCallMessage): String {
        return "[${message.timeLabel}] " + if (message.handled) {
            getString(
                R.string.call_message_log_entry_handled,
                message.callerLabel,
                message.message,
                getString(R.string.call_message_handled_label)
            )
        } else {
            getString(R.string.call_message_log_entry, message.callerLabel, message.message)
        }
    }

    private fun updateSavedCallMessage(updated: SavedCallMessage) {
        val records = readPersistentCallMessageRecords(this).toMutableList()
        val index = records.indexOfFirst {
            it.callerLabel == updated.callerLabel &&
                it.phoneNumber == updated.phoneNumber &&
                it.message == updated.message &&
                it.timeLabel == updated.timeLabel
        }
        if (index >= 0) {
            records[index] = updated
            persistSavedCallMessages(records)
            refreshCallMessageLogFromPrefs()
        }
    }

    private fun deleteSavedCallMessage(target: SavedCallMessage) {
        val records = readPersistentCallMessageRecords(this).toMutableList()
        if (records.remove(target)) {
            persistSavedCallMessages(records)
            refreshCallMessageLogFromPrefs()
        }
    }

    private fun markAllSavedCallerMessagesHandled() {
        val records = readPersistentCallMessageRecords(this)
        if (records.none { !it.handled }) {
            binding.callMonitorStatus.text = getString(R.string.call_message_all_handled_empty)
            return
        }
        persistSavedCallMessages(records.map { it.copy(handled = true) })
        refreshCallMessageLogFromPrefs()
        binding.callMonitorStatus.text = getString(R.string.call_message_marked_all_handled)
    }

    private fun persistSavedCallMessages(messages: List<SavedCallMessage>) {
        val payload = JSONArray().apply {
            messages.take(6).forEach { entry ->
                put(
                    JSONObject().apply {
                        put("caller", entry.callerLabel)
                        put("phoneNumber", entry.phoneNumber ?: "")
                        put("message", entry.message)
                        put("time", entry.timeLabel)
                        put("handled", entry.handled)
                    }
                )
            }
        }
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_CALL_MESSAGE_LOG, payload.toString())
            .apply()
    }

    private fun updatePermissions(key: String, enabled: Boolean) {
        val token = authToken ?: return
        val serverUrl = currentServerUrl()
        phoneBackendEnabled = binding.phonePermissionSwitch.isChecked
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_PHONE_BACKEND_ENABLED, phoneBackendEnabled)
            .putBoolean(KEY_NOTIFICATIONS_ENABLED, binding.notificationsPermissionSwitch.isChecked)
            .apply()
        refreshCallMonitorState()
        val payload = JSONObject().apply {
                put("permissions", JSONObject().apply {
                    put("phone", binding.phonePermissionSwitch.isChecked)
                    put("calendar", binding.calendarPermissionSwitch.isChecked)
                    put("notifications", binding.notificationsPermissionSwitch.isChecked)
                    put("autoAnswerKnownContacts", binding.autoAnswerKnownContactsSwitch.isChecked)
                    put("autoAnswerAnyNonSpam", binding.autoAnswerAnyCallerSwitch.isChecked)
                    put("autoDeclineSpam", binding.autoDeclineSpamSwitch.isChecked)
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
                    .putBoolean(KEY_NOTIFICATIONS_ENABLED, binding.notificationsPermissionSwitch.isChecked)
                    .apply()
                binding.permissionsMessage.text =
                    when (key) {
                        "phone" -> getString(if (enabled) R.string.phone_enabled else R.string.phone_disabled)
                        "calendar" -> getString(if (enabled) R.string.calendar_enabled else R.string.calendar_disabled)
                        else -> getString(if (enabled) R.string.notifications_enabled else R.string.notifications_disabled)
                    }
            }.onFailure { error ->
                binding.permissionsMessage.text = error.message ?: getString(R.string.permissions_save_failed)
            }
        }
    }

    private fun applyPermissions(permissions: Map<String, Boolean>) {
        phoneBackendEnabled = permissions["phone"] == true
        binding.phonePermissionSwitch.isChecked = phoneBackendEnabled
        binding.calendarPermissionSwitch.isChecked = permissions["calendar"] == true
        binding.notificationsPermissionSwitch.isChecked = permissions["notifications"] == true
        binding.autoAnswerKnownContactsSwitch.isChecked = permissions["autoAnswerKnownContacts"] == true
        binding.autoAnswerAnyCallerSwitch.isChecked = permissions["autoAnswerAnyNonSpam"] == true
        binding.autoDeclineSpamSwitch.isChecked = permissions["autoDeclineSpam"] != false
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_PHONE_BACKEND_ENABLED, phoneBackendEnabled)
            .putBoolean(KEY_NOTIFICATIONS_ENABLED, permissions["notifications"] == true)
            .putBoolean(KEY_AUTO_ANSWER_KNOWN_CONTACTS, permissions["autoAnswerKnownContacts"] == true)
            .putBoolean(KEY_AUTO_ANSWER_ANY_NON_SPAM, permissions["autoAnswerAnyNonSpam"] == true)
            .putBoolean(KEY_AUTO_DECLINE_SPAM, permissions["autoDeclineSpam"] != false)
            .apply()
    }

    private fun requestAndroidPermissions() {
        AlertDialog.Builder(this)
            .setTitle(R.string.permissions_disclosure_title)
            .setMessage(getString(R.string.permissions_disclosure_message))
            .setNegativeButton(R.string.permissions_disclosure_cancel, null)
            .setPositiveButton(R.string.permissions_disclosure_continue) { _, _ ->
                val permissions = mutableListOf(
                    Manifest.permission.READ_PHONE_STATE,
                    Manifest.permission.READ_CALL_LOG,
                    Manifest.permission.READ_CONTACTS,
                    Manifest.permission.ANSWER_PHONE_CALLS,
                    Manifest.permission.CALL_PHONE,
                    Manifest.permission.SEND_SMS,
                    Manifest.permission.RECEIVE_SMS,
                    Manifest.permission.RECORD_AUDIO
                )
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    permissions += Manifest.permission.POST_NOTIFICATIONS
                }
                permissionLauncher.launch(permissions.toTypedArray())
            }
            .show()
    }

    private fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", packageName, null)
        }
        openSettingsIntent(intent)
    }

    private fun openBatterySettings() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        } else {
            Intent(Settings.ACTION_SETTINGS)
        }
        openSettingsIntent(intent)
    }

    private fun openNotificationSettings() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            }
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            }
        }
        openSettingsIntent(intent)
    }

    private fun openNotificationAccessSettings() {
        openSettingsIntent(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
    }

    private fun openOverlaySettings() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply {
                data = Uri.parse("package:$packageName")
            }
        } else {
            Intent(Settings.ACTION_SETTINGS)
        }
        openSettingsIntent(intent)
    }

    private fun openAccessibilitySettings() {
        openSettingsIntent(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    private fun openSettingsIntent(intent: Intent) {
        runCatching {
            startActivity(intent)
        }.onFailure {
            binding.backgroundAccessMessage.text = getString(R.string.background_settings_open_failed)
        }
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
            Manifest.permission.READ_CALL_LOG,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.ANSWER_PHONE_CALLS,
            Manifest.permission.CALL_PHONE,
            Manifest.permission.RECEIVE_SMS,
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
        refreshSafetyDiagnostics()
        refreshInteractionStates()
        updateAdvancedDeviceAccessStatus()
    }

    private fun updateAdvancedDeviceAccessStatus() {
        val overlayReady = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) Settings.canDrawOverlays(this) else true
        val accessibilityReady = isDexAccessibilityEnabled() || DexAccessibilityService.isRunning()
        advancedDeviceAccessStatusView?.text = getString(
            R.string.advanced_device_access_status,
            if (overlayReady) getString(R.string.access_status_on) else getString(R.string.access_status_off),
            if (accessibilityReady) getString(R.string.access_status_on) else getString(R.string.access_status_off)
        )
    }

    private fun isDexAccessibilityEnabled(): Boolean {
        val enabledServices = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ).orEmpty()
        val expected = "$packageName/${DexAccessibilityService::class.java.name}"
        return enabledServices.split(':').any { it.equals(expected, ignoreCase = true) }
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
        binding.answerCallButton.isEnabled = lastCallState == TelephonyManager.CALL_STATE_RINGING
        binding.declineCallButton.isEnabled = lastCallState == TelephonyManager.CALL_STATE_RINGING
        refreshInteractionStates()
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
        val hasToken = !prefs.getString(KEY_TOKEN, null).isNullOrBlank()
        val notificationsEnabled = prefs.getBoolean(KEY_NOTIFICATIONS_ENABLED, false)
        val phoneBackendReady = prefs.getBoolean(KEY_PHONE_BACKEND_ENABLED, false)
        val wakeReady =
            hasToken &&
                !prefs.getString(KEY_VOSK_MODEL_ASSET, DEFAULT_VOSK_MODEL_ASSET).isNullOrBlank() &&
                !prefs.getString(KEY_VOSK_WAKE_PHRASE, DEFAULT_VOSK_WAKE_PHRASE).isNullOrBlank() &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val phoneReady =
            phoneBackendReady &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.ANSWER_PHONE_CALLS) == PackageManager.PERMISSION_GRANTED
        val smsReady =
            notificationsEnabled &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED &&
                hasNotificationPermissionForReminder()
        return hasToken && (phoneReady || smsReady || wakeReady)
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
                if (awaitingWakeCommand || conversationActive) {
                    awaitingWakeCommand = false
                    conversationActive = true
                    scheduleConversationTimeout()
                    binding.conversationStatus.text = getString(R.string.wake_mode_still_listening)
                    scheduleWakeListeningRestart(700)
                    return
                }
                binding.conversationStatus.text =
                    if (awaitingWakeCommand || conversationActive) getString(R.string.wake_mode_command_ready)
                    else getString(R.string.wake_mode_waiting)
                scheduleWakeListeningRestart(3200)
            }
            else -> binding.conversationStatus.text = getString(R.string.wake_mode_unavailable)
        }
    }

    private fun handleWakeRecognitionMatches(matches: List<String>) {
        val cleanedMatches = matches.map { it.trim() }.filter { it.isNotBlank() }
        if (cleanedMatches.isEmpty()) {
            scheduleWakeListeningRestart(3200)
            return
        }
        cleanedMatches.firstOrNull { handleWakeTranscript(it, allowFallback = false) }?.let { return }
        handleWakeTranscript(cleanedMatches.first(), allowFallback = true)
    }

    private fun handleWakeTranscript(transcript: String, allowFallback: Boolean = true): Boolean {
        if (!wakeModeEnabled) return false
        val normalized = transcript.trim().lowercase(Locale.US)
        if (normalized.isBlank()) {
            scheduleWakeListeningRestart(3200)
            return true
        }

        if (isRecentDexSpeechEcho(normalized)) {
            binding.conversationStatus.text = getString(R.string.wake_mode_still_listening)
            scheduleWakeListeningRestart(1000)
            return true
        }

        binding.lastHeardValue.text = sanitizeWakeTranscriptForDisplay(normalized)

        if (normalized.contains("stop listening") || normalized.contains("go to sleep")) {
            stopWakeMode()
            speakDex(getString(R.string.wake_mode_sleep_reply))
            return true
        }

        if (!awaitingWakeCommand && !conversationActive) {
            if (!containsWakeWord(normalized)) {
                binding.conversationStatus.text = getString(R.string.wake_mode_waiting)
                scheduleWakeListeningRestart(3200)
                return false
            }

            val spokenCommand = stripWakeWord(normalized)
            conversationActive = true
            scheduleConversationTimeout()
            if (spokenCommand.isNotBlank()) {
                return processDexCommand(spokenCommand, allowAiFallback = allowFallback)
            } else {
                awaitingWakeCommand = true
                binding.conversationStatus.text = getString(R.string.wake_mode_command_ready)
                speakDex(
                    getString(R.string.wake_mode_acknowledged),
                    R.string.voice_speaking,
                    resumeWakeModeAfterSpeech = true
                )
                return true
            }
        }

        conversationActive = true
        scheduleConversationTimeout()
        awaitingWakeCommand = false
        val cleanedTranscript = stripWakeWord(normalized)
        if (cleanedTranscript.isBlank()) {
            if (wakeWordEngineActive) {
                scheduleConversationTimeout()
                binding.conversationStatus.text = getString(R.string.wake_mode_still_listening)
                scheduleWakeListeningRestart(700)
            } else {
                binding.conversationStatus.text = getString(R.string.wake_mode_still_listening)
                scheduleWakeListeningRestart(700)
            }
            return true
        }
        return processDexCommand(cleanedTranscript, allowAiFallback = allowFallback)
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

    private fun isRecentDexSpeechEcho(transcript: String): Boolean {
        val spokenAt = lastDexSpokenAt
        if (spokenAt == 0L || SystemClock.elapsedRealtime() - spokenAt > DEX_SPEECH_ECHO_GUARD_MS) {
            return false
        }

        val transcriptNormalized = normalizeEchoGuardText(transcript)
        val spokenNormalized = normalizeEchoGuardText(lastDexSpokenText)
        if (transcriptNormalized.isBlank() || spokenNormalized.isBlank()) return false
        if (transcriptNormalized == spokenNormalized) return true

        val transcriptWords = transcriptNormalized.split(" ").filter { it.isNotBlank() }
        if (transcriptWords.size < 4) return false

        return spokenNormalized.contains(transcriptNormalized)
    }

    private fun normalizeEchoGuardText(text: String): String {
        return stripWakeWord(text.lowercase(Locale.US))
            .replace(Regex("[^a-z0-9 ]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun startCallMonitoring() {
        val manager = telephonyManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (callStateCallback != null) return
            val callback = DexCallStateCallback()
            callStateCallback = callback
            manager.registerTelephonyCallback(ContextCompat.getMainExecutor(this), callback)
        } else {
            startLegacyCallMonitoring(manager)
        }
    }

    private fun stopCallMonitoring() {
        val manager = telephonyManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            callStateCallback?.let { callback ->
                manager.unregisterTelephonyCallback(callback)
            }
            callStateCallback = null
        } else {
            stopLegacyCallMonitoring(manager)
        }
        lastCallState = TelephonyManager.CALL_STATE_IDLE
        lastCaller = "Unknown caller"
        stopListeningForCallCommand()
        updateCallActionVisibility(false)
        currentCallWasAnswered = false
        enableSpeakerAfterAnswer = false
    }

    @Suppress("DEPRECATION")
    private fun startLegacyCallMonitoring(manager: TelephonyManager) {
        if (legacyPhoneStateListener != null) return
        val listener = LegacyCallStateListener()
        legacyPhoneStateListener = listener
        manager.listen(listener, android.telephony.PhoneStateListener.LISTEN_CALL_STATE)
    }

    @Suppress("DEPRECATION")
    private fun stopLegacyCallMonitoring(manager: TelephonyManager) {
        legacyPhoneStateListener?.let { listener ->
            manager.listen(listener, android.telephony.PhoneStateListener.LISTEN_NONE)
        }
        legacyPhoneStateListener = null
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
                normalized.contains("take message") ||
                normalized.contains("let them leave a message") ||
                normalized.contains("send them to voicemail") ||
                normalized.contains("message them instead") ||
                normalized.contains("send it to voicemail") -> CallVoiceAction.TAKE_MESSAGE
            normalized.contains("answer on speaker") ||
                normalized.contains("pick up on speaker") ||
                normalized.contains("put it on speaker") ||
                normalized.contains("speaker phone") ||
                normalized.contains("take the call on speaker") -> CallVoiceAction.ANSWER_ON_SPEAKER
            normalized == "yes" ||
                normalized.startsWith("yes ") ||
            normalized == "answer" ||
                normalized.startsWith("answer ") ||
                normalized == "answer it" ||
                normalized == "answer the call" ||
                normalized == "answer phone" ||
                normalized == "answer the phone" ||
                normalized.contains("answer it for me") ||
                normalized.contains("dex answer") ||
                normalized.contains("answer as dex") ||
                normalized.contains("answer like voicemail") ||
                normalized.contains("answering machine") ||
                normalized.contains("get their name") ||
                normalized.contains("get the name") ||
                normalized.contains("get a reason") ||
                normalized.contains("get the reason") ||
                normalized.contains("ask their name") ||
                normalized.contains("ask for their name") ||
                normalized.contains("ask who is calling") ||
                normalized.contains("ask why they") ||
                normalized.contains("ask what they want") ||
                normalized.contains("find out who") ||
                normalized.contains("find out why") ||
                normalized == "pick it up" ||
                normalized == "accept" ||
                normalized.startsWith("accept ") -> CallVoiceAction.ANSWER
            normalized == "no" ||
                normalized.startsWith("no ") ||
            normalized == "decline" ||
                normalized.startsWith("decline ") ||
                normalized == "decline it" ||
                normalized == "reject" ||
                normalized.startsWith("reject ") ||
                normalized == "send it away" ||
                normalized == "ignore" ||
                normalized == "ignore it" ||
                normalized.contains("don't answer") ||
                normalized.contains("do not answer") ||
                normalized.contains("dont answer") ||
                normalized.contains("let it ring") ||
                normalized.contains("leave it") ||
                normalized.contains("dismiss it") ||
                normalized.contains("hang up") ||
                normalized.contains("ignore the call") -> CallVoiceAction.DECLINE
            else -> null
        }
    }

    private fun speakDex(
        text: String,
        activeStatusResId: Int = R.string.voice_speaking,
        resumeWakeModeAfterSpeech: Boolean = false,
        speechProfile: DexSpeechProfile = DexSpeechProfile.CONVERSATION
    ) {
        if (!ttsReady) {
            if (resumeCommandCaptureAfterWakePrompt && wakeModeEnabled) {
                resumeCommandCaptureAfterWakePrompt = false
                startWakeWordListening()
            }
            if (resumeWakeModeAfterSpeech && wakeModeEnabled) {
                scheduleWakeListeningRestart(500)
            }
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
        if (speechProfile == DexSpeechProfile.CRISIS && shouldUseSegmentedCrisisSpeech(text)) {
            speakDexSequence(
                splitCrisisSpeechSegments(text),
                activeStatusResId = activeStatusResId,
                resumeWakeModeAfterSpeech = resumeWakeModeAfterSpeech,
                speechProfile = speechProfile
            )
            return
        }
        lastDexSpokenText = text
        lastDexSpokenAt = SystemClock.elapsedRealtime()
        textToSpeech?.stop()
        applyTtsProfile(speechProfile)
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

    private fun speakDexSequence(
        segments: List<String>,
        activeStatusResId: Int = R.string.voice_speaking,
        resumeWakeModeAfterSpeech: Boolean = false,
        speechProfile: DexSpeechProfile = DexSpeechProfile.TEACHING,
        onComplete: (() -> Unit)? = null
    ) {
        val cleanedSegments = segments.map { it.trim() }.filter { it.isNotBlank() }
        if (cleanedSegments.isEmpty()) {
            onComplete?.invoke()
            return
        }
        if (!ttsReady) {
            speakDex(cleanedSegments.joinToString(" "), activeStatusResId, resumeWakeModeAfterSpeech, speechProfile)
            onComplete?.invoke()
            return
        }
        this.resumeWakeListeningAfterSpeech = resumeWakeModeAfterSpeech
        pendingSpeechCompletion = onComplete
        mainHandler.removeCallbacks(restartWakeListeningRunnable)
        lastDexSpokenText = cleanedSegments.joinToString(" ")
        lastDexSpokenAt = SystemClock.elapsedRealtime()
        textToSpeech?.stop()
        finalSpeechUtteranceId = "dex_voice_final_${System.currentTimeMillis()}"
        val chunks = cleanedSegments.flatMap { buildSpeechChunks(it, speechProfile) }
        chunks.forEachIndexed { index, chunk ->
            val queueMode = if (index == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
            val utteranceId =
                if (index == chunks.lastIndex) finalSpeechUtteranceId
                else "dex_voice_part_${System.currentTimeMillis()}_$index"
            applyTtsProfile(chunk.profile)
            textToSpeech?.speak(chunk.text, queueMode, null, utteranceId)
            if (index < chunks.lastIndex) {
                textToSpeech?.playSilentUtterance(chunk.pauseAfterMs, TextToSpeech.QUEUE_ADD, null)
            }
        }
        ttsStatusMessage = getString(activeStatusResId)
        refreshVoiceStatus()
    }

    private fun applyTtsProfile(profile: DexSpeechProfile) {
        val rate = when (profile) {
            DexSpeechProfile.CONVERSATION -> DEX_TTS_CONVERSATION_RATE
            DexSpeechProfile.SAFETY -> DEX_TTS_SAFETY_RATE
            DexSpeechProfile.CRISIS -> DEX_TTS_CRISIS_RATE
            DexSpeechProfile.TEACHING -> DEX_TTS_TEACHING_RATE
            DexSpeechProfile.PRONUNCIATION -> DEX_TTS_PRONUNCIATION_RATE
        }
        val pitch = when (profile) {
            DexSpeechProfile.CRISIS -> DEX_TTS_CRISIS_PITCH
            DexSpeechProfile.SAFETY -> DEX_TTS_SAFETY_PITCH
            else -> DEX_TTS_PITCH
        }
        textToSpeech?.setSpeechRate(rate)
        textToSpeech?.setPitch(pitch)
    }

    private fun buildSpeechChunks(segment: String, defaultProfile: DexSpeechProfile): List<SpeechChunk> {
        if (defaultProfile == DexSpeechProfile.CRISIS) {
            val crisisSegments = splitCrisisSpeechSegments(segment)
            if (crisisSegments.size > 1) {
                return crisisSegments.map { SpeechChunk(it, DexSpeechProfile.CRISIS, CRISIS_PAUSE_MS) }
            }
        }
        val matches = Regex("\\(([^()]{2,80})\\)").findAll(segment).toList()
        if (matches.isEmpty()) {
            return listOf(SpeechChunk(segment, defaultProfile, pauseForProfile(defaultProfile)))
        }

        val chunks = mutableListOf<SpeechChunk>()
        var cursor = 0
        for (match in matches) {
            val before = segment.substring(cursor, match.range.first).trim()
            if (before.isNotBlank()) {
                chunks += SpeechChunk(before, defaultProfile, pauseForProfile(defaultProfile))
            }

            val pronunciation = normalizePronunciationText(match.groupValues[1])
            if (pronunciation.isNotBlank()) {
                chunks += SpeechChunk("pronounced $pronunciation", DexSpeechProfile.PRONUNCIATION, PRONUNCIATION_PAUSE_MS)
            }
            cursor = match.range.last + 1
        }

        val after = segment.substring(cursor).trim()
        if (after.isNotBlank()) {
            chunks += SpeechChunk(after, defaultProfile, pauseForProfile(defaultProfile))
        }
        return chunks.ifEmpty { listOf(SpeechChunk(segment, defaultProfile, pauseForProfile(defaultProfile))) }
    }

    private fun shouldUseSegmentedCrisisSpeech(text: String): Boolean {
        return splitCrisisSpeechSegments(text).size > 1
    }

    private fun splitCrisisSpeechSegments(text: String): List<String> {
        val normalized = text.trim()
        if (normalized.isBlank()) return emptyList()
        val segments = normalized
            .split(Regex("(?<=[.!?])\\s+"))
            .map { it.trim() }
            .filter { it.isNotBlank() }
        val first = segments.firstOrNull().orEmpty()
        val leadAddress = extractLeadAddressSegment(first)
        if (leadAddress == null) {
            return segments
        }
        val remainder = first.removePrefix(leadAddress).trimStart().removePrefix(",").trimStart()
        return buildList {
            add(leadAddress.removeSuffix(",").trim())
            if (remainder.isNotBlank()) {
                add(remainder)
            }
            addAll(segments.drop(1))
        }
    }

    private fun extractLeadAddressSegment(text: String): String? {
        val commaIndex = text.indexOf(',')
        if (commaIndex !in 1..24) return null
        val candidate = text.substring(0, commaIndex).trim()
        if (candidate.isBlank()) return null
        val words = candidate.split(Regex("\\s+"))
        if (words.size !in 1..4) return null
        if (candidate.any { it.isDigit() }) return null
        return candidate
    }

    private fun pauseForProfile(profile: DexSpeechProfile): Long {
        return when (profile) {
            DexSpeechProfile.CRISIS -> CRISIS_PAUSE_MS
            DexSpeechProfile.SAFETY -> SAFETY_PAUSE_MS
            DexSpeechProfile.PRONUNCIATION -> PRONUNCIATION_PAUSE_MS
            else -> TEACHING_PAUSE_MS
        }
    }

    private fun normalizePronunciationText(text: String): String {
        return text
            .replace("/", " ")
            .replace("-", " ")
            .replace("·", " ")
            .replace(Regex("\\s+"), " ")
            .trim()
            .lowercase(Locale.US)
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

    private fun showWakeWordSetupDialog() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val currentModel = prefs.getString(KEY_VOSK_MODEL_ASSET, DEFAULT_VOSK_MODEL_ASSET).orEmpty()
        val currentPhrase = prefs.getString(KEY_VOSK_WAKE_PHRASE, DEFAULT_VOSK_WAKE_PHRASE).orEmpty()

        val modelInput = EditText(this).apply {
            hint = getString(R.string.wake_engine_model_hint)
            setText(currentModel)
        }
        val phraseInput = EditText(this).apply {
            hint = getString(R.string.wake_engine_phrase_hint)
            setText(currentPhrase)
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val padding = (20 * resources.displayMetrics.density).toInt()
            setPadding(padding, padding / 2, padding, 0)
            addView(modelInput)
            addView(phraseInput)
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.wake_engine_setup_title)
            .setMessage(R.string.wake_engine_setup_summary)
            .setView(container)
            .setPositiveButton(R.string.wake_engine_save) { _, _ ->
                val modelAsset = modelInput.text?.toString()?.trim().orEmpty()
                val wakePhrase = phraseInput.text?.toString()?.trim().orEmpty()
                if (modelAsset.isBlank() || wakePhrase.isBlank()) {
                    Toast.makeText(this, R.string.wake_engine_setup_needed_fields, Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                prefs.edit()
                    .putString(KEY_VOSK_MODEL_ASSET, modelAsset)
                    .putString(KEY_VOSK_WAKE_PHRASE, wakePhrase)
                    .apply()
                wakeWordEngine?.stop()
                wakeWordEngineActive = false
                refreshVoiceStatus()
                Toast.makeText(this, R.string.wake_engine_setup_saved, Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton(R.string.wake_engine_cancel, null)
            .show()
    }

    private fun buildRecognitionIntent(
        maxResults: Int,
        completeSilenceMs: Long,
        possibleSilenceMs: Long,
        minimumMs: Long = 0L,
        biasingPhrases: List<String> = emptyList()
    ): Intent {
        return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, maxResults)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, completeSilenceMs)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, possibleSilenceMs)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, minimumMs)
            val cleanedPhrases = biasingPhrases
                .map { it.trim() }
                .filter { it.isNotBlank() }
                .distinct()
            if (cleanedPhrases.isNotEmpty()) {
                putStringArrayListExtra("android.speech.extra.BIASING_STRINGS", ArrayList(cleanedPhrases))
            }
        }
    }

    private fun generalVoiceBiasPhrases(): List<String> {
        val phrases = linkedSetOf(
            "hey dex",
            "call",
            "text",
            "email",
            "reply",
            "read it",
            "ignore it",
            "set a reminder",
            "remind me",
            "remind me to call",
            "yes",
            "no",
            "approve",
            "cancel"
        )
        relationshipAliases.forEach { (alias, contact) ->
            phrases += alias
            phrases += contact
        }
        pendingContactTarget?.displayName?.let { phrases += it }
        pendingSmsRecipient?.displayName?.let { phrases += it }
        pendingIncomingSmsSender?.let { phrases += it }
        pendingNotificationTitle?.let { phrases += it }
        lastCaller.takeUnless { it.isBlank() || it == "Unknown caller" }?.let { phrases += it }
        phrases += "play a game"
        phrases += "guess my number"
        phrases += "tell me a riddle"
        phrases += "play trivia"
        phrases += "ask me trivia"
        phrases += "memory game"
        phrases += "play memory"
        phrases += "would you rather"
        phrases += "next round"
        phrases += "new round"
        phrases += "stop game"
        phrases += "today's challenge"
        phrases += "todays challenge"
        phrases += "play today's challenge"
        return phrases.toList()
    }

    private fun callCommandBiasPhrases(): List<String> = listOf(
        "answer",
        "answer it",
        "answer on speaker",
        "pick up",
        "pick up on speaker",
        "decline",
        "decline it",
        "reject",
        "take a message",
        "take message",
        "send them to voicemail",
        "yes",
        "no"
    )

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
        val intent = buildRecognitionIntent(
            maxResults = 5,
            completeSilenceMs = 2800L,
            possibleSilenceMs = 2000L,
            minimumMs = 500L,
            biasingPhrases = callCommandBiasPhrases()
        )
        isListeningForDexCommand = false
        isListeningForCallCommand = true
        setDexCompanionState(
            DEX_COMPANION_STATE_ALERT,
            bubbleOverride = getString(R.string.dex_companion_bubble_alert),
            revertAfterMs = 3200L
        )
        recognizer.cancel()
        recognizer.startListening(intent)
    }

    private fun stopListeningForCallCommand() {
        if (!isListeningForCallCommand) return
        isListeningForCallCommand = false
        shouldResumeCallListeningAfterSpeech = false
        speechRecognizer?.stopListening()
        speechRecognizer?.cancel()
        restoreDexCompanionState()
    }

    private fun startDexCommandListening() {
        if (!wakeModeEnabled || isListeningForCallCommand || listeningForQuizAnswer || isListeningForDexCommand) return
        val recognizer = speechRecognizer ?: return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            binding.conversationStatus.text = getString(R.string.wake_mode_permission_needed)
            return
        }
        val intent = buildRecognitionIntent(
            maxResults = 7,
            completeSilenceMs = 3400L,
            possibleSilenceMs = 2200L,
            minimumMs = 500L,
            biasingPhrases = generalVoiceBiasPhrases()
        )
        try {
            wakeSpeechRecognizer?.cancel()
            recognizer.cancel()
            isListeningForDexCommand = true
            lastWakeListenStartedAt = SystemClock.elapsedRealtime()
            setDexCompanionState(
                DEX_COMPANION_STATE_LISTENING,
                bubbleOverride = getString(R.string.dex_companion_bubble_listening),
                revertAfterMs = 3200L
            )
            recognizer.startListening(intent)
        } catch (_: Exception) {
            isListeningForDexCommand = false
            binding.conversationStatus.text = getString(R.string.wake_mode_unavailable)
            restoreDexCompanionState()
        }
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
        if (speechRecognizer == null || wakeSpeechRecognizer == null) {
            binding.conversationStatus.text = getString(R.string.wake_mode_unavailable)
            return
        }
        wakeModeEnabled = true
        awaitingWakeCommand = false
        conversationActive = false
        resumeCommandCaptureAfterWakePrompt = false
        binding.lastHeardValue.text = getString(R.string.voice_dash)
        binding.lastReplyValue.text = getString(R.string.voice_dash)
        wakeWordEngineActive = wakeWordEngine?.start() == true
        binding.conversationStatus.text = when {
            wakeWordEngineActive -> getString(R.string.wake_mode_hotword_ready)
            wakeWordEngine?.isConfigured() == true -> getString(R.string.wake_engine_start_failed)
            automatic -> getString(R.string.wake_mode_auto_started)
            else -> getString(R.string.wake_mode_waiting)
        }
        restoreDexCompanionState()
        updateWakeUi()
        maintainBackgroundService()
        if (!wakeWordEngineActive) {
            scheduleWakeListeningRestart(1200)
        }
    }

    private fun stopWakeMode() {
        wakeModeEnabled = false
        awaitingWakeCommand = false
        conversationActive = false
        autoWakeStarted = false
        resumeWakeListeningAfterSpeech = false
        resumeCommandCaptureAfterWakePrompt = false
        mainHandler.removeCallbacks(resetWakeWindowRunnable)
        mainHandler.removeCallbacks(restartWakeListeningRunnable)
        wakeWordEngine?.stop()
        wakeWordEngineActive = false
        isListeningForDexCommand = false
        wakeSpeechRecognizer?.cancel()
        if (!isListeningForCallCommand) {
            speechRecognizer?.cancel()
        }
        restoreDexCompanionState()
        updateWakeUi()
        maintainBackgroundService()
    }

    private fun startWakeWordListening() {
        if (!wakeModeEnabled || isListeningForCallCommand) return
        if (awaitingWakeCommand || conversationActive) {
            startDexCommandListening()
            return
        }
        val recognizer = wakeSpeechRecognizer ?: return
        val intent = buildRecognitionIntent(
            maxResults = 5,
            completeSilenceMs = 5500L,
            possibleSilenceMs = 3500L,
            minimumMs = 15000L,
            biasingPhrases = listOf("hey dex", "dex")
        )
        try {
            recognizer.cancel()
            lastWakeListenStartedAt = SystemClock.elapsedRealtime()
            restoreDexCompanionState()
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

    private fun handleWakeWordEngineDetection() {
        if (!wakeModeEnabled || isListeningForCallCommand || lastCallState == TelephonyManager.CALL_STATE_RINGING) return
        if (awaitingWakeCommand || conversationActive) return
        wakeSpeechRecognizer?.cancel()
        binding.lastHeardValue.text = getString(R.string.wake_mode_detected)
        awaitingWakeCommand = true
        conversationActive = true
        scheduleConversationTimeout()
        binding.conversationStatus.text = getString(R.string.wake_mode_command_ready)
        resumeCommandCaptureAfterWakePrompt = true
        setDexCompanionState(
            DEX_COMPANION_STATE_EXCITED,
            bubbleOverride = getString(R.string.dex_companion_bubble_excited),
            revertAfterMs = 2400L
        )
        speakDex(
            getString(R.string.wake_mode_acknowledged),
            R.string.voice_speaking,
            resumeWakeModeAfterSpeech = false
        )
    }

    private fun handleWakeWordEngineFailure(message: String?) {
        wakeWordEngineActive = false
        if (wakeModeEnabled) {
            binding.conversationStatus.text = message?.takeIf { it.isNotBlank() }
                ?: getString(R.string.wake_engine_start_failed)
            scheduleWakeListeningRestart(1200)
        } else {
            refreshVoiceStatus()
        }
    }

    private fun handleAssistantEntryIntent(intent: Intent?) {
        val surface = intent?.getStringExtra(EXTRA_ASSISTANT_SURFACE).orEmpty()
        if (surface.isBlank()) return

        enableAssistantLockscreenMode()

        when (surface) {
            ASSISTANT_SURFACE_WAKE -> {
                if (!wakeModeEnabled) {
                    startWakeMode(automatic = true)
                }
                handleWakeWordEngineDetection()
            }
            ASSISTANT_SURFACE_CALL -> {
                val caller = intent?.getStringExtra(EXTRA_ASSISTANT_CALLER).orEmpty().ifBlank {
                    getString(R.string.unknown_number_label)
                }
                lastCaller = caller
                lastCallState = TelephonyManager.CALL_STATE_RINGING
                updateCallActionVisibility(true)
                val prompt = getString(R.string.call_background_known_contact_prompt, caller)
                binding.callMonitorStatus.text = prompt
                binding.conversationStatus.text = prompt
                binding.lastReplyValue.text = prompt
                speakIncomingCallPrompt(caller)
            }
        }

        intent?.removeExtra(EXTRA_ASSISTANT_SURFACE)
        intent?.removeExtra(EXTRA_ASSISTANT_CALLER)
    }

    private fun enableAssistantLockscreenMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }
    }

    private fun processDexCommand(message: String, allowAiFallback: Boolean = true): Boolean {
        if (shouldResetPromptStateForFreshCommand(message)) {
            clearStalePromptState()
        }
        if (handleImmediateEmergencyCommand(message)) return true
        if (handleTaskIntent(message)) return true
        detectContactOnlyIntent(message)?.let { contact ->
            pendingDetectedContactPhrase = message.trim()
            handleDetectedContactTarget(contact)
            return true
        }
        if (allowAiFallback) {
            sendDexChat(message)
            return true
        }
        return false
    }

    private fun handleDexMiniGameIntent(message: String): Boolean {
        val trimmed = message.trim()
        val normalized = trimmed.lowercase(Locale.US)
        if (normalized.isBlank()) return false

        if (
            normalized.contains("guess my number") ||
            normalized.contains("number game") ||
            normalized == "play guess my number"
        ) {
            startGuessNumberGame(announce = true)
            return true
        }

        if (
            normalized.contains("tell me a riddle") ||
            normalized.contains("start a riddle") ||
            normalized == "play riddle" ||
            normalized == "riddle me"
        ) {
            startRiddleGame(announce = true)
            return true
        }

        if (
            normalized.contains("play trivia") ||
            normalized.contains("start trivia") ||
            normalized.contains("ask me trivia") ||
            normalized.contains("give me trivia")
        ) {
            startTriviaGame(announce = true)
            return true
        }

        if (
            normalized.contains("memory game") ||
            normalized.contains("play memory") ||
            normalized.contains("start memory")
        ) {
            startMemoryGame(announce = true)
            return true
        }

        if (
            normalized.contains("would you rather") ||
            normalized.contains("play would you rather")
        ) {
            startWouldYouRatherGame(announce = true)
            return true
        }

        if (
            normalized == "play a game" ||
            normalized == "play with dex" ||
            normalized == "lets play a game" ||
            normalized == "let's play a game"
        ) {
            startFavoriteDexMiniGame(announce = true)
            return true
        }

        if (
            normalized == "today's challenge" ||
            normalized == "todays challenge" ||
            normalized == "what is today's challenge" ||
            normalized == "what's today's challenge" ||
            normalized == "play today's challenge" ||
            normalized == "play todays challenge"
        ) {
            if (normalized.startsWith("play ")) {
                startTodaysDexChallenge(announce = true)
            } else {
                val reply = dexGamesChallengeLine()
                binding.dexGameStatus.text = dexGamesStatusSummary(reply)
                announceDexMiniGameReply(reply)
            }
            return true
        }

        if (activeDexMiniGame == DexMiniGameType.NONE) return false

        if (
            normalized == "next round" ||
            normalized == "new round" ||
            normalized == "next game" ||
            normalized == "another one"
        ) {
            playNextDexMiniGameRound(announce = true)
            return true
        }

        if (
            normalized == "stop game" ||
            normalized == "end game" ||
            normalized == "cancel game" ||
            normalized == "quit game"
        ) {
            activeDexMiniGame = DexMiniGameType.NONE
            currentMemoryRound = 0
            currentMemorySequence = emptyList()
            val reply = getString(R.string.dex_game_stopped)
            binding.dexGameStatus.text = reply
            announceDexMiniGameReply(reply)
            restoreDexCompanionState()
            return true
        }

        if (shouldTreatAsDexMiniGameAnswer(trimmed, normalized)) {
            submitDexGameAnswer(answerOverride = trimmed, announce = true)
            return true
        }

        return false
    }

    private fun shouldTreatAsDexMiniGameAnswer(raw: String, normalized: String): Boolean {
        if (activeDexMiniGame == DexMiniGameType.NONE) return false
        if (activeDexMiniGame == DexMiniGameType.GUESS_NUMBER) {
            val digitsOnly = raw.filter { it.isDigit() }
            return digitsOnly.isNotBlank() || normalized.startsWith("my guess is ")
        }
        val commandPrefixes = listOf(
            "open ",
            "call ",
            "text ",
            "email ",
            "remind ",
            "set ",
            "create ",
            "make ",
            "what ",
            "what's ",
            "whats ",
            "who ",
            "where ",
            "when ",
            "read ",
            "answer ",
            "decline ",
            "approve ",
            "cancel ",
            "play ",
            "start "
        )
        if (commandPrefixes.any { normalized.startsWith(it) }) return false
        if (normalized.length <= 2) return false
        return true
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

    private fun handleImmediateEmergencyCommand(message: String): Boolean {
        if (!isHighRiskEmergencyMessage(message)) return false

        pendingContactTarget = null
        pendingContactAction = null
        pendingSmsRecipient = null
        pendingSmsBodyDraft = null
        pendingReminderSmsTriggerAt = null
        pendingReminderSmsTarget = null
        pendingReminderSmsBody = null
        awaitingReminderSmsContact = false
        pendingReminderCallTriggerAt = null
        awaitingReminderCallContact = false
        pendingReminderCallTargetName = null
        pendingReminderContactChoices = emptyList()
        pendingReminderContactDisambiguationMode = null
        pendingIncomingSmsSender = null
        pendingIncomingSmsValue = null
        pendingIncomingSmsBody = null
        pendingIncomingSmsReplyChoice = false
        pendingNotificationApp = null
        pendingNotificationTitle = null
        pendingNotificationText = null
        pendingNotificationReplyChoice = false
        if (pendingAction != null) {
            pendingAction = null
            updatePendingActionUi()
        }

        val reply = listOfNotNull(
            buildEmergencySpokenReply(),
            sendLocalEmergencySmsIfNeeded(null, message, forceEmergency = true)
        ).joinToString(" ")

        maybeScheduleSafetyCheckIn(null, message, forceEmergency = true)
        binding.lastHeardValue.text = message
        binding.conversationStatus.text = reply
        binding.lastReplyValue.text = reply
        conversationActive = true
        awaitingWakeCommand = false
        scheduleConversationTimeout()
        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
        return true
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

    private data class AppLaunchTarget(
        val label: String,
        val packages: List<String> = emptyList(),
        val actionIntent: Intent? = null,
        val webUri: Uri? = null
    )

    private fun openKnownApp(target: AppLaunchTarget): Boolean {
        val packageManager = packageManager
        val launchIntent =
            target.packages
                .asSequence()
                .mapNotNull { packageManager.getLaunchIntentForPackage(it) }
                .firstOrNull()
                ?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                ?: target.actionIntent?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
                ?: target.webUri?.let { Intent(Intent.ACTION_VIEW, it).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }

        return if (launchIntent != null) {
            try {
                startActivity(launchIntent)
                val reply = getString(R.string.app_opened, target.label)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            } catch (_: Exception) {
                val reply = getString(R.string.action_open_failed)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
        } else {
            val reply = getString(R.string.app_not_available, target.label)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            true
        }
    }

    private fun handleAppLaunchIntent(message: String): Boolean {
        val trimmed = message.trim()
        val normalized = trimmed.lowercase(Locale.US)
        val launchPattern =
            Regex(
                "^(?:open|launch|start|pull up|take me to|show me|bring up)\\s+(?:my\\s+)?(.+?)$",
                RegexOption.IGNORE_CASE
            )
        val rawTarget =
            launchPattern.find(trimmed)?.groupValues?.getOrNull(1)?.trim()
                ?: return false
        val target = rawTarget
            .replace(Regex("^the\\s+", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s+app$", RegexOption.IGNORE_CASE), "")
            .trim()
            .lowercase(Locale.US)
        if (target.isBlank()) return false

        fun app(label: String, vararg packages: String) =
            AppLaunchTarget(label = label, packages = packages.toList())

        val knownTarget = when {
            target.contains("gmail") || target == "email" || target == "mail" ->
                AppLaunchTarget(
                    label = "Gmail",
                    packages = listOf("com.google.android.gm"),
                    webUri = Uri.parse("https://mail.google.com")
                )
            target.contains("facebook messenger") || target == "messenger" ->
                AppLaunchTarget(
                    label = "Messenger",
                    packages = listOf("com.facebook.orca"),
                    webUri = Uri.parse("https://www.messenger.com")
                )
            target.contains("facebook") ->
                AppLaunchTarget(
                    label = "Facebook",
                    packages = listOf("com.facebook.katana", "com.facebook.lite"),
                    webUri = Uri.parse("https://www.facebook.com")
                )
            target.contains("instagram") ->
                app("Instagram", "com.instagram.android")
            target.contains("tiktok") ->
                app("TikTok", "com.zhiliaoapp.musically")
            target.contains("spotify") ->
                app("Spotify", "com.spotify.music")
            target.contains("youtube music") ->
                app("YouTube Music", "com.google.android.apps.youtube.music")
            target == "youtube" ->
                app("YouTube", "com.google.android.youtube")
            target.contains("maps") || target == "map" || target.contains("google maps") ->
                app("Google Maps", "com.google.android.apps.maps")
            target.contains("calendar") ->
                app("Calendar", "com.google.android.calendar", "com.samsung.android.calendar")
            target.contains("camera") ->
                AppLaunchTarget(label = "Camera", actionIntent = Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA))
            target.contains("calculator") || target == "calc" ->
                app("Calculator", "com.google.android.calculator", "com.sec.android.app.popupcalculator")
            target.contains("settings") ->
                AppLaunchTarget(label = "Settings", actionIntent = Intent(Settings.ACTION_SETTINGS))
            target.contains("chrome") ->
                app("Chrome", "com.android.chrome")
            target.contains("browser") ->
                AppLaunchTarget(label = "Browser", actionIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com")))
            target.contains("photos") || target.contains("google photos") ->
                app("Google Photos", "com.google.android.apps.photos")
            target.contains("gallery") ->
                app("Gallery", "com.sec.android.gallery3d")
            target.contains("messages") || target == "message" || target == "texts" ->
                app("Messages", "com.google.android.apps.messaging", "com.samsung.android.messaging")
            target.contains("phone") || target.contains("dialer") ->
                AppLaunchTarget(label = "Phone", actionIntent = Intent(Intent.ACTION_DIAL))
            target.contains("contacts") ->
                AppLaunchTarget(
                    label = "Contacts",
                    actionIntent = Intent(Intent.ACTION_VIEW).apply {
                        type = ContactsContract.Contacts.CONTENT_TYPE
                    }
                )
            target.contains("clock") || target.contains("alarm") ->
                app("Clock", "com.google.android.deskclock", "com.sec.android.app.clockpackage")
            target.contains("notes") || target.contains("samsung notes") ->
                app("Notes", "com.samsung.android.app.notes")
            else -> null
        }

        if (knownTarget != null) return openKnownApp(knownTarget)

        if (
            normalized.startsWith("open ") ||
                normalized.startsWith("launch ") ||
                normalized.startsWith("pull up ") ||
                normalized.startsWith("take me to ")
        ) {
            val reply = getString(R.string.app_not_available, rawTarget.replaceFirstChar {
                if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString()
            })
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
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

        stopListeningForCallCommand()
        val reply = getString(R.string.call_message_taking)
        binding.callMonitorStatus.text = reply
        binding.conversationStatus.text = reply
        binding.lastReplyValue.text = reply
        val intent = Intent(this, DexForegroundService::class.java).apply {
            action = DexForegroundService.ACTION_CALL_TAKE_MESSAGE
            putExtra(DexForegroundService.EXTRA_CALLER_NAME, lastCaller)
            putExtra(DexForegroundService.EXTRA_CALLER_NUMBER, lastIncomingNumber)
            putExtra(DexForegroundService.EXTRA_CALL_IS_RINGING, true)
        }
        ContextCompat.startForegroundService(this, intent)
    }

    private fun handleTaskIntent(message: String): Boolean {
        val normalized = message.trim().lowercase(Locale.US)
        if (normalized.isBlank()) return false

        consumePendingNotification(normalized)?.let { actionTaken ->
            if (actionTaken) return true
        }

        consumePendingIncomingSms(normalized)?.let { actionTaken ->
            if (actionTaken) return true
        }

        handlePendingActionVoiceCommand(normalized)?.let { actionTaken ->
            if (actionTaken) return true
        }

        consumePendingReminderContactChoice(message)?.let { actionTaken ->
            if (actionTaken) return true
        }

        consumePendingReminderCallContact(message)?.let { actionTaken ->
            if (actionTaken) return true
        }

        consumePendingReminderCallTime(message)?.let { actionTaken ->
            if (actionTaken) return true
        }

        consumePendingReminderSmsContact(message)?.let { actionTaken ->
            if (actionTaken) return true
        }

        consumePendingReminderSmsTime(message)?.let { actionTaken ->
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

        if (handleDexMiniGameIntent(message)) return true

        if (
            normalized.contains("read my notifications") ||
                normalized.contains("read my notification") ||
                normalized.contains("what notifications do i have") ||
                normalized.contains("what notification do i have") ||
                normalized.contains("read my alerts")
        ) {
            val app = pendingNotificationApp
                ?: getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_PENDING_NOTIFICATION_APP, null)
            val text = pendingNotificationText
                ?: getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_PENDING_NOTIFICATION_TEXT, null)
            val reply = if (!app.isNullOrBlank() && !text.isNullOrBlank()) {
                getString(R.string.notification_readback, app, text)
            } else {
                getString(R.string.notification_none)
            }
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return true
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

        handleSafetyProfileLookupIntent(message)?.let { reply ->
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return true
        }

        if (handleMediaIntent(message)) return true

        if (handleAppLaunchIntent(message)) return true

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

        handleTextReminderIntent(message)?.let { reply ->
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return true
        }

        handleCallReminderIntent(message)?.let { reply ->
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
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

    private fun handleSafetyProfileLookupIntent(message: String): String? {
        val normalized = message.trim().lowercase(Locale.US)
        if (normalized.isBlank()) return null

        val assistedPersonName = resolveEmergencyPersonName()
        val birthday = resolveEmergencyBirthday()
        val assistedNameLower = assistedPersonName.lowercase(Locale.US)
        val trustedContact = resolveEmergencyTrustedContact().ifBlank { getString(R.string.safety_contact_none) }

        val asksWho =
            normalized.contains("who are you assisting") ||
                normalized.contains("who are you helping") ||
                normalized.contains("who is dex assisting") ||
                normalized.contains("who is dex helping") ||
                normalized.contains("who do you assist") ||
                normalized.contains("who do you help")
        if (asksWho) {
            return getString(R.string.safety_lookup_assisted_person, assistedPersonName, birthday)
        }

        val asksTrustedContact =
            normalized.contains("who is the trusted contact") ||
                normalized.contains("what trusted contact do you have saved") ||
                normalized.contains("what is the trusted contact") ||
                normalized.contains("what's the trusted contact") ||
                normalized.contains("who do you have as the trusted contact")
        if (asksTrustedContact) {
            return getString(R.string.safety_lookup_trusted_contact, assistedPersonName, trustedContact)
        }

        val asksFullProfile =
            normalized.contains("read the safety profile") ||
                normalized.contains("read the assisted person profile") ||
                normalized.contains("tell me the safety profile") ||
                normalized.contains("tell me the assisted person profile")
        if (asksFullProfile) {
            return getString(R.string.safety_lookup_profile, assistedPersonName, birthday, trustedContact)
        }

        val asksBirthday =
            normalized.contains("what birthday do you have saved") ||
                normalized.contains("what birthday is saved") ||
                normalized.contains("what is the saved birthday") ||
                normalized.contains("what's the saved birthday") ||
                normalized.contains("when is the birthday") ||
                normalized.contains("what is the birthday") ||
                normalized.contains("what's the birthday") ||
                normalized.contains("birthday do you have saved")
        if (!asksBirthday) return null

        return if (normalized.contains(assistedNameLower)) {
            getString(R.string.safety_lookup_birthday, assistedPersonName, birthday)
        } else if (normalized.contains("for ") || normalized.contains("'s birthday")) {
            getString(R.string.safety_lookup_birthday_mismatch, assistedPersonName, birthday)
        } else {
            getString(R.string.safety_lookup_birthday, assistedPersonName, birthday)
        }
    }

    private fun consumePendingIncomingSms(normalized: String): Boolean? {
        val sender = pendingIncomingSmsSender
            ?: getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_PENDING_INCOMING_SMS_SENDER, null)
        val senderValue = pendingIncomingSmsValue
            ?: getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_PENDING_INCOMING_SMS_VALUE, null)
        val body = pendingIncomingSmsBody
            ?: getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_PENDING_INCOMING_SMS_BODY, null)
        if (sender.isNullOrBlank() || body.isNullOrBlank()) return null
        if (!isLikelySmsPromptReply(normalized)) return null

        return when {
            normalized == "read it" ||
                normalized == "read the text" ||
                normalized == "read the message" ||
                normalized == "yes read it" ||
                normalized == "yes read the text" -> {
                pendingIncomingSmsReplyChoice = true
                val reply = getString(R.string.incoming_sms_readback_with_reply_offer, sender, body)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            normalized == "read it again" ||
                normalized == "read that again" ||
                normalized == "say it again" -> {
                val reply = getString(R.string.incoming_sms_readback_again, sender, body)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            normalized == "reply to it" ||
                normalized == "reply to that" ||
                normalized == "text them back" ||
                normalized == "reply back" ||
                normalized == "answer it" ||
                (pendingIncomingSmsReplyChoice && isPromptAffirmativeVoiceReply(normalized)) -> {
                val number = senderValue?.trim().orEmpty()
                if (number.isBlank()) {
                    val reply = getString(R.string.contact_not_found_phone, sender)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    false
                } else {
                    pendingIncomingSmsReplyChoice = false
                    pendingSmsRecipient = ContactMatch(sender, number)
                    pendingSmsBodyDraft = null
                    val reply = getString(R.string.incoming_sms_reply_prompt, sender)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    true
                }
            }
            normalized == "ignore it" ||
                normalized == "ignore the text" ||
                normalized == "ignore the message" ||
                isPromptNegativeVoiceReply(normalized) ||
                normalized == "cancel" -> {
                val reply = getString(R.string.incoming_sms_ignored, sender)
                pendingIncomingSmsReplyChoice = false
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                clearPendingIncomingSms()
                true
            }
            else -> null
        }
    }

    private fun consumePendingReminderCallTime(message: String): Boolean? {
        val targetName = pendingReminderCallTargetName ?: return null
        val trimmed = message.trim()
        if (trimmed.isBlank()) return false
        val normalized = trimmed.lowercase(Locale.US)
        return when (normalized) {
            "cancel", "cancel it", "never mind", "stop" -> {
                pendingReminderCallTargetName = null
                val reply = getString(R.string.pending_action_canceled)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            else -> {
                if (!hasExplicitReminderTime(trimmed)) {
                    val reply = getString(R.string.call_reminder_time_prompt, targetName)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    true
                } else {
                    pendingReminderCallTargetName = null
                    val reply = scheduleCallReminder(targetName, inferDateTimeFromCommand(trimmed))
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    true
                }
            }
        }
    }

    private fun consumePendingReminderCallContact(message: String): Boolean? {
        if (!awaitingReminderCallContact) return null
        val trimmed = message.trim()
        if (trimmed.isBlank()) return false
        val normalized = trimmed.lowercase(Locale.US)
        return when (normalized) {
            "cancel", "cancel it", "never mind", "stop" -> {
                awaitingReminderCallContact = false
                pendingReminderCallTriggerAt = null
                val reply = getString(R.string.pending_action_canceled)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            else -> {
                val contact = findExactPhoneContactByName(resolveContactAlias(trimmed))
                    ?: findPhoneContactByName(resolveContactAlias(trimmed))
                if (contact == null) {
                    val reply = getString(R.string.call_reminder_contact_prompt)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    true
                } else {
                    awaitingReminderCallContact = false
                    tryAutoLearnRelationshipAlias(trimmed, contact.displayName)
                    val pendingTime = pendingReminderCallTriggerAt
                    pendingReminderCallTriggerAt = null
                    if (pendingTime != null) {
                        val reply = scheduleCallReminder(contact.displayName, pendingTime)
                        binding.conversationStatus.text = reply
                        binding.lastReplyValue.text = reply
                        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    } else {
                        pendingReminderCallTargetName = contact.displayName
                        val reply = getString(R.string.call_reminder_time_prompt, contact.displayName)
                        binding.conversationStatus.text = reply
                        binding.lastReplyValue.text = reply
                        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    }
                    true
                }
            }
        }
    }

    private fun consumePendingReminderContactChoice(message: String): Boolean? {
        val choices = pendingReminderContactChoices
        val mode = pendingReminderContactDisambiguationMode ?: return null
        if (choices.isEmpty()) return null
        val trimmed = message.trim()
        if (trimmed.isBlank()) return false
        val normalized = trimmed.lowercase(Locale.US)
        if (normalized == "cancel" || normalized == "cancel it" || normalized == "never mind" || normalized == "stop") {
            clearPendingReminderContactDisambiguation()
            val reply = getString(R.string.pending_action_canceled)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return true
        }

        val chosen = when {
            normalized == "first" || normalized == "the first one" || normalized == "number one" -> choices.getOrNull(0)
            normalized == "second" || normalized == "the second one" || normalized == "number two" -> choices.getOrNull(1)
            normalized == "third" || normalized == "the third one" || normalized == "number three" -> choices.getOrNull(2)
            else -> choices.firstOrNull { candidate ->
                val display = normalizeContactLookupText(candidate.displayName)
                val spoken = normalizeContactLookupText(trimmed)
                spoken == display || normalizeCompactContactText(spoken) == normalizeCompactContactText(display)
            }
        }

        if (chosen == null) {
            val reply = getString(R.string.reminder_contact_choice_retry)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return true
        }

        clearPendingReminderContactDisambiguation()
        when (mode) {
            ReminderContactDisambiguationMode.CALL -> {
                awaitingReminderCallContact = false
                val pendingTime = pendingReminderCallTriggerAt
                pendingReminderCallTriggerAt = null
                if (pendingTime != null) {
                    val reply = scheduleCallReminder(chosen.displayName, pendingTime)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                } else {
                    pendingReminderCallTargetName = chosen.displayName
                    val reply = getString(R.string.call_reminder_time_prompt, chosen.displayName)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                }
            }
            ReminderContactDisambiguationMode.TEXT -> {
                awaitingReminderSmsContact = false
                val pendingBody = pendingReminderSmsBody
                val pendingTime = pendingReminderSmsTriggerAt
                pendingReminderSmsBody = null
                pendingReminderSmsTriggerAt = null
                when {
                    pendingTime != null && !pendingBody.isNullOrBlank() -> {
                        val reply = scheduleTextReminder(chosen, pendingBody, pendingTime)
                        binding.conversationStatus.text = reply
                        binding.lastReplyValue.text = reply
                        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    }
                    pendingTime != null -> {
                        pendingSmsRecipient = chosen
                        pendingSmsBodyDraft = null
                        pendingReminderSmsTriggerAt = pendingTime
                        val reply = getString(R.string.text_reminder_body_prompt, chosen.displayName, formatReminderDateTime(pendingTime))
                        binding.conversationStatus.text = reply
                        binding.lastReplyValue.text = reply
                        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    }
                    !pendingBody.isNullOrBlank() -> {
                        pendingReminderSmsTarget = chosen
                        pendingReminderSmsBody = pendingBody
                        val reply = getString(R.string.text_reminder_time_prompt, chosen.displayName)
                        binding.conversationStatus.text = reply
                        binding.lastReplyValue.text = reply
                        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    }
                    else -> {
                        pendingReminderSmsTarget = chosen
                        val reply = getString(R.string.text_reminder_time_prompt, chosen.displayName)
                        binding.conversationStatus.text = reply
                        binding.lastReplyValue.text = reply
                        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    }
                }
            }
        }
        return true
    }

    private fun clearPendingReminderContactDisambiguation() {
        pendingReminderContactChoices = emptyList()
        pendingReminderContactDisambiguationMode = null
    }

    private fun consumePendingReminderSmsTime(message: String): Boolean? {
        val target = pendingReminderSmsTarget ?: return null
        val trimmed = message.trim()
        if (trimmed.isBlank()) return false
        val normalized = trimmed.lowercase(Locale.US)
        return when (normalized) {
            "cancel", "cancel it", "never mind", "stop" -> {
                pendingReminderSmsTarget = null
                pendingReminderSmsBody = null
                pendingReminderSmsTriggerAt = null
                val reply = getString(R.string.pending_action_canceled)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            else -> {
                if (!hasExplicitReminderTime(trimmed)) {
                    val reply = getString(R.string.text_reminder_time_prompt, target.displayName)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    true
                } else {
                    val reminderAt = inferDateTimeFromCommand(trimmed)
                    val pendingBody = pendingReminderSmsBody
                    pendingReminderSmsTarget = null
                    pendingReminderSmsBody = null
                    if (!pendingBody.isNullOrBlank()) {
                        val reply = scheduleTextReminder(target, pendingBody, reminderAt)
                        binding.conversationStatus.text = reply
                        binding.lastReplyValue.text = reply
                        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    } else {
                        pendingSmsRecipient = target
                        pendingSmsBodyDraft = null
                        pendingReminderSmsTriggerAt = reminderAt
                        val reply = getString(R.string.text_reminder_body_prompt, target.displayName, formatReminderDateTime(reminderAt))
                        binding.conversationStatus.text = reply
                        binding.lastReplyValue.text = reply
                        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    }
                    true
                }
            }
        }
    }

    private fun consumePendingReminderSmsContact(message: String): Boolean? {
        if (!awaitingReminderSmsContact) return null
        val trimmed = message.trim()
        if (trimmed.isBlank()) return false
        val normalized = trimmed.lowercase(Locale.US)
        return when (normalized) {
            "cancel", "cancel it", "never mind", "stop" -> {
                awaitingReminderSmsContact = false
                pendingReminderSmsBody = null
                pendingReminderSmsTriggerAt = null
                val reply = getString(R.string.pending_action_canceled)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            else -> {
                val contact = findExactPhoneContactByName(resolveContactAlias(trimmed))
                    ?: findPhoneContactByName(resolveContactAlias(trimmed))
                if (contact == null) {
                    val reply = getString(R.string.text_reminder_contact_prompt)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    true
                } else {
                    awaitingReminderSmsContact = false
                    tryAutoLearnRelationshipAlias(trimmed, contact.displayName)
                    val pendingBody = pendingReminderSmsBody
                    val pendingTime = pendingReminderSmsTriggerAt
                    pendingReminderSmsBody = null
                    pendingReminderSmsTriggerAt = null
                    when {
                        pendingTime != null && !pendingBody.isNullOrBlank() -> {
                            val reply = scheduleTextReminder(contact, pendingBody, pendingTime)
                            binding.conversationStatus.text = reply
                            binding.lastReplyValue.text = reply
                            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                        }
                        pendingTime != null -> {
                            pendingSmsRecipient = contact
                            pendingSmsBodyDraft = null
                            pendingReminderSmsTriggerAt = pendingTime
                            val reply = getString(R.string.text_reminder_body_prompt, contact.displayName, formatReminderDateTime(pendingTime))
                            binding.conversationStatus.text = reply
                            binding.lastReplyValue.text = reply
                            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                        }
                        !pendingBody.isNullOrBlank() -> {
                            pendingReminderSmsTarget = contact
                            pendingReminderSmsBody = pendingBody
                            val reply = getString(R.string.text_reminder_time_prompt, contact.displayName)
                            binding.conversationStatus.text = reply
                            binding.lastReplyValue.text = reply
                            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                        }
                        else -> {
                            pendingReminderSmsTarget = contact
                            val reply = getString(R.string.text_reminder_time_prompt, contact.displayName)
                            binding.conversationStatus.text = reply
                            binding.lastReplyValue.text = reply
                            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                        }
                    }
                    true
                }
            }
        }
    }

    private fun handleCallReminderIntent(message: String): String? {
        val resolvedMessage = resolveAliasesInSentence(message.trim())
        val normalized = resolvedMessage.lowercase(Locale.US)
        val reminderIntent =
            normalized.contains("remind me") ||
                normalized.contains("set a reminder") ||
                normalized.contains("create a reminder") ||
                normalized.contains("make a reminder")
        if (!reminderIntent || !normalized.contains("call ")) return null

        val rawTarget = extractReminderCallTarget(resolvedMessage)
        if (rawTarget.isBlank()) {
            awaitingReminderCallContact = true
            pendingReminderCallTriggerAt = if (hasExplicitReminderTime(resolvedMessage)) inferDateTimeFromCommand(resolvedMessage) else null
            return getString(R.string.call_reminder_contact_prompt)
        }
        findAmbiguousPhoneContactMatches(rawTarget).takeIf { it.size > 1 }?.let { candidates ->
            pendingReminderContactChoices = candidates
            pendingReminderContactDisambiguationMode = ReminderContactDisambiguationMode.CALL
            pendingReminderCallTriggerAt = if (hasExplicitReminderTime(resolvedMessage)) inferDateTimeFromCommand(resolvedMessage) else null
            awaitingReminderCallContact = true
            return buildReminderContactChoicePrompt(rawTarget, candidates)
        }

        val reminderTarget =
            findExactPhoneContactByName(resolveContactAlias(rawTarget))?.displayName
                ?: findPhoneContactByName(resolveContactAlias(rawTarget))?.displayName
        if (reminderTarget == null) {
            awaitingReminderCallContact = true
            pendingReminderCallTriggerAt = if (hasExplicitReminderTime(resolvedMessage)) inferDateTimeFromCommand(resolvedMessage) else null
            return getString(R.string.call_reminder_contact_prompt)
        }
        tryAutoLearnRelationshipAlias(rawTarget, reminderTarget)
        if (!hasExplicitReminderTime(resolvedMessage)) {
            pendingReminderCallTargetName = reminderTarget
            return getString(R.string.call_reminder_time_prompt, reminderTarget)
        }

        val reminderAt = inferDateTimeFromCommand(resolvedMessage)
        return scheduleCallReminder(reminderTarget, reminderAt)
    }

    private fun scheduleCallReminder(reminderTarget: String, reminderAt: LocalDateTime): String {
        val title = getString(R.string.call_reminder_title, reminderTarget)
        val text = getString(R.string.call_reminder_text, reminderTarget)
        val triggerAtMillis = reminderAt.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        rememberRecentCallReminder(reminderTarget)
        DexSafetyCheckInScheduler.scheduleOneTimeCheckInAt(
            context = this,
            triggerAtMillis = triggerAtMillis,
            title = title,
            text = text,
            voiceCheckIn = true
        )

        val spokenDateTime = formatReminderDateTime(reminderAt)
        return getString(R.string.call_reminder_set, reminderTarget, spokenDateTime)
    }

    private fun rememberRecentCallReminder(reminderTarget: String) {
        recentCallReminderTargetName = normalizeCompactContactText(reminderTarget)
        recentCallReminderScheduledAt = SystemClock.elapsedRealtime()
    }

    private fun shouldSuppressImmediateCallAfterReminder(request: DirectCallRequest): Boolean {
        val scheduledAt = recentCallReminderScheduledAt
        val reminderTarget = recentCallReminderTargetName ?: return false
        if (scheduledAt == 0L || SystemClock.elapsedRealtime() - scheduledAt > RECENT_CALL_REMINDER_GUARD_MS) {
            return false
        }
        return normalizeCompactContactText(request.displayName) == reminderTarget
    }

    private fun handleTextReminderIntent(message: String): String? {
        val resolvedMessage = resolveAliasesInSentence(message.trim())
        val normalized = resolvedMessage.lowercase(Locale.US)
        val reminderIntent =
            normalized.contains("remind me") ||
                normalized.contains("set a reminder") ||
                normalized.contains("create a reminder") ||
                normalized.contains("make a reminder")
        if (!reminderIntent || !(normalized.contains("text ") || normalized.contains("message "))) return null

        val detailedMatch = listOf(
            Regex(".*(?:text|message)\\s+(.+?)\\s+(?:saying|that|message|tell)\\s+(.+)$", RegexOption.IGNORE_CASE),
            Regex(".*(?:text|message)\\s+(.+?)\\s+(.+)$", RegexOption.IGNORE_CASE)
        ).firstNotNullOfOrNull { it.find(resolvedMessage) }
        detailedMatch?.let { match ->
            val rawTarget = match.groupValues[1].trim()
            val reminderBody = match.groupValues[2].trim().trimEnd('.', '!', '?')
            if (rawTarget.isBlank() || reminderBody.isBlank()) return null
            findAmbiguousPhoneContactMatches(rawTarget).takeIf { it.size > 1 }?.let { candidates ->
                pendingReminderContactChoices = candidates
                pendingReminderContactDisambiguationMode = ReminderContactDisambiguationMode.TEXT
                pendingReminderSmsBody = reminderBody
                pendingReminderSmsTriggerAt = if (hasExplicitReminderTime(resolvedMessage)) inferDateTimeFromCommand(resolvedMessage) else null
                awaitingReminderSmsContact = true
                return buildReminderContactChoicePrompt(rawTarget, candidates)
            }

            val targetContact =
                findExactPhoneContactByName(resolveContactAlias(rawTarget))
                    ?: findPhoneContactByName(resolveContactAlias(rawTarget))
            if (targetContact == null) {
                awaitingReminderSmsContact = true
                pendingReminderSmsBody = reminderBody
                pendingReminderSmsTriggerAt = if (hasExplicitReminderTime(resolvedMessage)) inferDateTimeFromCommand(resolvedMessage) else null
                return getString(R.string.text_reminder_contact_prompt)
            }
            tryAutoLearnRelationshipAlias(rawTarget, targetContact.displayName)
            if (!hasExplicitReminderTime(resolvedMessage)) {
                pendingReminderSmsTarget = targetContact
                pendingReminderSmsBody = reminderBody
                return getString(R.string.text_reminder_time_prompt, targetContact.displayName)
            }
            val reminderAt = inferDateTimeFromCommand(resolvedMessage)
            return scheduleTextReminder(targetContact, reminderBody, reminderAt)
        }

        val targetMatch = listOf(
            Regex(".*(?:text|message)\\s+(.+?)\\s+(?:at|on|tomorrow|today|tonight|this morning|this afternoon|this evening|in\\b).*$", RegexOption.IGNORE_CASE),
            Regex(".*(?:text|message)\\s+(.+)$", RegexOption.IGNORE_CASE)
        ).firstNotNullOfOrNull { it.find(resolvedMessage) } ?: return null
        val rawTarget = targetMatch.groupValues[1]
            .trim()
            .replace(
                Regex(
                    "\\b(?:at|for|on)\\s+\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?\\b.*$",
                    RegexOption.IGNORE_CASE
                ),
                ""
            )
            .replace(
                Regex(
                    "\\b(?:today|tomorrow|tonight|this morning|this afternoon|this evening|next week|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b.*$",
                    RegexOption.IGNORE_CASE
                ),
                ""
            )
            .trim()
        if (rawTarget.isBlank()) return null
        findAmbiguousPhoneContactMatches(rawTarget).takeIf { it.size > 1 }?.let { candidates ->
            pendingReminderContactChoices = candidates
            pendingReminderContactDisambiguationMode = ReminderContactDisambiguationMode.TEXT
            pendingReminderSmsBody = null
            pendingReminderSmsTriggerAt = if (hasExplicitReminderTime(resolvedMessage)) inferDateTimeFromCommand(resolvedMessage) else null
            awaitingReminderSmsContact = true
            return buildReminderContactChoicePrompt(rawTarget, candidates)
        }
        val targetContact =
            findExactPhoneContactByName(resolveContactAlias(rawTarget))
                ?: findPhoneContactByName(resolveContactAlias(rawTarget))
        if (targetContact == null) {
            awaitingReminderSmsContact = true
            pendingReminderSmsBody = null
            pendingReminderSmsTriggerAt = if (hasExplicitReminderTime(resolvedMessage)) inferDateTimeFromCommand(resolvedMessage) else null
            return getString(R.string.text_reminder_contact_prompt)
        }
        if (!hasExplicitReminderTime(resolvedMessage)) {
            pendingReminderSmsTarget = targetContact
            pendingReminderSmsBody = null
            return getString(R.string.text_reminder_time_prompt, targetContact.displayName)
        }
        val reminderAt = inferDateTimeFromCommand(resolvedMessage)
        pendingSmsRecipient = targetContact
        pendingSmsBodyDraft = null
        pendingReminderSmsTriggerAt = reminderAt
        val spokenDateTime = formatReminderDateTime(reminderAt)
        return getString(R.string.text_reminder_body_prompt, targetContact.displayName, spokenDateTime)
    }

    private fun scheduleTextReminder(recipient: ContactMatch, body: String, reminderAt: LocalDateTime): String {
        val title = getString(R.string.text_reminder_title, recipient.displayName)
        val text = getString(R.string.text_reminder_text, recipient.displayName, body)
        val triggerAtMillis = reminderAt.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        DexSafetyCheckInScheduler.scheduleOneTimeCheckInAt(
            context = this,
            triggerAtMillis = triggerAtMillis,
            title = title,
            text = text,
            voiceCheckIn = true
        )
        return getString(R.string.text_reminder_set, recipient.displayName, formatReminderDateTime(reminderAt))
    }

    private fun extractReminderCallTarget(message: String): String {
        val lowered = message.lowercase(Locale.US)
        val callIndex = lowered.lastIndexOf("call ")
        if (callIndex < 0) return ""

        var target = message.substring(callIndex + 5)
            .trim()
            .trimEnd('.', '!', '?', ',')

        target = target
            .replace(
                Regex(
                    "\\b(?:at|for|on)\\s+\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?\\b.*$",
                    RegexOption.IGNORE_CASE
                ),
                ""
            )
            .replace(
                Regex(
                    "\\b(?:today|tomorrow|tonight|this morning|this afternoon|this evening|next week|next monday|next tuesday|next wednesday|next thursday|next friday|next saturday|next sunday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b.*$",
                    RegexOption.IGNORE_CASE
                ),
                ""
            )
            .replace(
                Regex(
                    "\\b(?:in the morning|in the afternoon|in the evening)\\b.*$",
                    RegexOption.IGNORE_CASE
                ),
                ""
            )
            .replace(Regex("^(?:to\\s+)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s+(?:please|for me)$", RegexOption.IGNORE_CASE), "")
            .trim()

        return target
    }

    private fun consumePendingNotification(normalized: String): Boolean? {
        val app = pendingNotificationApp
            ?: getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_PENDING_NOTIFICATION_APP, null)
        val title = pendingNotificationTitle
            ?: getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_PENDING_NOTIFICATION_TITLE, null)
        val text = pendingNotificationText
            ?: getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_PENDING_NOTIFICATION_TEXT, null)
        if (app.isNullOrBlank() || text.isNullOrBlank()) return null
        if (!isLikelyNotificationPromptReply(normalized)) return null
        val senderName = title?.takeUnless { it.isBlank() || it.equals(app, ignoreCase = true) }
        val replyContact = senderName?.let { findPhoneContactByName(resolveContactAlias(it)) }

        return when {
            normalized == "read it" ||
                normalized == "read the notification" ||
                normalized == "read that notification" ||
                normalized == "yes read it" ||
                isPromptAffirmativeVoiceReply(normalized) -> {
                pendingNotificationReplyChoice = replyContact != null
                val reply =
                    if (replyContact != null) {
                        getString(R.string.notification_readback_with_sender_and_reply_offer, app, replyContact.displayName, text)
                    } else if (!senderName.isNullOrBlank()) {
                        getString(R.string.notification_readback_with_sender, app, senderName, text)
                    } else {
                        getString(R.string.notification_readback, app, text)
                    }
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                true
            }
            normalized == "reply" ||
            normalized == "reply to it" ||
                normalized == "reply to that" ||
                normalized == "text them back" ||
                normalized == "respond" ||
                (pendingNotificationReplyChoice && isPromptAffirmativeVoiceReply(normalized)) -> {
                if (replyContact == null) {
                    pendingNotificationReplyChoice = false
                    val reply = getString(R.string.notification_reply_unavailable)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    false
                } else {
                    pendingNotificationReplyChoice = false
                    pendingSmsRecipient = replyContact
                    pendingSmsBodyDraft = null
                    val reply = getString(R.string.incoming_sms_reply_prompt, replyContact.displayName)
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    true
                }
            }
            normalized == "ignore it" ||
                normalized == "ignore the notification" ||
                normalized == "ignore that" ||
                isPromptNegativeVoiceReply(normalized) ||
                normalized == "cancel" -> {
                val reply = getString(R.string.notification_ignored)
                pendingNotificationReplyChoice = false
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                clearPendingNotification()
                true
            }
            else -> null
        }
    }

    private fun clearPendingIncomingSms() {
        pendingIncomingSmsSender = null
        pendingIncomingSmsValue = null
        pendingIncomingSmsBody = null
        pendingIncomingSmsReplyChoice = false
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_PENDING_INCOMING_SMS_SENDER)
            .remove(KEY_PENDING_INCOMING_SMS_VALUE)
            .remove(KEY_PENDING_INCOMING_SMS_BODY)
            .apply()
    }

    private fun clearPendingNotification() {
        pendingNotificationApp = null
        pendingNotificationTitle = null
        pendingNotificationText = null
        pendingNotificationReplyChoice = false
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_PENDING_NOTIFICATION_APP)
            .remove(KEY_PENDING_NOTIFICATION_TITLE)
            .remove(KEY_PENDING_NOTIFICATION_TEXT)
            .apply()
    }

    private fun isAffirmativeVoiceReply(normalized: String): Boolean {
        return normalized == "yes" ||
            normalized.startsWith("yes ") ||
            normalized == "yeah" ||
            normalized.startsWith("yeah ") ||
            normalized == "yep" ||
            normalized.startsWith("yep ") ||
            normalized == "ok" ||
            normalized.startsWith("ok ") ||
            normalized == "okay" ||
            normalized.startsWith("okay ") ||
            normalized == "sure" ||
            normalized.startsWith("sure ")
    }

    private fun isNegativeVoiceReply(normalized: String): Boolean {
        return normalized == "no" ||
            normalized.startsWith("no ") ||
            normalized == "nope" ||
            normalized.startsWith("nope ") ||
            normalized == "nah" ||
            normalized.startsWith("nah ") ||
            normalized.contains("no thanks") ||
            normalized.contains("not now") ||
            normalized.contains("don't") ||
            normalized.contains("do not") ||
            normalized.contains("leave it") ||
            normalized.contains("ignore it")
    }

    private fun isPromptAffirmativeVoiceReply(normalized: String): Boolean {
        return normalized == "yes" ||
            normalized == "yes please" ||
            normalized == "go ahead" ||
            normalized == "go ahead please" ||
            normalized == "yeah" ||
            normalized == "yeah please" ||
            normalized == "yep" ||
            normalized == "ok" ||
            normalized == "okay" ||
            normalized == "okay then" ||
            normalized == "sure" ||
            normalized == "read it please"
    }

    private fun isPromptNegativeVoiceReply(normalized: String): Boolean {
        return normalized == "no" ||
            normalized == "no thanks" ||
            normalized == "no thank you" ||
            normalized == "nope" ||
            normalized == "nah" ||
            normalized == "not now" ||
            normalized == "leave that" ||
            normalized == "leave it" ||
            normalized == "don't read it" ||
            normalized == "do not read it" ||
            normalized == "ignore it" ||
            normalized == "cancel"
    }

    private fun isLikelySmsPromptReply(normalized: String): Boolean {
        return normalized == "read it" ||
            normalized == "read the text" ||
            normalized == "read the message" ||
            normalized == "yes read it" ||
            normalized == "yes read the text" ||
            normalized == "read it again" ||
            normalized == "read that again" ||
            normalized == "say it again" ||
            normalized == "reply to it" ||
            normalized == "reply to that" ||
            normalized == "text them back" ||
            normalized == "reply back" ||
            normalized == "answer it" ||
            normalized == "ignore it" ||
            normalized == "ignore the text" ||
            normalized == "ignore the message" ||
            isPromptAffirmativeVoiceReply(normalized) ||
            isPromptNegativeVoiceReply(normalized)
    }

    private fun isLikelyNotificationPromptReply(normalized: String): Boolean {
        return normalized == "read it" ||
            normalized == "read the notification" ||
            normalized == "read that notification" ||
            normalized == "yes read it" ||
            normalized == "reply" ||
            normalized == "reply to it" ||
            normalized == "reply to that" ||
            normalized == "text them back" ||
            normalized == "respond" ||
            normalized == "ignore it" ||
            normalized == "ignore the notification" ||
            normalized == "ignore that" ||
            isPromptAffirmativeVoiceReply(normalized) ||
            isPromptNegativeVoiceReply(normalized)
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
        pendingAction ?: return null
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
            pendingDetectedContactPhrase?.let { tryAutoLearnRelationshipAlias(it, contact.displayName) }
            pendingDetectedContactPhrase = null
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

        pendingDetectedContactPhrase?.let { tryAutoLearnRelationshipAlias(it, contact.displayName) }
        pendingContactTarget = contact
        val preferredAction = preferredContactAction(contact.displayName)
        val reply = if (preferredAction != null) {
            getString(
                R.string.contact_target_confirmed_preferred,
                contact.displayName,
                preferredContactActionLabel(preferredAction),
                preferredContactActionOptions(preferredAction)
            )
        } else {
            getString(R.string.contact_target_confirmed, contact.displayName)
        }
        binding.conversationStatus.text = reply
        binding.lastReplyValue.text = reply
        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
    }

    private fun queuePendingAction(action: PendingAction) {
        pendingAction = action
        when (action.kind) {
            PendingActionKind.SMS_DRAFT -> action.targetName?.let { recordContactActionPreference(it, PendingContactAction.TEXT) }
            PendingActionKind.EMAIL_DRAFT -> action.targetName?.let { recordContactActionPreference(it, PendingContactAction.EMAIL) }
            else -> Unit
        }
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

    private fun keepWakeConversationOpenAfterSpeech() {
        if (!wakeModeEnabled) return
        awaitingWakeCommand = false
        conversationActive = true
        scheduleConversationTimeout()
        if (shouldReturnToWakeWordMode()) {
            binding.conversationStatus.text = getString(R.string.wake_mode_command_ready)
        }
    }

    private fun shouldReturnToWakeWordMode(): Boolean {
        return pendingAction == null &&
            pendingNotificationText.isNullOrBlank() &&
            pendingIncomingSmsSender.isNullOrBlank() &&
            pendingIncomingSmsValue.isNullOrBlank() &&
            pendingIncomingSmsBody.isNullOrBlank() &&
            !pendingIncomingSmsReplyChoice &&
            pendingContactTarget == null &&
            pendingContactAction == null &&
            pendingSmsRecipient == null &&
            pendingReminderSmsTriggerAt == null &&
            pendingReminderSmsTarget == null &&
            pendingReminderSmsBody.isNullOrBlank() &&
            !awaitingReminderSmsContact &&
            pendingReminderCallTriggerAt == null &&
            !awaitingReminderCallContact &&
            pendingReminderCallTargetName == null &&
            pendingReminderContactChoices.isEmpty() &&
            pendingReminderContactDisambiguationMode == null &&
            pendingSmsBodyDraft.isNullOrBlank() &&
            !listeningForQuizAnswer &&
            activeQuizSession == null &&
            !dexChatInFlight &&
            !shouldResumeCallListeningAfterSpeech &&
            lastCallState != TelephonyManager.CALL_STATE_RINGING
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
        val normalizedMessage = message.trim().lowercase(Locale.US)
        val now = SystemClock.elapsedRealtime()
        if (dexChatInFlight) {
            binding.conversationStatus.text = getString(R.string.wake_mode_thinking)
            return
        }
        if (normalizedMessage == lastDexChatMessage && now - lastDexChatSentAt < DEX_CHAT_DUPLICATE_GUARD_MS) {
            return
        }
        dexChatInFlight = true
        lastDexChatMessage = normalizedMessage
        lastDexChatSentAt = now
        awaitingWakeCommand = false
        mainHandler.removeCallbacks(resetWakeWindowRunnable)
        binding.lastHeardValue.text = message
        binding.conversationStatus.text = getString(R.string.wake_mode_thinking)
        lifecycleScope.launch {
            val result = postJson("$serverUrl/dex/chat", JSONObject().apply { put("message", message) }, token)
            result.onSuccess { response ->
                val localEmergency = isHighRiskEmergencyMessage(message)
                val serverEmergency = response.optBoolean("emergency", false)
                val reply = when {
                    serverEmergency -> buildEmergencySpokenReply(response.optString("reply"))
                    localEmergency -> buildEmergencySpokenReply()
                    else -> response.optString("reply").ifBlank { getString(R.string.wake_mode_fallback_reply) }
                }
                maybeScheduleSafetyCheckIn(response, message, forceEmergency = localEmergency)
                val localSmsStatus = sendLocalEmergencySmsIfNeeded(response, message, forceEmergency = localEmergency)
                val spokenReply = listOfNotNull(reply, localSmsStatus).joinToString(" ")
                binding.lastReplyValue.text = spokenReply
                binding.conversationStatus.text = getString(R.string.wake_mode_replying)
                conversationActive = true
                scheduleConversationTimeout()
                speakDex(
                    spokenReply,
                    R.string.voice_speaking,
                    resumeWakeModeAfterSpeech = true,
                    speechProfile = if (serverEmergency || localEmergency) DexSpeechProfile.CRISIS else DexSpeechProfile.CONVERSATION
                )
                dexChatInFlight = false
            }.onFailure { error ->
                val fallback = error.message ?: getString(R.string.wake_mode_fallback_reply)
                if (isExpiredSessionMessage(fallback)) {
                    dexChatInFlight = false
                    handleExpiredSession()
                    speakDex(fallback, R.string.voice_speaking, resumeWakeModeAfterSpeech = false)
                    return@onFailure
                }
                val localEmergency = isHighRiskEmergencyMessage(message)
                val spokenReply = if (localEmergency) {
                    maybeScheduleSafetyCheckIn(null, message, forceEmergency = true)
                    listOfNotNull(
                        buildEmergencySpokenReply(),
                        sendLocalEmergencySmsIfNeeded(null, message, forceEmergency = true)
                    ).joinToString(" ")
                } else {
                    fallback
                }
                binding.lastReplyValue.text = spokenReply
                binding.conversationStatus.text = spokenReply
                conversationActive = true
                scheduleConversationTimeout()
                speakDex(
                    spokenReply,
                    R.string.voice_speaking,
                    resumeWakeModeAfterSpeech = true,
                    speechProfile = if (localEmergency) DexSpeechProfile.CRISIS else DexSpeechProfile.CONVERSATION
                )
                dexChatInFlight = false
            }
        }
    }

    private fun maybeScheduleSafetyCheckIn(response: JSONObject?, triggerMessage: String, forceEmergency: Boolean = false) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val followUpOptIn = prefs.getBoolean(KEY_SAFETY_FOLLOW_UP_OPT_IN, binding.safetyFollowUpSwitch.isChecked)
        if (!followUpOptIn) return
        val localMood = detectSupportMood(triggerMessage, emergency = forceEmergency)
        if (!forceEmergency && localMood == SAFETY_MOOD_NONE && !(response?.optBoolean("followUpSuggested", false) == true)) return
        val delayMinutes = when {
            forceEmergency -> 5
            response?.optBoolean("followUpSuggested", false) == true -> response.optInt("followUpDelayMinutes", 15).coerceAtLeast(1)
            localMood == SAFETY_MOOD_ANGER -> 8
            localMood == SAFETY_MOOD_STRESS -> 12
            localMood == SAFETY_MOOD_SADNESS -> 15
            else -> 15
        }
        val mood = if (forceEmergency) SAFETY_MOOD_CRISIS else localMood.takeUnless { it == SAFETY_MOOD_NONE } ?: SAFETY_MOOD_GENERAL
        val title = response?.optString("followUpTitle").orEmpty().ifBlank { buildSafetyCheckInTitle(mood, emergency = forceEmergency) }
        val text = response?.optString("followUpMessage").orEmpty().ifBlank { buildSafetyCheckInMessage(mood, emergency = forceEmergency) }
        DexSafetyCheckInScheduler.scheduleOneTimeCheckIn(
            context = this,
            delayMinutes = delayMinutes,
            title = title,
            text = text,
            voiceCheckIn = true,
            kind = "safety",
            mood = mood,
            emergencyFollowUp = forceEmergency || response?.optBoolean("emergency", false) == true
        )
        prefs.edit()
            .putString(KEY_LAST_SAFETY_MOOD, mood)
            .putLong(KEY_LAST_SAFETY_CHECK_IN_AT, System.currentTimeMillis())
            .apply()
    }

    private fun detectSupportMood(message: String, emergency: Boolean = false): String {
        if (emergency || isHighRiskEmergencyMessage(message)) return SAFETY_MOOD_CRISIS
        val normalized = message.trim().lowercase(Locale.US)
        if (normalized.isBlank()) return SAFETY_MOOD_NONE
        val angerPhrases = listOf("angry", "mad", "pissed", "furious", "rage", "irritated", "annoyed", "frustrated")
        val sadnessPhrases = listOf("sad", "down", "depressed", "lonely", "hurt", "heartbroken", "crying", "grief", "hopeless")
        val stressPhrases = listOf("stressed", "overwhelmed", "anxious", "panic", "panicking", "tense", "burned out", "burnt out", "too much")
        return when {
            angerPhrases.any { normalized.contains(it) } -> SAFETY_MOOD_ANGER
            sadnessPhrases.any { normalized.contains(it) } -> SAFETY_MOOD_SADNESS
            stressPhrases.any { normalized.contains(it) } -> SAFETY_MOOD_STRESS
            else -> SAFETY_MOOD_NONE
        }
    }

    private fun buildSafetyCheckInTitle(mood: String, emergency: Boolean): String {
        return when {
            emergency -> getString(R.string.safety_check_in_title_crisis)
            mood == SAFETY_MOOD_ANGER -> getString(R.string.safety_check_in_title_anger)
            mood == SAFETY_MOOD_SADNESS -> getString(R.string.safety_check_in_title_sadness)
            mood == SAFETY_MOOD_STRESS -> getString(R.string.safety_check_in_title_stress)
            else -> getString(R.string.safety_check_in_title)
        }
    }

    private fun buildSafetyCheckInMessage(mood: String, emergency: Boolean): String {
        val name = resolveEmergencyPersonName()
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val comfortStyle = prefs.getString(KEY_SAFETY_COMFORT_STYLE, binding.safetyComfortInput.text?.toString()?.trim().orEmpty())
            .orEmpty()
            .ifBlank { "calm" }
        val groundingStyle = prefs.getString(KEY_SAFETY_GROUNDING_STYLE, binding.safetyGroundingInput.text?.toString()?.trim().orEmpty())
            .orEmpty()
            .ifBlank { "gentle" }
        return when {
            emergency -> getString(R.string.safety_check_in_text_crisis, name)
            mood == SAFETY_MOOD_ANGER -> getString(R.string.safety_check_in_text_anger, name, groundingStyle)
            mood == SAFETY_MOOD_SADNESS -> getString(R.string.safety_check_in_text_sadness, name, comfortStyle)
            mood == SAFETY_MOOD_STRESS -> getString(R.string.safety_check_in_text_stress, name, groundingStyle)
            else -> getString(R.string.safety_check_in_text_friend, name, comfortStyle)
        }
    }

    private fun sendLocalEmergencySmsIfNeeded(response: JSONObject?, triggerMessage: String, forceEmergency: Boolean = false): String? {
        val emergency = forceEmergency || response?.optBoolean("emergency", false) == true
        if (!emergency) return null
        if (response?.optBoolean("trustedContactDelivered", false) == true) return null
        if (lastEmergencyTriggerReason.isBlank()) {
            lastEmergencyTriggerReason =
                if (forceEmergency) "local high-risk phrase" else "server emergency response"
        }

        val now = SystemClock.elapsedRealtime()
        if (now - lastLocalEmergencySmsSentAt < LOCAL_EMERGENCY_SMS_COOLDOWN_MS) return null

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val contactPermission =
            prefs.getBoolean(KEY_EMERGENCY_CONTACT_PERMISSION, false) || binding.safetyNotifyTrustedContactSwitch.isChecked
        if (!contactPermission) return null

        val contact = resolveEmergencyTrustedContact()
        val phoneNumber = normalizeSmsPhoneNumber(contact)
        if (phoneNumber.isBlank()) return null

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            return getString(R.string.local_emergency_sms_permission_missing).also {
                refreshSafetyDiagnostics(lastStatus = it)
                appendActivityLog("Safety", it)
            }
        }

        val userName = resolveEmergencyPersonName()
        val shortMessage = triggerMessage.trim().replace(Regex("\\s+"), " ").take(72)
        val smsBody = getString(R.string.local_emergency_sms_body, userName, shortMessage)
        return sendLocalEmergencySmsWithStatus(
            phoneNumber = phoneNumber,
            smsBody = smsBody,
            startedAt = now,
            triggerReason = lastEmergencyTriggerReason
        )
    }

    private fun isHighRiskEmergencyMessage(message: String): Boolean {
        val normalized = message.trim().lowercase(Locale.US)
        if (normalized.isBlank()) return false
        val highRiskPhrases = listOf(
            "kill myself",
            "want to kill myself",
            "suicidal",
            "i'm suicidal",
            "im suicidal",
            "end my life",
            "take my life",
            "want to die",
            "don't want to live",
            "do not want to live",
            "hurt myself",
            "harm myself",
            "self harm",
            "hurt someone",
            "hurt somebody",
            "hurt other people",
            "hurt others",
            "harm someone",
            "harm somebody",
            "harm other people",
            "harm others",
            "kill someone",
            "kill somebody",
            "kill other people",
            "kill others",
            "want to hurt someone",
            "want to hurt somebody",
            "want to hurt other people",
            "want to hurt others",
            "want to kill someone",
            "want to kill somebody",
            "want to kill other people",
            "want to kill others",
            "thinking about hurting someone",
            "thinking about hurting somebody",
            "thinking about hurting other people",
            "thinking about hurting others",
            "thinking about killing someone",
            "thinking about killing somebody",
            "thinking about killing other people",
            "thinking about killing others",
        )
        return highRiskPhrases.any { normalized.contains(it) }
    }

    private fun sendLocalEmergencySmsWithStatus(
        phoneNumber: String,
        smsBody: String,
        startedAt: Long,
        countForCooldown: Boolean = true,
        triggerReason: String = lastEmergencyTriggerReason.ifBlank { "unknown" }
    ): String {
        val token = startedAt.toInt()
        val sentIntent = Intent(ACTION_LOCAL_EMERGENCY_SMS_SENT).putExtra(EXTRA_SMS_TOKEN, token)
        val deliveredIntent = Intent(ACTION_LOCAL_EMERGENCY_SMS_DELIVERED).putExtra(EXTRA_SMS_TOKEN, token)
        val sentPendingIntent = PendingIntent.getBroadcast(
            this,
            token,
            sentIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val deliveredPendingIntent = PendingIntent.getBroadcast(
            this,
            token + 1,
            deliveredIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        registerLocalEmergencySmsStatusReceiver(token)
        lastEmergencyTriggerReason = triggerReason

        return runCatching {
            val smsManager = resolveSmsManager()
            val messageParts = smsManager.divideMessage(smsBody)
            if (messageParts.size > 1) {
                val sentIntents = ArrayList<PendingIntent?>(messageParts.size).apply {
                    add(sentPendingIntent)
                    repeat(messageParts.size - 1) { add(null) }
                }
                val deliveredIntents = ArrayList<PendingIntent?>(messageParts.size).apply {
                    repeat(messageParts.size - 1) { add(null) }
                    add(deliveredPendingIntent)
                }
                smsManager.sendMultipartTextMessage(phoneNumber, null, ArrayList(messageParts), sentIntents, deliveredIntents)
            } else {
                smsManager.sendTextMessage(phoneNumber, null, smsBody, sentPendingIntent, deliveredPendingIntent)
            }
        }.fold(
            onSuccess = {
                if (countForCooldown) {
                    lastLocalEmergencySmsSentAt = startedAt
                }
                getString(R.string.local_emergency_sms_attempting).also {
                    refreshSafetyDiagnostics(lastStatus = it, lastTrigger = triggerReason)
                    appendActivityLog("Safety", "$triggerReason -> $it")
                }
            },
            onFailure = {
                getString(R.string.local_emergency_sms_failed).also {
                    refreshSafetyDiagnostics(lastStatus = it, lastTrigger = triggerReason)
                    appendActivityLog("Safety", "$triggerReason -> $it")
                }
            }
        )
    }

    private fun registerLocalEmergencySmsStatusReceiver(token: Int) {
        var isFinished = false
        var sentConfirmed = false
        lateinit var receiver: BroadcastReceiver
        fun finish(message: String) {
            if (isFinished) return
            isFinished = true
            if (message.isNotBlank()) {
                binding.conversationStatus.text = message
                binding.lastReplyValue.text = "${binding.lastReplyValue.text} $message".trim()
                refreshSafetyDiagnostics(lastStatus = message)
                appendActivityLog("Safety", message)
            }
            runCatching { unregisterReceiver(receiver) }
        }

        receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.getIntExtra(EXTRA_SMS_TOKEN, -1) != token) return
                when (intent.action) {
                    ACTION_LOCAL_EMERGENCY_SMS_SENT -> {
                        if (resultCode != Activity.RESULT_OK) {
                            finish(getString(R.string.local_emergency_sms_failed))
                        } else {
                            sentConfirmed = true
                        }
                    }
                    ACTION_LOCAL_EMERGENCY_SMS_DELIVERED -> {
                        finish(
                            if (resultCode == Activity.RESULT_OK) {
                                getString(R.string.local_emergency_sms_delivered)
                            } else {
                                getString(R.string.local_emergency_sms_not_delivered)
                            }
                        )
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(ACTION_LOCAL_EMERGENCY_SMS_SENT)
            addAction(ACTION_LOCAL_EMERGENCY_SMS_DELIVERED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(receiver, filter)
        }
        mainHandler.postDelayed({
            finish(
                if (sentConfirmed) {
                    getString(R.string.local_emergency_sms_sent_no_receipt)
                } else {
                    getString(R.string.local_emergency_sms_no_delivery_confirmation)
                }
            )
        }, LOCAL_EMERGENCY_SMS_DELIVERY_TIMEOUT_MS)
    }

    private fun refreshSafetyDiagnostics(lastStatus: String? = null, lastTrigger: String? = null) {
        lastStatus?.let { lastEmergencySmsStatus = it }
        lastTrigger?.let { lastEmergencyTriggerReason = it }
        val assistedPersonName = resolveEmergencyPersonName()
        val birthday = resolveEmergencyBirthday()
        val savedContact = resolveEmergencyTrustedContact()
        val normalizedTarget = normalizeSmsPhoneNumber(savedContact).ifBlank { getString(R.string.safety_contact_none) }
        val alertsEnabled = if (binding.safetyNotifyTrustedContactSwitch.isChecked) {
            getString(R.string.diagnostic_enabled)
        } else {
            getString(R.string.diagnostic_disabled)
        }
        val smsPermission = if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) {
            getString(R.string.diagnostic_granted)
        } else {
            getString(R.string.diagnostic_missing)
        }
        val trigger = lastEmergencyTriggerReason.ifBlank { getString(R.string.diagnostic_none) }
        val status = lastEmergencySmsStatus.ifBlank { getString(R.string.diagnostic_none) }
        binding.safetyDiagnosticsValue.text = getString(
            R.string.safety_diagnostics_template,
            assistedPersonName,
            birthday,
            savedContact.ifBlank { getString(R.string.safety_contact_none) },
            normalizedTarget,
            alertsEnabled,
            smsPermission,
            trigger,
            status
        )
    }

    private fun normalizeSmsPhoneNumber(value: String): String {
        val trimmed = value.trim()
        if (trimmed.isBlank() || trimmed.contains("@")) return ""
        val digits = trimmed.filter { it.isDigit() }
        return when {
            trimmed.startsWith("+") && digits.length >= 10 -> "+$digits"
            digits.length == 10 -> "+1$digits"
            digits.length == 11 && digits.startsWith("1") -> "+$digits"
            digits.length >= 10 -> "+$digits"
            else -> ""
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
        tryAutoLearnRelationshipAlias(match.groupValues[1].trim(), contact.displayName)
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
        tryAutoLearnRelationshipAlias(match.groupValues[1].trim(), contact.displayName)
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
        if (looksLikeReminderCommand(normalized)) return null
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
        tryAutoLearnRelationshipAlias(match.groupValues[1].trim(), contact.displayName)
        return DirectCallRequest(
            displayName = contact.displayName,
            phoneNumber = contact.value,
        )
    }

    private fun buildHeuristicCallRequest(message: String): DirectCallRequest? {
        val normalized = message.lowercase(Locale.US)
        if (looksLikeReminderCommand(normalized)) return null
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

    private fun looksLikeReminderCommand(message: String): Boolean {
        val normalized = message.trim().lowercase(Locale.US)
        if (normalized.isBlank()) return false
        val reminderIntent =
            normalized.contains("remind me") ||
                normalized.contains("set a reminder") ||
                normalized.contains("create a reminder") ||
                normalized.contains("make a reminder")
        return reminderIntent && normalized.contains("call ")
    }

    private fun detectContactOnlyIntent(message: String): ContactMatch? {
        val trimmed = message.trim()
        if (!isLikelyBareContactName(trimmed)) return null
        val resolvedName = resolveContactAlias(trimmed)
        if (resolvedName.isBlank()) return null
        return findExactPhoneContactByName(resolvedName)
            ?: findPhoneContactByName(resolvedName)
    }

    private fun clearStalePromptState() {
        clearPendingIncomingSms()
        clearPendingNotification()
        pendingContactTarget = null
        pendingContactAction = null
        pendingDetectedContactPhrase = null
    }

    private fun shouldResetPromptStateForFreshCommand(message: String): Boolean {
        val normalized = message.trim().lowercase(Locale.US)
        if (normalized.isBlank()) return false
        if (isLikelySmsPromptReply(normalized) || isLikelyNotificationPromptReply(normalized)) return false
        return looksLikeFreshStandaloneCommand(normalized)
    }

    private fun looksLikeFreshStandaloneCommand(normalized: String): Boolean {
        if (
            normalized.contains("weather") ||
            normalized.contains("forecast") ||
            normalized.contains("temperature")
        ) {
            return true
        }
        return normalized.startsWith("what ") ||
            normalized.startsWith("what's ") ||
            normalized.startsWith("whats ") ||
            normalized.startsWith("how ") ||
            normalized.startsWith("how's ") ||
            normalized.startsWith("hows ") ||
            normalized.startsWith("when ") ||
            normalized.startsWith("where ") ||
            normalized.startsWith("who ") ||
            normalized.startsWith("why ") ||
            normalized.startsWith("tell me ") ||
            normalized.startsWith("open ") ||
            normalized.startsWith("play ") ||
            normalized.startsWith("set ") ||
            normalized.startsWith("start ") ||
            normalized.startsWith("can you ") ||
            normalized.startsWith("could you ") ||
            normalized.startsWith("will you ") ||
            normalized.startsWith("do i ") ||
            normalized.startsWith("is it ") ||
            normalized.startsWith("are there ")
    }

    private fun isLikelyBareContactName(message: String): Boolean {
        val normalized = message.trim().lowercase(Locale.US)
        if (normalized.isBlank() || normalized.length > 32) return false
        if (looksLikeFreshStandaloneCommand(normalized)) return false
        if (normalized.contains("?")) return false
        val words = normalized.split(Regex("\\s+")).filter { it.isNotBlank() }
        if (words.isEmpty() || words.size > 3) return false
        val blockedWords = setOf(
            "call",
            "text",
            "message",
            "email",
            "weather",
            "forecast",
            "temperature",
            "read",
            "reply",
            "ignore",
            "yes",
            "no"
        )
        return words.none { it in blockedWords }
    }

    private fun consumePendingContactTarget(normalized: String): Boolean? {
        val contact = pendingContactTarget ?: return null
        extractCorrectedContactPhrase(normalized)?.let { correctedPhrase ->
            val correctedContact = findExactPhoneContactByName(resolveContactAlias(correctedPhrase))
                ?: findPhoneContactByName(resolveContactAlias(correctedPhrase))
            if (correctedContact != null) {
                pendingDetectedContactPhrase?.let { tryAutoLearnRelationshipAlias(it, correctedContact.displayName) }
                pendingDetectedContactPhrase = correctedPhrase
                pendingContactTarget = correctedContact
                val reply = getString(R.string.contact_target_corrected, correctedContact.displayName)
                binding.conversationStatus.text = reply
                binding.lastReplyValue.text = reply
                speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                return true
            }
        }
        return when {
            normalized == "call" || normalized == "call them" || normalized == "call her" || normalized == "call him" -> {
                recordContactActionPreference(contact.displayName, PendingContactAction.CALL, weight = 3)
                pendingContactTarget = null
                pendingDetectedContactPhrase = null
                placeVoiceRequestedCall(DirectCallRequest(contact.displayName, contact.value))
                true
            }
            normalized == "text" || normalized == "text them" || normalized == "message them" || normalized == "text her" || normalized == "text him" -> {
                recordContactActionPreference(contact.displayName, PendingContactAction.TEXT, weight = 3)
                pendingContactTarget = null
                pendingDetectedContactPhrase = null
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
                recordContactActionPreference(contact.displayName, PendingContactAction.EMAIL, weight = 3)
                pendingContactTarget = null
                pendingDetectedContactPhrase = null
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

    private fun extractCorrectedContactPhrase(normalized: String): String? {
        val trimmed = normalized.trim()
        val correctionPrefixes = listOf(
            "no ",
            "no, ",
            "i meant ",
            "no i meant ",
            "not ",
            "wrong person ",
            "wrong one ",
        )
        val corrected = correctionPrefixes.firstNotNullOfOrNull { prefix ->
            trimmed.takeIf { it.startsWith(prefix) }?.removePrefix(prefix)?.trim()
        } ?: return null
        return corrected.takeIf { it.isNotBlank() }
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
        val pendingReminderAt = pendingReminderSmsTriggerAt
        return when (normalized) {
            "cancel", "cancel it", "never mind", "stop" -> {
                pendingSmsRecipient = null
                pendingSmsBodyDraft = null
                pendingReminderSmsTriggerAt = null
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
                    val reply = if (pendingReminderAt != null) {
                        getString(R.string.text_reminder_body_prompt, recipient.displayName, formatReminderDateTime(pendingReminderAt))
                    } else {
                        getString(R.string.ask_what_to_text, recipient.displayName)
                    }
                    binding.conversationStatus.text = reply
                    binding.lastReplyValue.text = reply
                    speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                } else {
                    pendingSmsRecipient = null
                    pendingSmsBodyDraft = null
                    pendingReminderSmsTriggerAt = null
                    if (pendingReminderAt != null) {
                        val reply = scheduleTextReminder(recipient, approvedBody, pendingReminderAt)
                        binding.conversationStatus.text = reply
                        binding.lastReplyValue.text = reply
                        speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
                    } else {
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
                }
                true
            }
            "no", "no that's wrong", "say it again", "try again", "start over", "rewrite that" -> {
                pendingSmsBodyDraft = null
                val reply = if (pendingReminderAt != null) {
                    getString(R.string.text_reminder_body_prompt, recipient.displayName, formatReminderDateTime(pendingReminderAt))
                } else {
                    getString(R.string.ask_what_to_text, recipient.displayName)
                }
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
            .replace(Regex("\\bat\\s+\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)\\b", RegexOption.IGNORE_CASE), "")
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

    private fun hasExplicitReminderTime(message: String): Boolean {
        val normalized = message.lowercase(Locale.US)
            .replace("a.m.", "am")
            .replace("p.m.", "pm")
            .replace("a.m", "am")
            .replace("p.m", "pm")
        return Regex("\\bin\\s+\\d{1,3}\\s+minutes?\\b", RegexOption.IGNORE_CASE).containsMatchIn(normalized) ||
            Regex("\\bin\\s+\\d{1,2}\\s+hours?\\b", RegexOption.IGNORE_CASE).containsMatchIn(normalized) ||
            Regex("(?:\\bat\\s+)?\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\b", RegexOption.IGNORE_CASE).containsMatchIn(normalized) ||
            Regex("\\bat\\s+\\d{1,2}(?::\\d{2})?\\b", RegexOption.IGNORE_CASE).containsMatchIn(normalized) ||
            listOf(
                "today",
                "tomorrow",
                "tonight",
                "this morning",
                "this afternoon",
                "this evening",
                "next week",
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
                "sunday",
                "noon",
                "midnight",
                "morning",
                "afternoon",
                "evening"
            ).any { normalized.contains(it) }
    }

    private fun inferDateTimeFromCommand(message: String): LocalDateTime {
        val lower = message.lowercase(Locale.US)
        val normalized = lower
            .replace("a.m.", "am")
            .replace("p.m.", "pm")
            .replace("a.m", "am")
            .replace("p.m", "pm")
        val now = LocalDateTime.now()
        val relativeMinuteMatch = Regex("\\bin\\s+(\\d{1,3})\\s+minutes?\\b", RegexOption.IGNORE_CASE).find(normalized)
        if (relativeMinuteMatch != null) {
            return now.plusMinutes(relativeMinuteMatch.groupValues[1].toLong())
        }
        val relativeHourMatch = Regex("\\bin\\s+(\\d{1,2})\\s+hours?\\b", RegexOption.IGNORE_CASE).find(normalized)
        if (relativeHourMatch != null) {
            return now.plusHours(relativeHourMatch.groupValues[1].toLong())
        }
        val date = inferRequestedDate(normalized)
        val timeMatch = Regex("(?:\\bat\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)", RegexOption.IGNORE_CASE).find(normalized)
        val time = if (timeMatch != null) {
            var hour = timeMatch.groupValues[1].toInt()
            val minute = timeMatch.groupValues[2].ifBlank { "0" }.toInt()
            val meridiem = timeMatch.groupValues[3].lowercase(Locale.US).replace(".", "")
            if (meridiem == "pm" && hour < 12) hour += 12
            if (meridiem == "am" && hour == 12) hour = 0
            LocalTime.of(hour, minute)
        } else {
            val bareTime = Regex("\\bat\\s+(\\d{1,2})(?::(\\d{2}))?\\b", RegexOption.IGNORE_CASE).find(normalized)
            if (bareTime != null) {
                val hourRaw = bareTime.groupValues[1].toInt()
                val minute = bareTime.groupValues[2].ifBlank { "0" }.toInt()
                val inferredHour = inferHourWithoutMeridiem(hourRaw, date, now)
                LocalTime.of(inferredHour, minute)
            } else if (normalized.contains("noon")) {
                LocalTime.NOON
            } else if (normalized.contains("midnight")) {
                LocalTime.MIDNIGHT
            } else if (normalized.contains("morning")) {
                LocalTime.of(9, 0)
            } else if (normalized.contains("afternoon")) {
                LocalTime.of(15, 0)
            } else if (normalized.contains("evening") || normalized.contains("tonight")) {
                LocalTime.of(18, 0)
            } else {
                LocalTime.of(9, 0)
            }
        }
        return LocalDateTime.of(date, time)
    }

    private fun inferHourWithoutMeridiem(hourRaw: Int, date: LocalDate, now: LocalDateTime): Int {
        val normalizedHour = hourRaw.coerceIn(0, 23)
        if (hourRaw > 12) return normalizedHour

        val candidateMorning = LocalDateTime.of(date, LocalTime.of(if (hourRaw == 12) 0 else hourRaw, 0))
        val candidateEveningHour = when {
            hourRaw == 12 -> 12
            hourRaw < 12 -> hourRaw + 12
            else -> hourRaw
        }
        val candidateEvening = LocalDateTime.of(date, LocalTime.of(candidateEveningHour, 0))
        return when {
            date.isAfter(now.toLocalDate()) -> if (hourRaw in 1..7) candidateEvening.hour else candidateMorning.hour
            candidateMorning.isAfter(now) -> candidateMorning.hour
            candidateEvening.isAfter(now) -> candidateEvening.hour
            else -> candidateMorning.hour
        }
    }

    private fun formatReminderDateTime(dateTime: LocalDateTime): String {
        val today = LocalDate.now()
        val targetDate = dateTime.toLocalDate()
        val timePart = dateTime.format(DateTimeFormatter.ofPattern("h:mm a", Locale.US))
        return when (targetDate) {
            today -> "today at $timePart"
            today.plusDays(1) -> "tomorrow at $timePart"
            else -> dateTime.format(DateTimeFormatter.ofPattern("EEE, MMM d 'at' h:mm a", Locale.US))
        }
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
            val smsManager = resolveSmsManager()
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

    private fun resolveSmsManager(): SmsManager {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            getSystemService(SmsManager::class.java)
        } else {
            @Suppress("DEPRECATION")
            SmsManager.getDefault()
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
        if (shouldSuppressImmediateCallAfterReminder(request)) {
            val reply = getString(R.string.call_reminder_no_immediate_call, request.displayName)
            binding.conversationStatus.text = reply
            binding.lastReplyValue.text = reply
            speakDex(reply, R.string.voice_speaking, resumeWakeModeAfterSpeech = true)
            return
        }
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
            recordContactActionPreference(request.displayName, PendingContactAction.CALL)
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
        return findBestPhoneContactMatch(name, requireExact = false)
    }

    private fun findExactPhoneContactByName(name: String): ContactMatch? {
        return findBestPhoneContactMatch(name, requireExact = true)
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
        val normalizedMessage = normalizeContactLookupText(resolveAliasesInSentence(message))
        if (normalizedMessage.isBlank()) return null
        return readPhoneContacts()
            .mapNotNull { contact ->
                val display = normalizeContactLookupText(contact.displayName)
                if (display.isBlank()) {
                    null
                } else if (
                    normalizedMessage.contains(display) ||
                    normalizeCompactContactText(normalizedMessage).contains(normalizeCompactContactText(display))
                ) {
                    display.length to contact
                } else {
                    null
                }
            }
            .maxByOrNull { it.first }
            ?.second
    }

    private fun findAmbiguousPhoneContactMatches(name: String): List<ContactMatch> {
        val scoredMatches = findScoredPhoneContactMatches(name, requireExact = false)
        if (scoredMatches.size < 2) return emptyList()
        val topScore = scoredMatches.first().score
        val closeMatches = scoredMatches
            .takeWhile { topScore - it.score <= 40 }
            .map { it.contact }
            .distinctBy { "${it.displayName}|${it.value}" }
        return if (topScore >= 350 && closeMatches.size > 1) closeMatches.take(3) else emptyList()
    }

    private fun findBestPhoneContactMatch(name: String, requireExact: Boolean): ContactMatch? {
        return findScoredPhoneContactMatches(name, requireExact).firstOrNull()?.contact
    }

    private fun findScoredPhoneContactMatches(name: String, requireExact: Boolean): List<ScoredContactMatch> {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
            return emptyList()
        }
        val variants = buildContactLookupVariants(name)
        if (variants.isEmpty()) return emptyList()

        val contacts = readPhoneContacts()
        val exactMatch = contacts.firstOrNull { contact ->
            val display = normalizeContactLookupText(contact.displayName)
            display.isNotBlank() && variants.any { it == display || normalizeCompactContactText(it) == normalizeCompactContactText(display) }
        }
        if (exactMatch != null) return listOf(ScoredContactMatch(exactMatch, 1000))
        if (requireExact) return emptyList()

        return contacts
            .mapNotNull { contact ->
                val display = normalizeContactLookupText(contact.displayName)
                val compactDisplay = normalizeCompactContactText(display)
                if (display.isBlank()) {
                    null
                } else {
                    val score = variants.maxOfOrNull { candidate ->
                        when {
                            display == candidate -> 1000
                            compactDisplay == normalizeCompactContactText(candidate) -> 950
                            display.contains(candidate) || candidate.contains(display) -> minOf(display.length, candidate.length) + 300
                            compactDisplay.contains(normalizeCompactContactText(candidate)) -> minOf(compactDisplay.length, candidate.length) + 250
                            hasStrongContactTokenOverlap(display, candidate) -> sharedContactTokenCount(display, candidate) * 100 + minOf(display.length, candidate.length)
                            else -> 0
                        }
                    } ?: 0
                    if (score > 0) ScoredContactMatch(contact, score) else null
                }
            }
            .sortedByDescending { it.score }
    }

    private fun buildReminderContactChoicePrompt(originalName: String, candidates: List<ContactMatch>): String {
        val names = candidates.mapIndexed { index, contact -> "${index + 1}. ${contact.displayName}" }.joinToString(", ")
        return getString(R.string.reminder_contact_choice_prompt, originalName, names)
    }

    private fun readPhoneContacts(): List<ContactMatch> {
        val cursor = contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            ),
            null,
            null,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
        ) ?: return emptyList()
        val contacts = mutableListOf<ContactMatch>()
        cursor.use {
            while (it.moveToNext()) {
                val displayName = it.getString(0) ?: continue
                val number = it.getString(1) ?: continue
                contacts += ContactMatch(displayName = displayName, value = number)
            }
        }
        return contacts
    }

    private fun buildContactLookupVariants(name: String): List<String> {
        val variants = linkedSetOf<String>()
        val original = name.trim()
        if (original.isBlank()) return emptyList()
        val aliasResolved = resolveContactAlias(original)
        listOf(original, aliasResolved).forEach { raw ->
            val normalized = normalizeContactLookupText(raw)
            if (normalized.isNotBlank()) {
                variants += normalized
                variants += normalized.replace(" ", "")
                val dePossessive = normalized.replace(Regex("\\b('s|s')\\b"), "").trim()
                if (dePossessive.isNotBlank()) variants += dePossessive
            }
        }
        return variants.filter { it.isNotBlank() }
    }

    private fun normalizeContactLookupText(value: String): String {
        return value
            .trim()
            .lowercase(Locale.US)
            .replace("&", " and ")
            .replace(Regex("[^a-z0-9 ]"), " ")
            .replace(Regex("\\b(?:my|the|a|an|please|for me|call|text|message|email|to)\\b"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun normalizeCompactContactText(value: String): String =
        normalizeContactLookupText(value).replace(" ", "")

    private fun sharedContactTokenCount(left: String, right: String): Int {
        val leftTokens = left.split(" ").filter { it.length > 1 }.toSet()
        val rightTokens = right.split(" ").filter { it.length > 1 }.toSet()
        return leftTokens.intersect(rightTokens).size
    }

    private fun hasStrongContactTokenOverlap(left: String, right: String): Boolean {
        val shared = sharedContactTokenCount(left, right)
        return shared >= 2 || (shared == 1 && (left.contains(" ") || right.contains(" ")))
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
                appendActivityLog("Call", "$event ($caller)")
            }.onFailure { error ->
                binding.callMonitorStatus.text = error.message ?: getString(R.string.call_monitor_waiting)
                appendActivityLog("Call", error.message ?: getString(R.string.call_monitor_waiting))
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
        refreshInteractionStates()
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
        const val KEY_NOTIFICATIONS_ENABLED = "notifications_enabled"
        const val KEY_AUTO_ANSWER_KNOWN_CONTACTS = "auto_answer_known_contacts"
        const val KEY_AUTO_ANSWER_ANY_NON_SPAM = "auto_answer_any_non_spam"
        const val KEY_AUTO_DECLINE_SPAM = "auto_decline_spam"
        const val KEY_APP_IN_FOREGROUND = "app_in_foreground"
        const val KEY_PENDING_INCOMING_SMS_SENDER = "pending_incoming_sms_sender"
        const val KEY_PENDING_INCOMING_SMS_VALUE = "pending_incoming_sms_value"
        const val KEY_PENDING_INCOMING_SMS_BODY = "pending_incoming_sms_body"
        const val KEY_PENDING_NOTIFICATION_APP = "pending_notification_app"
        const val KEY_PENDING_NOTIFICATION_TITLE = "pending_notification_title"
        const val KEY_PENDING_NOTIFICATION_TEXT = "pending_notification_text"
        const val KEY_ACTIVITY_LOG = "activity_log"
        const val KEY_CALL_MESSAGE_LOG = "call_message_log"
        const val KEY_LAST_SMS_EVENT_SIGNATURE = "last_sms_event_signature"
        const val KEY_LAST_SMS_EVENT_AT = "last_sms_event_at"
        const val KEY_EMERGENCY_PROFILE_NAME = "emergency_profile_name"
        const val KEY_EMERGENCY_PROFILE_BIRTHDAY = "emergency_profile_birthday"
        const val KEY_EMERGENCY_CONTACT = "emergency_contact"
        const val KEY_EMERGENCY_CONTACT_PERMISSION = "emergency_contact_permission"
        const val KEY_SAFETY_COMFORT_STYLE = "safety_comfort_style"
        const val KEY_SAFETY_GROUNDING_STYLE = "safety_grounding_style"
        const val KEY_SAFETY_FOLLOW_UP_OPT_IN = "safety_follow_up_opt_in"
        const val KEY_LAST_SAFETY_MOOD = "last_safety_mood"
        const val KEY_LAST_SAFETY_CHOICE = "last_safety_choice"
        const val KEY_LAST_SAFETY_CHECK_IN_AT = "last_safety_check_in_at"
        const val KEY_LOCAL_RELATIONSHIP_ALIASES = "local_relationship_aliases"
        const val KEY_CONTACT_ACTION_PREFERENCES = "contact_action_preferences"
        const val KEY_VOSK_MODEL_ASSET = "vosk_model_asset"
        const val KEY_VOSK_WAKE_PHRASE = "vosk_wake_phrase"
        const val KEY_LEARNING_REMINDER_ENABLED = "learning_reminder_enabled"
        const val KEY_LEARNING_REMINDER_TIME = "learning_reminder_time"
        const val KEY_LEARNING_REMINDER_TITLE = "learning_reminder_title"
        const val KEY_LEARNING_REMINDER_TEXT = "learning_reminder_text"
        private const val RECENT_CALL_REMINDER_GUARD_MS = 8000L
        private const val SAFETY_MOOD_NONE = "none"
        private const val SAFETY_MOOD_GENERAL = "general"
        private const val SAFETY_MOOD_STRESS = "stress"
        private const val SAFETY_MOOD_SADNESS = "sadness"
        private const val SAFETY_MOOD_ANGER = "anger"
        private const val SAFETY_MOOD_CRISIS = "crisis"
        const val KEY_THEME_PRESET = "theme_preset"
        const val KEY_HOME_TITLE = "home_title"
        const val KEY_HOME_SUBTITLE = "home_subtitle"
        const val KEY_ACCENT_COLOR = "accent_color"
        const val KEY_BACKGROUND_COLOR = "background_color"
        const val KEY_PANEL_COLOR = "panel_color"
        const val KEY_HOME_BACKGROUND_URI = "home_background_uri"
        const val KEY_HOME_LEFT_STICKER_URI = "home_left_sticker_uri"
        const val KEY_HOME_RIGHT_STICKER_URI = "home_right_sticker_uri"
        const val KEY_DEX_COMPANION_VISIBLE = "dex_companion_visible"
        const val KEY_DEX_COMPANION_MOOD = "dex_companion_mood"
        const val KEY_DEX_COMPANION_SIZE = "dex_companion_size"
        const val KEY_DEX_COMPANION_SIDE = "dex_companion_side"
        const val KEY_DEX_COMPANION_FACE_STYLE = "dex_companion_face_style"
        const val KEY_DEX_COMPANION_BUBBLE_STYLE = "dex_companion_bubble_style"
        const val KEY_DEX_COMPANION_SKIN = "dex_companion_skin"
        const val KEY_DEX_COMPANION_ACCESSORY = "dex_companion_accessory"
        const val KEY_DEX_COMPANION_NAME = "dex_companion_name"
        const val KEY_DEX_COMPANION_VOICE = "dex_companion_voice"
        const val KEY_DEX_COMPANION_PERSONALITY = "dex_companion_personality"
        const val KEY_DEX_COMPANION_INTRO_DISMISSED = "dex_companion_intro_dismissed"
        const val KEY_DEX_COMPANION_INTRO_GREETED = "dex_companion_intro_greeted"
        const val KEY_DEX_COMPANION_OFFSET_X = "dex_companion_offset_x"
        const val KEY_DEX_COMPANION_OFFSET_Y = "dex_companion_offset_y"
        const val KEY_DEX_COMPANION_TIER_STYLE_OVERRIDE = "dex_companion_tier_style_override"
        const val KEY_DEX_GAMES_PLAYED = "dex_games_played"
        const val KEY_DEX_GAMES_CORRECT = "dex_games_correct"
        const val KEY_DEX_GAMES_STREAK = "dex_games_streak"
        const val KEY_DEX_GAMES_BEST_STREAK = "dex_games_best_streak"
        const val KEY_DEX_GAMES_GUESS_PLAYS = "dex_games_guess_plays"
        const val KEY_DEX_GAMES_RIDDLE_PLAYS = "dex_games_riddle_plays"
        const val KEY_DEX_GAMES_TRIVIA_PLAYS = "dex_games_trivia_plays"
        const val KEY_DEX_GAMES_MEMORY_PLAYS = "dex_games_memory_plays"
        const val KEY_DEX_GAMES_WYR_PLAYS = "dex_games_wyr_plays"
        const val KEY_DEX_GAMES_CHALLENGE_DONE_DATE = "dex_games_challenge_done_date"
        const val KEY_DEX_GAMES_CHALLENGE_CLEARS = "dex_games_challenge_clears"
        const val KEY_DEX_COINS = "dex_coins"
        const val KEY_DEX_COMPANION_OWNED_COSMETICS = "dex_companion_owned_cosmetics"
        const val KEY_DASHBOARD_SECTIONS = "dashboard_sections"
        const val ACTION_LOCAL_EMERGENCY_SMS_SENT = "com.konvictartz.dex.LOCAL_EMERGENCY_SMS_SENT"
        const val ACTION_LOCAL_EMERGENCY_SMS_DELIVERED = "com.konvictartz.dex.LOCAL_EMERGENCY_SMS_DELIVERED"
        const val EXTRA_SMS_TOKEN = "sms_token"
        const val EXTRA_ASSISTANT_SURFACE = "assistant_surface"
        const val EXTRA_ASSISTANT_CALLER = "assistant_caller"
        const val DEFAULT_SERVER_URL = "https://konvict-artz.onrender.com/api"
        const val DEFAULT_VOSK_MODEL_ASSET = "model-en-us"
        const val DEFAULT_VOSK_WAKE_PHRASE = "hey dex"
        const val ASSISTANT_SURFACE_WAKE = "wake"
        const val ASSISTANT_SURFACE_CALL = "call"
        private const val DEFAULT_ACCENT_COLOR = "#69C6FF"
        private const val DEFAULT_BACKGROUND_COLOR = "#0F172A"
        private const val DEFAULT_PANEL_COLOR = "#182131"
        private const val DEX_TTS_CONVERSATION_RATE = 0.88f
        private const val DEX_TTS_SAFETY_RATE = 0.82f
        private const val DEX_TTS_CRISIS_RATE = 0.74f
        private const val DEX_TTS_TEACHING_RATE = 0.74f
        private const val DEX_TTS_PRONUNCIATION_RATE = 0.55f
        private const val DEX_TTS_PITCH = 0.95f
        private const val DEX_TTS_SAFETY_PITCH = 0.93f
        private const val DEX_TTS_CRISIS_PITCH = 0.9f
        private const val SAFETY_PAUSE_MS = 800L
        private const val CRISIS_PAUSE_MS = 1150L
        private const val TEACHING_PAUSE_MS = 650L
        private const val PRONUNCIATION_PAUSE_MS = 950L
        private const val MAX_DASHBOARD_SECTIONS = 8
        private const val THEME_OCEAN = "ocean"
        private const val THEME_SUNSET = "sunset"
        private const val THEME_STUDIO = "studio"
        private const val DEX_COMPANION_MOOD_CALM = "calm"
        private const val DEX_COMPANION_MOOD_PLAYFUL = "playful"
        private const val DEX_COMPANION_MOOD_FOCUS = "focus"
        private const val DEX_COMPANION_SIZE_SMALL = "small"
        private const val DEX_COMPANION_SIZE_MEDIUM = "medium"
        private const val DEX_COMPANION_SIZE_LARGE = "large"
        private const val DEX_COMPANION_SIDE_LEFT = "left"
        private const val DEX_COMPANION_SIDE_RIGHT = "right"
        private const val DEX_COMPANION_FACE_CLASSIC = "classic"
        private const val DEX_COMPANION_FACE_WINK = "wink"
        private const val DEX_COMPANION_FACE_PIXEL = "pixel"
        private const val DEX_COMPANION_BUBBLE_SOFT = "soft"
        private const val DEX_COMPANION_BUBBLE_GLOW = "glow"
        private const val DEX_COMPANION_BUBBLE_BOLD = "bold"
        private const val DEX_COMPANION_SKIN_SKY = "sky"
        private const val DEX_COMPANION_SKIN_MINT = "mint"
        private const val DEX_COMPANION_SKIN_SUNSET = "sunset"
        private const val DEX_COMPANION_SKIN_VIOLET = "violet"
        private const val DEX_COMPANION_ACCESSORY_NONE = "none"
        private const val DEX_COMPANION_ACCESSORY_HEADPHONES = "headphones"
        private const val DEX_COMPANION_ACCESSORY_GLASSES = "glasses"
        private const val DEX_COMPANION_ACCESSORY_HALO = "halo"
        private const val DEX_COMPANION_VOICE_SUPPORTIVE = "supportive"
        private const val DEX_COMPANION_VOICE_PLAYFUL = "playful"
        private const val DEX_COMPANION_VOICE_DIRECT = "direct"
        private const val DEX_COMPANION_PERSONALITY_COACH = "coach"
        private const val DEX_COMPANION_PERSONALITY_BESTIE = "bestie"
        private const val DEX_COMPANION_PERSONALITY_GUARDIAN = "guardian"
        private const val DEX_COMPANION_PERSONALITY_STUDY_BUDDY = "study_buddy"
        private const val DEX_COMPANION_DOUBLE_TAP_WINDOW_MS = 260L
        private const val DEX_COMPANION_LONG_PRESS_MS = 420L
        private const val DEX_COMPANION_STATE_IDLE = "idle"
        private const val DEX_COMPANION_STATE_SLEEPING = "sleeping"
        private const val DEX_COMPANION_STATE_LISTENING = "listening"
        private const val DEX_COMPANION_STATE_THINKING = "thinking"
        private const val DEX_COMPANION_STATE_EXCITED = "excited"
        private const val DEX_COMPANION_STATE_TALKING = "talking"
        private const val DEX_COMPANION_STATE_PENDING = "pending"
        private const val DEX_COMPANION_STATE_ALERT = "alert"
        private val DEX_RIDDLES = listOf(
            DexRiddle("What has to be broken before you can use it?", "egg"),
            DexRiddle("What gets wetter the more it dries?", "towel"),
            DexRiddle("What has hands but can not clap?", "clock"),
            DexRiddle("What has a face and two hands but no arms or legs?", "clock"),
        )
        private val DEX_TRIVIA_QUESTIONS = listOf(
            DexTrivia(
                "Trivia time. What planet is known as the Red Planet?",
                listOf("mars"),
                "Mars is the Red Planet."
            ),
            DexTrivia(
                "What is the largest ocean on Earth?",
                listOf("pacific", "pacific ocean"),
                "The Pacific Ocean is the largest."
            ),
            DexTrivia(
                "How many sides does a hexagon have?",
                listOf("6", "six"),
                "A hexagon has six sides."
            ),
            DexTrivia(
                "What animal is known for carrying its home on its back?",
                listOf("snail", "a snail"),
                "A snail carries its shell like a home."
            ),
        )
        private val DEX_MEMORY_TOKENS = listOf(
            "moon",
            "star",
            "cloud",
            "river",
            "peach",
            "drum",
            "candle",
            "leaf"
        )
        private val DEX_WOULD_YOU_RATHERS = listOf(
            DexWouldYouRather(
                "Would you rather explore space for a week or the deep ocean for a week?",
                "That says a lot about your vibe."
            ),
            DexWouldYouRather(
                "Would you rather always have the perfect playlist or always know the best food spot nearby?",
                "Honestly, Dex can work with either answer."
            ),
            DexWouldYouRather(
                "Would you rather have one extra day every weekend or one extra hour every morning?",
                "That is a strong life choice."
            ),
            DexWouldYouRather(
                "Would you rather be amazing at every game night or every karaoke night?",
                "I respect that answer."
            ),
        )
        private val WAKE_WORD_VARIANTS = listOf(
            "hey dex",
            "hey decks",
            "hey deks",
            "hey dix",
            "hey dicks",
            "hey dick's"
        )
        private const val CONVERSATION_TIMEOUT_MS = 45_000L
        private const val DEX_CHAT_DUPLICATE_GUARD_MS = 4_000L
        private const val LOCAL_EMERGENCY_SMS_COOLDOWN_MS = 5 * 60 * 1000L
        private const val LOCAL_EMERGENCY_SMS_DELIVERY_TIMEOUT_MS = 90_000L
        private const val MAX_CALL_ANSWER_RETRIES = 2
        private const val CALL_ANSWER_RETRY_DELAY_MS = 350L
        private const val CALL_COMMAND_RETRY_DELAY_MS = 400L
        private const val CALL_COMMAND_PROMPT_GUARD_DELAY_MS = 900L
        private const val DEX_SPEECH_ECHO_GUARD_MS = 8000L
        private const val WAKE_LISTEN_MIN_GAP_MS = 3500L

        fun appendPersistentActivityLog(context: Context, category: String, detail: String) {
            val time = LocalTime.now().format(DateTimeFormatter.ofPattern("h:mm a", Locale.US))
            val entry = "[$time] $category: $detail"
            val entries = ArrayDeque(readPersistentActivityLog(context))
            entries.addFirst(entry)
            while (entries.size > 8) {
                entries.removeLast()
            }
            val payload = JSONArray().apply {
                entries.forEach { put(it) }
            }
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_ACTIVITY_LOG, payload.toString())
                .apply()
        }

        fun readPersistentActivityLog(context: Context): List<String> {
            val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_ACTIVITY_LOG, null)
                .orEmpty()
            if (raw.isBlank()) return emptyList()
            return runCatching {
                val entries = JSONArray(raw)
                buildList {
                    for (index in 0 until entries.length()) {
                        val entry = entries.optString(index).trim()
                        if (entry.isNotBlank()) add(entry)
                    }
                }
            }.getOrElse { emptyList() }
        }

        fun appendPersistentCallMessageLog(context: Context, caller: String, phoneNumber: String?, message: String) {
            val safeCaller = caller.trim().ifBlank { context.getString(R.string.unknown_number_label) }
            val safeMessage = message.trim()
            if (safeMessage.isBlank()) return
            val time = LocalTime.now().format(DateTimeFormatter.ofPattern("h:mm a", Locale.US))
            val entries = ArrayDeque(readPersistentCallMessageRecords(context))
            entries.addFirst(
                SavedCallMessage(
                    callerLabel = safeCaller,
                    phoneNumber = phoneNumber?.trim()?.takeIf { it.isNotBlank() },
                    message = safeMessage,
                    timeLabel = time
                )
            )
            while (entries.size > 6) {
                entries.removeLast()
            }
            val payload = JSONArray().apply {
                entries.forEach { entry ->
                    put(
                        JSONObject().apply {
                            put("caller", entry.callerLabel)
                            put("phoneNumber", entry.phoneNumber ?: "")
                            put("message", entry.message)
                            put("time", entry.timeLabel)
                        }
                    )
                }
            }
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_CALL_MESSAGE_LOG, payload.toString())
                .apply()
        }

        fun readPersistentCallMessageLog(context: Context): List<String> {
            return readPersistentCallMessageRecords(context).map {
                "[${it.timeLabel}] " + if (it.handled) {
                    context.getString(
                        R.string.call_message_log_entry_handled,
                        it.callerLabel,
                        it.message,
                        context.getString(R.string.call_message_handled_label)
                    )
                } else {
                    context.getString(R.string.call_message_log_entry, it.callerLabel, it.message)
                }
            }
        }

        fun readLatestPersistentCallMessage(context: Context): SavedCallMessage? =
            readPersistentCallMessageRecords(context).firstOrNull()

        fun readPersistentCallMessageRecords(context: Context): List<SavedCallMessage> {
            val raw = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .getString(KEY_CALL_MESSAGE_LOG, null)
                .orEmpty()
            if (raw.isBlank()) return emptyList()
            return runCatching {
                val entries = JSONArray(raw)
                buildList {
                    for (index in 0 until entries.length()) {
                        val item = entries.opt(index)
                        when (item) {
                            is JSONObject -> {
                                val caller = item.optString("caller").trim()
                                    .ifBlank { context.getString(R.string.unknown_number_label) }
                                val message = item.optString("message").trim()
                                val time = item.optString("time").trim()
                                if (message.isNotBlank() && time.isNotBlank()) {
                                    add(
                                        SavedCallMessage(
                                            callerLabel = caller,
                                            phoneNumber = item.optString("phoneNumber").trim().ifBlank { null },
                                            message = message,
                                            timeLabel = time,
                                            handled = item.optBoolean("handled", false)
                                        )
                                    )
                                }
                            }
                            is String -> {
                                val legacy = item.trim()
                                if (legacy.isNotBlank()) {
                                    add(
                                        SavedCallMessage(
                                            callerLabel = context.getString(R.string.unknown_number_label),
                                            phoneNumber = null,
                                            message = legacy,
                                            timeLabel = "--",
                                            handled = false
                                        )
                                    )
                                }
                            }
                        }
                    }
                }.sortedBy { it.handled }
            }.getOrElse { emptyList() }
        }
    }
}
