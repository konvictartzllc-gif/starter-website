package com.konvictartz.dex

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.provider.ContactsContract
import android.provider.Telephony
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.telephony.SmsManager
import android.telecom.TelecomManager
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.Locale

private enum class BackgroundListenMode {
    GENERAL_COMMAND,
    CALL_COMMAND,
    SMS_COMMAND,
    SMS_REPLY,
    NOTIFICATION_COMMAND,
    SAFETY_CHECK_IN,
    CALLER_MESSAGE,
    REMINDER_CHECK_IN,
}

class DexForegroundService : Service(), TextToSpeech.OnInitListener {
    private val client = OkHttpClient()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private var telephonyManager: TelephonyManager? = null
    private var telecomManager: TelecomManager? = null
    private var audioManager: AudioManager? = null
    private var callStateCallback: DexCallStateCallback? = null
    @Suppress("DEPRECATION")
    private var legacyPhoneStateListener: LegacyCallStateListener? = null
    private var textToSpeech: TextToSpeech? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var ttsReady = false
    private var lastCallState = TelephonyManager.CALL_STATE_IDLE
    private var lastCaller = "Unknown caller"
    private var lastIncomingNumber: String? = null
    private var currentCallWasAnswered = false
    private var pendingSpeechText: String? = null
    private var pendingListenMode: BackgroundListenMode? = null
    private var activeListenMode: BackgroundListenMode? = null
    private var awaitingSmsReplyChoice = false
    private var pendingReminderTitle: String? = null
    private var pendingReminderText: String? = null
    private var pendingReminderCallTarget: String? = null
    private var pendingReminderTextTarget: String? = null
    private var pendingReminderTextBody: String? = null
    private var pendingSafetyTitle: String? = null
    private var pendingSafetyText: String? = null
    private var pendingSafetyMood: String? = null
    private var pendingSafetyEmergency = false
    private var safetyCheckInAttempts = 0
    private var backgroundRecognizerRecoveryAttempts = 0
    private var wakeWordEngine: DexWakeWordEngine? = null
    private var autoTakeMessageRunnable: Runnable? = null
    private var callMessageCaptureAttempts = 0
    private var notificationCommandAttempts = 0
    private var callScreeningPhraseIndex = 0
    private val mainHandler = Handler(Looper.getMainLooper())

    private data class ParsedCallerMessage(
        val callerName: String?,
        val message: String,
    )

    private data class SafetyPromptProfile(
        val title: String,
        val message: String,
        val mood: String,
        val emergency: Boolean,
    )

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

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
        telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        telecomManager = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
        audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        textToSpeech = TextToSpeech(this, this)
        textToSpeech?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) = Unit

            override fun onDone(utteranceId: String?) {
                mainHandler.post { startPendingBackgroundListening() }
            }

            @Suppress("OVERRIDE_DEPRECATION")
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                mainHandler.post { startPendingBackgroundListening() }
            }
        })
        setupSpeechRecognizer()
        wakeWordEngine = DexWakeWordEngine(
            this,
            onWakeWordDetected = { handleBackgroundWakeWordDetected() },
            onWakeWordError = { _ -> stopBackgroundWakeWordListening() }
        )
        startCallMonitoringIfReady()
        refreshWakeWordBackgroundState()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification())
        when (intent?.action) {
            ACTION_ANNOUNCE_SMS -> handleIncomingSms(intent)
            ACTION_ANNOUNCE_NOTIFICATION -> handleIncomingNotification(intent)
            ACTION_SAFETY_CHECK_IN -> handleSafetyCheckIn(intent)
            ACTION_REMINDER_CHECK_IN -> handleReminderCheckIn(intent)
            ACTION_CALL_ANSWER -> handleCallAnswerAction()
            ACTION_CALL_DECLINE -> handleCallDeclineAction()
            ACTION_CALL_TAKE_MESSAGE -> handleCallTakeMessageAction()
            ACTION_SMS_READ -> handleSmsReadAction()
            ACTION_SMS_IGNORE -> handleSmsIgnoreAction()
            ACTION_SMS_REPLY -> handleSmsReplyAction(intent)
            ACTION_NOTIFICATION_READ -> handleNotificationReadAction()
            ACTION_NOTIFICATION_IGNORE -> handleNotificationIgnoreAction()
        }
        startCallMonitoringIfReady()
        refreshWakeWordBackgroundState()
        return START_STICKY
    }

    override fun onDestroy() {
        val shouldRestart = shouldKeepServiceAlive()
        clearPendingAutoTakeMessage()
        stopCallMonitoring()
        stopBackgroundWakeWordListening()
        speechRecognizer?.destroy()
        textToSpeech?.stop()
        textToSpeech?.shutdown()
        super.onDestroy()
        if (shouldRestart) {
            ContextCompat.startForegroundService(this, Intent(this, DexForegroundService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        if (shouldKeepServiceAlive()) {
            ContextCompat.startForegroundService(this, Intent(this, DexForegroundService::class.java))
        }
    }

    private fun setupSpeechRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) return
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(this).apply {
            setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) = Unit
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
                override fun onPartialResults(partialResults: Bundle?) = Unit

                override fun onError(error: Int) {
                    val mode = activeListenMode
                    activeListenMode = null
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        backgroundRecognizerRecoveryAttempts = 0
                        repromptBackgroundListenMode(mode)
                    } else {
                        logBackgroundRecognizerEvent(
                            "${mode?.diagnosticLabel() ?: "background listening"} hit ${backgroundSpeechErrorLabel(error)}"
                        )
                        recoverBackgroundRecognizer(mode)
                    }
                }

                override fun onResults(results: Bundle?) {
                    val mode = activeListenMode
                    activeListenMode = null
                    backgroundRecognizerRecoveryAttempts = 0
                    val transcripts = results
                        ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        .orEmpty()
                    handleBackgroundVoiceMatches(mode, transcripts)
                }
            })
        }
    }

    private fun recreateSpeechRecognizer() {
        runCatching { speechRecognizer?.destroy() }
        speechRecognizer = null
        setupSpeechRecognizer()
    }

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) {
            ttsReady = false
            return
        }
        textToSpeech?.setSpeechRate(DEX_TTS_BACKGROUND_RATE)
        textToSpeech?.setPitch(DEX_TTS_PITCH)
        val languageResult = textToSpeech?.setLanguage(Locale.US) ?: TextToSpeech.ERROR
        ttsReady = languageResult != TextToSpeech.LANG_MISSING_DATA &&
            languageResult != TextToSpeech.LANG_NOT_SUPPORTED &&
            languageResult != TextToSpeech.ERROR
        if (ttsReady) {
            pendingSpeechText?.let { queued ->
                pendingSpeechText = null
                speakNow(queued)
            }
        }
    }

    private fun buildNotification(): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_def_app_icon)
            .setContentTitle(getString(R.string.background_service_title))
            .setContentText(getString(R.string.background_service_summary))
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val serviceChannel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.background_service_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.background_service_channel_description)
            setShowBadge(false)
        }
        val actionChannel = NotificationChannel(
            ACTION_CHANNEL_ID,
            getString(R.string.background_actions_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = getString(R.string.background_actions_channel_description)
            setShowBadge(true)
        }
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(serviceChannel)
        manager.createNotificationChannel(actionChannel)
    }

    private fun startCallMonitoringIfReady() {
        if (shouldMonitorCalls()) {
            startCallMonitoring()
        } else {
            stopCallMonitoring()
        }
    }

    private fun shouldMonitorCalls(): Boolean {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val phoneBackendEnabled = prefs.getBoolean(MainActivity.KEY_PHONE_BACKEND_ENABLED, false)
        val hasToken = !prefs.getString(MainActivity.KEY_TOKEN, null).isNullOrBlank()
        val appInForeground = prefs.getBoolean(MainActivity.KEY_APP_IN_FOREGROUND, false)
        return hasToken &&
            !appInForeground &&
            phoneBackendEnabled &&
            hasPermission(Manifest.permission.READ_PHONE_STATE) &&
            hasPermission(Manifest.permission.READ_CALL_LOG) &&
            hasPermission(Manifest.permission.ANSWER_PHONE_CALLS)
    }

    private fun shouldRunBackgroundWakeWord(): Boolean {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val hasToken = !prefs.getString(MainActivity.KEY_TOKEN, null).isNullOrBlank()
        val appInForeground = prefs.getBoolean(MainActivity.KEY_APP_IN_FOREGROUND, false)
        val modelAsset = prefs.getString(MainActivity.KEY_VOSK_MODEL_ASSET, MainActivity.DEFAULT_VOSK_MODEL_ASSET).orEmpty().trim()
        val wakePhrase = prefs.getString(MainActivity.KEY_VOSK_WAKE_PHRASE, MainActivity.DEFAULT_VOSK_WAKE_PHRASE).orEmpty().trim()
        return hasToken &&
            !appInForeground &&
            modelAsset.isNotBlank() &&
            wakePhrase.isNotBlank() &&
            hasPermission(Manifest.permission.RECORD_AUDIO)
    }

    private fun refreshWakeWordBackgroundState() {
        if (shouldRunBackgroundWakeWord()) {
            wakeWordEngine?.start()
        } else {
            stopBackgroundWakeWordListening()
        }
    }

    private fun stopBackgroundWakeWordListening() {
        wakeWordEngine?.stop()
    }

    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    }

    private fun shouldKeepServiceAlive(): Boolean {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val backgroundEnabled = prefs.getBoolean(MainActivity.KEY_BACKGROUND_SERVICE_ENABLED, false)
        val hasToken = !prefs.getString(MainActivity.KEY_TOKEN, null).isNullOrBlank()
        val notificationsEnabled = prefs.getBoolean(MainActivity.KEY_NOTIFICATIONS_ENABLED, false)
        val phoneBackendEnabled = prefs.getBoolean(MainActivity.KEY_PHONE_BACKEND_ENABLED, false)
        val appInForeground = prefs.getBoolean(MainActivity.KEY_APP_IN_FOREGROUND, false)
        val wakeReady =
            hasToken &&
                !prefs.getString(MainActivity.KEY_VOSK_MODEL_ASSET, MainActivity.DEFAULT_VOSK_MODEL_ASSET).isNullOrBlank() &&
                !prefs.getString(MainActivity.KEY_VOSK_WAKE_PHRASE, MainActivity.DEFAULT_VOSK_WAKE_PHRASE).isNullOrBlank() &&
                hasPermission(Manifest.permission.RECORD_AUDIO)
        val phoneReady =
            hasToken &&
                phoneBackendEnabled &&
                hasPermission(Manifest.permission.READ_PHONE_STATE) &&
                hasPermission(Manifest.permission.READ_CALL_LOG) &&
                hasPermission(Manifest.permission.ANSWER_PHONE_CALLS)
        val smsReady =
            hasToken &&
                notificationsEnabled &&
                hasPermission(Manifest.permission.RECEIVE_SMS) &&
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    hasPermission(Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    true
                }
        return backgroundEnabled && !appInForeground && (wakeReady || phoneReady || smsReady)
    }

    @SuppressLint("MissingPermission")
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
        currentCallWasAnswered = false
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
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(MainActivity.KEY_APP_IN_FOREGROUND, false)) {
            clearPendingAutoTakeMessage()
            lastCallState = state
            return
        }
        val rawNumber = phoneNumber?.trim().orEmpty()
        val resolvedCaller = resolveCallerLabel(phoneNumber)
        val autoDeclineSpam = prefs.getBoolean(MainActivity.KEY_AUTO_DECLINE_SPAM, true)
        when (state) {
            TelephonyManager.CALL_STATE_RINGING -> {
                clearPendingAutoTakeMessage()
                callMessageCaptureAttempts = 0
                currentCallWasAnswered = false
                lastIncomingNumber = rawNumber.ifBlank { null }
                lastCaller = resolvedCaller
                if (autoDeclineSpam && isLikelySpamCaller(resolvedCaller, phoneNumber)) {
                    postCallEvent("declined", resolvedCaller)
                    declineRingingCall()
                    speakShortStatus(getString(R.string.call_spam_blocked))
                } else {
                    postCallEvent("incoming", resolvedCaller)
                    showIncomingCallNotification(resolvedCaller)
                    if (!scheduleAutoTakeMessageIfNeeded(prefs, rawNumber, resolvedCaller)) {
                        speakIncomingCallPrompt(resolvedCaller)
                    }
                }
            }
            TelephonyManager.CALL_STATE_OFFHOOK -> {
                clearPendingAutoTakeMessage()
                currentCallWasAnswered = true
                dismissNotification(CALL_NOTIFICATION_ID)
                if (lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                    postCallEvent("answered", resolvedCaller)
                }
            }
            TelephonyManager.CALL_STATE_IDLE -> {
                clearPendingAutoTakeMessage()
                callMessageCaptureAttempts = 0
                dismissNotification(CALL_NOTIFICATION_ID)
                if (lastCallState == TelephonyManager.CALL_STATE_RINGING && !currentCallWasAnswered) {
                    postCallEvent("declined", resolvedCaller)
                }
                lastCaller = "Unknown caller"
                lastIncomingNumber = null
                currentCallWasAnswered = false
            }
        }
        lastCallState = state
    }

    private fun handleBackgroundWakeWordDetected() {
        if (isAppInForeground()) {
            launchWakeAssistantSurface()
            return
        }
        activeListenMode = null
        pendingListenMode = null
        speakAndThenListen(getString(R.string.wake_mode_detected), BackgroundListenMode.GENERAL_COMMAND)
    }

    private fun launchWakeAssistantSurface() {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(MainActivity.EXTRA_ASSISTANT_SURFACE, MainActivity.ASSISTANT_SURFACE_WAKE)
        }
        startActivity(intent)
    }

    private fun resolveCallerLabel(phoneNumber: String?): String {
        val rawNumber = phoneNumber?.trim().orEmpty()
        if (rawNumber.isBlank()) {
            return lastCaller.takeUnless { it.isBlank() || it == "Unknown caller" } ?: getString(R.string.private_number_label)
        }
        val contactName = lookupContactName(rawNumber)
        return contactName ?: rawNumber
    }

    private fun scheduleAutoTakeMessageIfNeeded(
        prefs: android.content.SharedPreferences,
        rawNumber: String,
        resolvedCaller: String
    ): Boolean {
        val autoKnownContacts = prefs.getBoolean(MainActivity.KEY_AUTO_ANSWER_KNOWN_CONTACTS, false)
        val autoAnyNonSpam = prefs.getBoolean(MainActivity.KEY_AUTO_ANSWER_ANY_NON_SPAM, false)
        if (!autoKnownContacts && !autoAnyNonSpam) return false

        val knownContact = rawNumber.isNotBlank() && lookupContactName(rawNumber) != null
        val shouldAutoTakeMessage =
            (autoKnownContacts && knownContact) || (autoAnyNonSpam && rawNumber.isNotBlank())
        if (!shouldAutoTakeMessage) return false

        val detail =
            if (knownContact) {
                getString(R.string.call_auto_take_message_known_contact, resolvedCaller)
            } else {
                getString(R.string.call_auto_take_message_any, resolvedCaller)
            }
        MainActivity.appendPersistentActivityLog(this, "Call", detail)

        autoTakeMessageRunnable = Runnable {
            autoTakeMessageRunnable = null
            if (lastCallState != TelephonyManager.CALL_STATE_RINGING || currentCallWasAnswered) return@Runnable
            handleCallTakeMessageAction()
        }
        mainHandler.postDelayed(autoTakeMessageRunnable!!, AUTO_TAKE_MESSAGE_DELAY_MS)
        return true
    }

    private fun clearPendingAutoTakeMessage() {
        autoTakeMessageRunnable?.let(mainHandler::removeCallbacks)
        autoTakeMessageRunnable = null
    }

    private fun lookupContactName(phoneNumber: String): String? {
        if (!hasPermission(Manifest.permission.READ_CONTACTS)) return null
        val projection = arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME)
        val digits = phoneNumber.filter { it.isDigit() }
        val candidates = linkedSetOf(
            phoneNumber,
            phoneNumber.filter { it.isDigit() || it == '+' },
            digits,
            if (digits.length == 10) "+1$digits" else "",
            if (digits.length == 11 && digits.startsWith("1")) "+$digits" else "",
            if (digits.length > 10) digits.takeLast(10) else ""
        )
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
        return rawNumber.startsWith("000")
    }

    private fun speakIncomingCallPrompt(caller: String) {
        val prompt = when (nextCallScreeningPhraseVariant()) {
            0 -> getString(R.string.call_background_prompt_template, caller)
            1 -> getString(R.string.call_background_prompt_template_alt_1, caller)
            else -> getString(R.string.call_background_prompt_template_alt_2, caller)
        }
        speakAndThenListen(prompt, BackgroundListenMode.CALL_COMMAND)
    }

    private fun handleIncomingSms(intent: Intent) {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(MainActivity.KEY_APP_IN_FOREGROUND, false)) return
        val hasToken = !prefs.getString(MainActivity.KEY_TOKEN, null).isNullOrBlank()
        val notificationsEnabled = prefs.getBoolean(MainActivity.KEY_NOTIFICATIONS_ENABLED, false)
        if (!hasToken || !notificationsEnabled) return

        val rawSender = intent.getStringExtra(EXTRA_SMS_SENDER).orEmpty().trim()
        val smsBody = intent.getStringExtra(EXTRA_SMS_BODY).orEmpty().trim()
        if (rawSender.isBlank() || smsBody.isBlank()) return

        val sender = resolveCallerLabel(rawSender)
        awaitingSmsReplyChoice = false
        prefs.edit()
            .putString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, sender)
            .putString(MainActivity.KEY_PENDING_INCOMING_SMS_VALUE, rawSender)
            .putString(MainActivity.KEY_PENDING_INCOMING_SMS_BODY, smsBody)
            .apply()

        showIncomingSmsNotification(sender, smsBody)
        mainHandler.postDelayed({
            speakAndThenListen(getString(R.string.incoming_sms_prompt, sender), BackgroundListenMode.SMS_COMMAND)
        }, 700L)
    }

    private fun handleIncomingNotification(intent: Intent) {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(MainActivity.KEY_APP_IN_FOREGROUND, false)) return
        val hasToken = !prefs.getString(MainActivity.KEY_TOKEN, null).isNullOrBlank()
        val notificationsEnabled = prefs.getBoolean(MainActivity.KEY_NOTIFICATIONS_ENABLED, false)
        if (!hasToken || !notificationsEnabled) return

        val appName = intent.getStringExtra(EXTRA_NOTIFICATION_APP).orEmpty().trim()
        val title = intent.getStringExtra(EXTRA_NOTIFICATION_TITLE).orEmpty().trim()
        val body = intent.getStringExtra(EXTRA_NOTIFICATION_TEXT).orEmpty().trim()
        if (appName.isBlank() || body.isBlank()) return

        if (isMessageNotification(appName, title)) {
            val sender = title.ifBlank { appName }
            val senderValue = findPhoneNumberByContactName(sender).orEmpty()
            awaitingSmsReplyChoice = false
            prefs.edit()
                .putString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, sender)
                .putString(MainActivity.KEY_PENDING_INCOMING_SMS_VALUE, senderValue)
                .putString(MainActivity.KEY_PENDING_INCOMING_SMS_BODY, body)
                .putString(MainActivity.KEY_PENDING_NOTIFICATION_APP, appName)
                .putString(MainActivity.KEY_PENDING_NOTIFICATION_TITLE, title)
                .putString(MainActivity.KEY_PENDING_NOTIFICATION_TEXT, body)
                .apply()

            showIncomingSmsNotification(sender, body)
            speakAndThenListen(getString(R.string.incoming_sms_prompt, sender), BackgroundListenMode.SMS_COMMAND)
            return
        }

        prefs.edit()
            .putString(MainActivity.KEY_PENDING_NOTIFICATION_APP, appName)
            .putString(MainActivity.KEY_PENDING_NOTIFICATION_TITLE, title)
            .putString(MainActivity.KEY_PENDING_NOTIFICATION_TEXT, body)
            .apply()

        showIncomingNotificationPrompt(appName, body)
        notificationCommandAttempts = 0
        speakAndThenListen(getString(R.string.notification_prompt, appName), BackgroundListenMode.NOTIFICATION_COMMAND)
    }

    private fun handleSafetyCheckIn(intent: Intent) {
        val title = intent.getStringExtra(DexSafetyCheckInScheduler.EXTRA_TITLE)
            ?: getString(R.string.safety_check_in_title)
        val text = intent.getStringExtra(DexSafetyCheckInScheduler.EXTRA_TEXT)
            ?: getString(R.string.safety_check_in_text)
        pendingSafetyTitle = title
        pendingSafetyText = text
        pendingSafetyMood = intent.getStringExtra(DexSafetyCheckInScheduler.EXTRA_MOOD).orEmpty().ifBlank { "general" }
        pendingSafetyEmergency = intent.getBooleanExtra(DexSafetyCheckInScheduler.EXTRA_IS_EMERGENCY, false)
        safetyCheckInAttempts = 0
        mainHandler.postDelayed({
            speakAndThenListen(buildSafetyCheckInPrompt(), BackgroundListenMode.SAFETY_CHECK_IN)
        }, 700L)
    }

    private fun handleReminderCheckIn(intent: Intent) {
        val title = intent.getStringExtra(DexLearningReminderScheduler.EXTRA_TITLE)
            ?: intent.getStringExtra(DexSafetyCheckInScheduler.EXTRA_TITLE)
            ?: getString(R.string.learning_reminder_title)
        val text = intent.getStringExtra(DexLearningReminderScheduler.EXTRA_TEXT)
            ?: intent.getStringExtra(DexSafetyCheckInScheduler.EXTRA_TEXT)
            ?: getString(R.string.learning_reminder_text)
        pendingReminderTitle = title
        pendingReminderText = text
        pendingReminderCallTarget = extractReminderCallTarget(title, text)
        val reminderTextDetails = extractReminderTextDetails(title, text)
        pendingReminderTextTarget = reminderTextDetails?.first
        pendingReminderTextBody = reminderTextDetails?.second
        mainHandler.postDelayed({
            speakAndThenListen(
                when {
                    pendingReminderCallTarget != null -> getString(R.string.call_reminder_check_in_prompt, pendingReminderCallTarget)
                    pendingReminderTextTarget != null && pendingReminderTextBody != null ->
                        getString(R.string.text_reminder_check_in_prompt, pendingReminderTextTarget, pendingReminderTextBody)
                    else -> getString(R.string.reminder_check_in_prompt, title, text)
                },
                BackgroundListenMode.REMINDER_CHECK_IN
            )
        }, 700L)
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun answerRingingCall(): Boolean {
        if (!hasPermission(Manifest.permission.ANSWER_PHONE_CALLS)) return false
        return try {
            val manager = telecomManager ?: return false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.acceptRingingCall()
                true
            } else {
                false
            }
        } catch (_: Exception) {
            // Some OEMs can still block background answering. We leave the call ringing if that happens.
            false
        }
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun declineRingingCall() {
        try {
            val manager = telecomManager ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                manager.endCall()
            }
        } catch (_: Exception) {
            // Ignore device-specific call ending failures in background mode.
        }
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun endCurrentCall() {
        try {
            val manager = telecomManager ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                manager.endCall()
            }
        } catch (_: Exception) {
            // Ignore device-specific call ending failures in background mode.
        }
    }

    private fun handleCallAnswerAction() {
        val answered = answerRingingCall()
        currentCallWasAnswered = answered
        dismissNotification(CALL_NOTIFICATION_ID)
        speakShortStatus(if (answered) getString(R.string.call_answered) else getString(R.string.call_answer_failed))
    }

    private fun handleCallDeclineAction() {
        declineRingingCall()
        dismissNotification(CALL_NOTIFICATION_ID)
        speakShortStatus(getString(R.string.call_declined))
    }

    private fun handleCallTakeMessageAction() {
        if (lastCallState != TelephonyManager.CALL_STATE_RINGING) {
            speakShortStatus(getString(R.string.call_message_unavailable))
            return
        }
        val answered = answerRingingCall()
        if (!answered) {
            speakShortStatus(getString(R.string.call_answer_failed))
            return
        }
        currentCallWasAnswered = true
        callMessageCaptureAttempts = 0
        enableSpeakerForActiveCall()
        dismissNotification(CALL_NOTIFICATION_ID)
        postCallEvent("taking_message", lastCaller)
        val prompt = when (nextCallScreeningPhraseVariant()) {
            0 -> getString(R.string.call_message_answer_prompt)
            1 -> getString(R.string.call_message_answer_prompt_alt_1)
            else -> getString(R.string.call_message_answer_prompt_alt_2)
        }
        speakAndThenListen(
            prompt,
            BackgroundListenMode.CALLER_MESSAGE
        )
    }

    private fun handleSmsReadAction() {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val sender = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, null)
        val body = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_BODY, null)
        if (!sender.isNullOrBlank() && !body.isNullOrBlank()) {
            awaitingSmsReplyChoice = true
            speakAndThenListen(
                getString(R.string.incoming_sms_readback_with_reply_offer, sender, body),
                BackgroundListenMode.SMS_COMMAND
            )
        }
    }

    private fun handleSmsIgnoreAction() {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val sender = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, "that sender").orEmpty()
        awaitingSmsReplyChoice = false
        clearPendingIncomingSms()
        dismissNotification(SMS_NOTIFICATION_ID)
        speakShortStatus(getString(R.string.incoming_sms_ignored, sender))
    }

    private fun handleSmsReplyAction(intent: Intent) {
        val replyText = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(KEY_REMOTE_REPLY_TEXT)?.toString()?.trim().orEmpty()
        if (replyText.isBlank()) return

        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val sender = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, null)
        val senderValue = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_VALUE, null)

        if (sender.isNullOrBlank() || senderValue.isNullOrBlank()) return

        sendPhoneSms(senderValue, replyText, sender)
    }

    private fun handleNotificationReadAction() {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val appName = prefs.getString(MainActivity.KEY_PENDING_NOTIFICATION_APP, null)
        val title = prefs.getString(MainActivity.KEY_PENDING_NOTIFICATION_TITLE, null)
        val body = prefs.getString(MainActivity.KEY_PENDING_NOTIFICATION_TEXT, null)
        if (!appName.isNullOrBlank() && !body.isNullOrBlank()) {
            val readback =
                if (!title.isNullOrBlank() && !title.equals(appName, ignoreCase = true)) {
                    getString(R.string.notification_readback_with_sender, appName, title, body)
                } else {
                    getString(R.string.notification_readback, appName, body)
                }
            speakShortStatus(readback)
        }
        clearPendingNotification()
        dismissNotification(NOTIFICATION_PROMPT_ID)
    }

    private fun handleNotificationIgnoreAction() {
        clearPendingNotification()
        dismissNotification(NOTIFICATION_PROMPT_ID)
    }

    private fun handleBackgroundVoiceMatches(mode: BackgroundListenMode?, transcripts: List<String>) {
        val cleaned = transcripts.map { it.trim() }.filter { it.isNotBlank() }
        if (cleaned.isEmpty()) {
            repromptBackgroundListenMode(mode)
            return
        }
        when (mode) {
            BackgroundListenMode.GENERAL_COMMAND -> sendBackgroundDexChat(cleaned.first())
            BackgroundListenMode.CALL_COMMAND -> {
                val handled = cleaned.any { handleBackgroundCallCommand(it.lowercase(Locale.US)) }
                if (!handled) repromptBackgroundListenMode(mode)
            }
            BackgroundListenMode.SMS_COMMAND -> {
                val handled = cleaned.any { handleBackgroundSmsCommand(it.lowercase(Locale.US)) }
                if (!handled) repromptBackgroundListenMode(mode)
            }
            BackgroundListenMode.SMS_REPLY -> sendPendingSmsReply(cleaned.first())
            BackgroundListenMode.NOTIFICATION_COMMAND -> {
                val handled = cleaned.any { handleBackgroundNotificationCommand(it.lowercase(Locale.US)) }
                if (handled) {
                    notificationCommandAttempts = 0
                } else {
                    repromptBackgroundListenMode(mode)
                }
            }
            BackgroundListenMode.SAFETY_CHECK_IN -> {
                val handled = cleaned.any { handleBackgroundSafetyCheckIn(it.lowercase(Locale.US)) }
                if (!handled) repromptBackgroundListenMode(mode)
            }
            BackgroundListenMode.CALLER_MESSAGE -> handleCallerMessage(cleaned.first())
            BackgroundListenMode.REMINDER_CHECK_IN -> {
                val handled = cleaned.any { handleBackgroundReminderCheckIn(it.lowercase(Locale.US)) }
                if (!handled) repromptBackgroundListenMode(mode)
            }
            null -> Unit
        }
    }

    private fun repromptBackgroundListenMode(mode: BackgroundListenMode?) {
        when (mode) {
            BackgroundListenMode.GENERAL_COMMAND ->
                speakAndThenListen(
                    getString(R.string.wake_mode_command_retry),
                    BackgroundListenMode.GENERAL_COMMAND
                )
            BackgroundListenMode.CALL_COMMAND ->
                if (lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                    speakAndThenListen(
                        getString(R.string.call_listening_retry),
                        BackgroundListenMode.CALL_COMMAND
                    )
                }
            BackgroundListenMode.SMS_COMMAND ->
                speakAndThenListen(
                    getString(R.string.incoming_sms_command_retry),
                    BackgroundListenMode.SMS_COMMAND
                )
            BackgroundListenMode.SMS_REPLY -> {
                val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
                val sender = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, "them").orEmpty()
                speakAndThenListen(
                    getString(R.string.incoming_sms_reply_retry, sender),
                    BackgroundListenMode.SMS_REPLY
                )
            }
            BackgroundListenMode.NOTIFICATION_COMMAND ->
                if (notificationCommandAttempts < MAX_NOTIFICATION_COMMAND_ATTEMPTS) {
                    notificationCommandAttempts += 1
                    speakAndThenListen(
                        getString(R.string.notification_command_retry),
                        BackgroundListenMode.NOTIFICATION_COMMAND
                    )
                } else {
                    notificationCommandAttempts = 0
                    clearPendingNotification()
                    dismissNotification(NOTIFICATION_PROMPT_ID)
                    speakShortStatus(getString(R.string.notification_command_give_up))
                }
            BackgroundListenMode.SAFETY_CHECK_IN ->
                if (safetyCheckInAttempts < MAX_SAFETY_CHECK_IN_ATTEMPTS) {
                    safetyCheckInAttempts += 1
                    speakAndThenListen(
                        getString(R.string.safety_check_in_retry),
                        BackgroundListenMode.SAFETY_CHECK_IN
                    )
                } else {
                    if (pendingSafetyEmergency) {
                        scheduleNextSafetyFollowUp(10, pendingSafetyMood ?: "crisis", true)
                    }
                    clearPendingSafetyContext()
                    speakShortStatus(getString(R.string.safety_check_in_pause))
                }
            BackgroundListenMode.CALLER_MESSAGE ->
                if (callMessageCaptureAttempts < MAX_CALL_MESSAGE_CAPTURE_ATTEMPTS) {
                    val retryPrompt = when (nextCallScreeningPhraseVariant()) {
                        0 -> getString(R.string.call_message_answer_retry)
                        1 -> getString(R.string.call_message_answer_retry_alt_1)
                        else -> getString(R.string.call_message_answer_retry_alt_2)
                    }
                    speakAndThenListen(
                        retryPrompt,
                        BackgroundListenMode.CALLER_MESSAGE
                    )
                } else {
                    val giveUp = when (nextCallScreeningPhraseVariant()) {
                        0 -> getString(R.string.call_message_answer_give_up)
                        1 -> getString(R.string.call_message_answer_give_up_alt_1)
                        else -> getString(R.string.call_message_answer_give_up_alt_2)
                    }
                    speakShortStatus(giveUp)
                    mainHandler.postDelayed({ endCurrentCall() }, CALL_MESSAGE_END_DELAY_MS)
                }
            BackgroundListenMode.REMINDER_CHECK_IN ->
                speakAndThenListen(
                    if (pendingReminderCallTarget != null) {
                        getString(R.string.call_reminder_check_in_retry)
                    } else if (pendingReminderTextTarget != null && pendingReminderTextBody != null) {
                        getString(R.string.text_reminder_check_in_retry)
                    } else {
                        getString(R.string.reminder_check_in_retry)
                    },
                    BackgroundListenMode.REMINDER_CHECK_IN
                )
            null -> Unit
        }
    }

    private fun handleBackgroundCallCommand(normalized: String): Boolean {
        return when {
            isAffirmativeCommand(normalized) -> {
                handleCallAnswerAction()
                true
            }
            normalized.contains("take a message") ||
                normalized.contains("take the message") ||
                normalized.contains("ask who") ||
                normalized.contains("ask them") -> {
                handleCallTakeMessageAction()
                true
            }
            normalized.contains("answer on speaker") ||
                normalized.contains("pick up on speaker") -> {
                val answered = answerRingingCall()
                currentCallWasAnswered = answered
                if (answered) enableSpeakerForActiveCall()
                speakShortStatus(if (answered) getString(R.string.call_answered) else getString(R.string.call_answer_failed))
                true
            }
            normalized == "answer" ||
                normalized.startsWith("answer ") ||
                normalized.contains("pick up") ||
                normalized.contains("take the call") -> {
                handleCallAnswerAction()
                true
            }
            normalized == "decline" ||
                normalized.startsWith("decline ") ||
                normalized.contains("reject") ||
                normalized.contains("hang up") ||
                normalized.contains("ignore") -> {
                handleCallDeclineAction()
                true
            }
            else -> false
        }
    }

    private fun handleBackgroundSmsCommand(normalized: String): Boolean {
        return when {
            isAffirmativeCommand(normalized) -> {
                if (awaitingSmsReplyChoice) {
                    promptForPendingSmsReply()
                } else {
                    handleSmsReadAction()
                }
                true
            }
            normalized.contains("read") -> {
                handleSmsReadAction()
                true
            }
            normalized.contains("reply") ||
                normalized.contains("text back") ||
                normalized.contains("respond") -> {
                promptForPendingSmsReply()
                true
            }
            isNegativeCommand(normalized) ||
                normalized.contains("ignore") ||
                normalized.contains("leave it") -> {
                handleSmsIgnoreAction()
                true
            }
            else -> false
        }
    }

    private fun promptForPendingSmsReply() {
        awaitingSmsReplyChoice = false
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val sender = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, "them").orEmpty()
        val senderValue = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_VALUE, null).orEmpty()
        if (senderValue.isBlank()) {
            speakShortStatus(getString(R.string.incoming_sms_reply_number_missing, sender))
            return
        }
        speakAndThenListen(getString(R.string.incoming_sms_reply_prompt, sender), BackgroundListenMode.SMS_REPLY)
    }

    private fun handleBackgroundNotificationCommand(normalized: String): Boolean {
        return when {
            isAffirmativeCommand(normalized) -> {
                handleNotificationReadAction()
                true
            }
            normalized.contains("read") -> {
                handleNotificationReadAction()
                true
            }
            isNegativeCommand(normalized) ||
                normalized.contains("ignore") ||
                normalized.contains("leave it") -> {
                handleNotificationIgnoreAction()
                true
            }
            else -> false
        }
    }

    private fun handleBackgroundSafetyCheckIn(normalized: String): Boolean {
        return when {
            isSafetyImprovedReply(normalized) -> {
                persistSafetyCheckInMemory("better", pendingSafetyMood ?: "general")
                clearPendingSafetyContext()
                speakShortStatus(buildSafetyRelievedReply())
                true
            }
            isSafetyStayReply(normalized) -> {
                val mood = detectSafetyMoodFromReply(normalized, pendingSafetyMood)
                val support = buildSafetySupportMessage(mood, pendingSafetyEmergency)
                scheduleNextSafetyFollowUp(if (pendingSafetyEmergency) 10 else 12, mood, pendingSafetyEmergency)
                persistSafetyCheckInMemory("stay", mood)
                clearPendingSafetyContext()
                speakShortStatus("$support ${buildSafetyStayReply()}".trim())
                true
            }
            isSafetyLaterReply(normalized) -> {
                val mood = pendingSafetyMood ?: "general"
                scheduleNextSafetyFollowUp(if (pendingSafetyEmergency) 15 else 25, mood, pendingSafetyEmergency)
                persistSafetyCheckInMemory("later", mood)
                clearPendingSafetyContext()
                speakShortStatus(buildSafetyLaterReply())
                true
            }
            isHighRiskSafetyReply(normalized) -> {
                val personName = resolveEmergencyPersonName()
                val trigger = normalized.replace(Regex("\\s+"), " ").trim()
                val crisisReply = getString(R.string.local_emergency_reply, personName)
                val smsStatus = sendEscalationSafetySms(trigger)
                scheduleNextSafetyFollowUp(10, "crisis", true)
                persistSafetyCheckInMemory("crisis", "crisis")
                clearPendingSafetyContext()
                val spoken = listOfNotNull(crisisReply, smsStatus, getString(R.string.safety_check_in_staying_with_you))
                    .joinToString(" ")
                speakShortStatus(spoken)
                true
            }
            isSafetyDistressReply(normalized) -> {
                val mood = detectSafetyMoodFromReply(normalized, pendingSafetyMood)
                val support = buildSafetySupportMessage(mood, pendingSafetyEmergency)
                val followUpMinutes = if (pendingSafetyEmergency) 10 else 20
                scheduleNextSafetyFollowUp(followUpMinutes, mood, pendingSafetyEmergency)
                persistSafetyCheckInMemory("needs_support", mood)
                clearPendingSafetyContext()
                speakShortStatus("$support ${buildSafetyFollowingUpReply()}".trim())
                true
            }
            isAffirmativeCommand(normalized) -> {
                val mood = pendingSafetyMood ?: "general"
                val support = buildSafetySupportMessage(mood, pendingSafetyEmergency)
                val followUpMinutes = if (pendingSafetyEmergency) 10 else 20
                scheduleNextSafetyFollowUp(followUpMinutes, mood, pendingSafetyEmergency)
                persistSafetyCheckInMemory("needs_support", mood)
                clearPendingSafetyContext()
                speakShortStatus("$support ${buildSafetyFollowingUpReply()}".trim())
                true
            }
            isNegativeCommand(normalized) -> {
                persistSafetyCheckInMemory("pause", pendingSafetyMood ?: "general")
                clearPendingSafetyContext()
                speakShortStatus(getString(R.string.safety_check_in_pause))
                true
            }
            else -> false
        }
    }

    private fun handleBackgroundReminderCheckIn(normalized: String): Boolean {
        val reminderCallTarget = pendingReminderCallTarget
        val reminderTextTarget = pendingReminderTextTarget
        val reminderTextBody = pendingReminderTextBody
        return when {
            reminderCallTarget != null &&
                (isAffirmativeCommand(normalized) ||
                    normalized.contains("call now") ||
                    normalized.contains("call them") ||
                    normalized.contains("go ahead and call")) -> {
                clearPendingReminderContext()
                placeReminderCall(reminderCallTarget)
                true
            }
            reminderTextTarget != null && !reminderTextBody.isNullOrBlank() &&
                (isAffirmativeCommand(normalized) ||
                    normalized.contains("text now") ||
                    normalized.contains("send it") ||
                    normalized.contains("send the text")) -> {
                clearPendingReminderContext()
                sendReminderText(reminderTextTarget, reminderTextBody)
                true
            }
            normalized.contains("check back") ||
                normalized.contains("remind me again") ||
                normalized.contains("another reminder") ||
                normalized.contains("ten minutes") ||
                normalized.contains("later") ||
                (reminderCallTarget == null && reminderTextTarget == null && isAffirmativeCommand(normalized)) -> {
                val title = pendingReminderTitle ?: getString(R.string.learning_reminder_title)
                val text = pendingReminderText ?: getString(R.string.learning_reminder_text)
                clearPendingReminderContext()
                DexSafetyCheckInScheduler.scheduleOneTimeCheckIn(
                    context = this,
                    delayMinutes = 10,
                    title = title,
                    text = text,
                    voiceCheckIn = true
                )
                speakShortStatus(getString(R.string.reminder_check_in_confirmed))
                true
            }
            normalized == "no" ||
                normalized.startsWith("no ") ||
                normalized.contains("not now") ||
                normalized.contains("i'm good") ||
                normalized.contains("no thanks") ||
                normalized.contains("stop") ||
                normalized.contains("dismiss") -> {
                clearPendingReminderContext()
                speakShortStatus(getString(R.string.reminder_check_in_declined))
                true
            }
            else -> false
        }
    }

    private fun extractReminderCallTarget(title: String, text: String): String? {
        Regex("^Call\\s+(.+)$", RegexOption.IGNORE_CASE).find(title.trim())?.let { match ->
            val target = match.groupValues.getOrNull(1)?.trim().orEmpty()
            if (target.isNotBlank()) return target
        }
        Regex("^Reminder to call\\s+(.+?)\\.?$", RegexOption.IGNORE_CASE).find(text.trim())?.let { match ->
            val target = match.groupValues.getOrNull(1)?.trim().orEmpty()
            if (target.isNotBlank()) return target
        }
        return null
    }

    private fun extractReminderTextDetails(title: String, text: String): Pair<String, String>? {
        Regex("^Text\\s+(.+)$", RegexOption.IGNORE_CASE).find(title.trim())?.let { titleMatch ->
            val target = titleMatch.groupValues.getOrNull(1)?.trim().orEmpty()
            val textMatch = Regex("^Reminder to text\\s+(.+?):\\s+(.+?)\\.?$", RegexOption.IGNORE_CASE).find(text.trim())
            val body = textMatch?.groupValues?.getOrNull(2)?.trim().orEmpty()
            if (target.isNotBlank() && body.isNotBlank()) return target to body
        }
        return null
    }

    private fun buildSafetyCheckInPrompt(): String {
        val profile = currentSafetyPromptProfile()
        val name = resolveEmergencyPersonName()
        val variant = nextSafetyCheckInPhraseVariant()
        val basePrompt = if (profile.emergency) {
            when (variant) {
                0 -> getString(R.string.safety_check_in_prompt_crisis, name, profile.message)
                1 -> getString(R.string.safety_check_in_prompt_crisis_alt_1, name, profile.message)
                else -> getString(R.string.safety_check_in_prompt_crisis_alt_2, name, profile.message)
            }
        } else {
            when (variant) {
                0 -> getString(R.string.safety_check_in_prompt_friend, name, profile.message)
                1 -> getString(R.string.safety_check_in_prompt_friend_alt_1, name, profile.message)
                else -> getString(R.string.safety_check_in_prompt_friend_alt_2, name, profile.message)
            }
        }
        val memory = buildSafetyMemoryLead(profile.mood)
        return listOfNotNull(memory, basePrompt).joinToString(" ")
    }

    private fun currentSafetyPromptProfile(): SafetyPromptProfile {
        val title = pendingSafetyTitle ?: getString(R.string.safety_check_in_title)
        val message = pendingSafetyText ?: getString(R.string.safety_check_in_text)
        val mood = pendingSafetyMood ?: "general"
        return SafetyPromptProfile(title, message, mood, pendingSafetyEmergency)
    }

    private fun buildSafetyFollowUpResponse(mood: String, emergency: Boolean): String {
        val name = resolveEmergencyPersonName()
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val comfortStyle = prefs.getString(MainActivity.KEY_SAFETY_COMFORT_STYLE, "calm").orEmpty().ifBlank { "calm" }
        val groundingStyle = prefs.getString(MainActivity.KEY_SAFETY_GROUNDING_STYLE, "gentle").orEmpty().ifBlank { "gentle" }
        return when {
            emergency -> when (nextSafetyCheckInPhraseVariant()) {
                0 -> getString(R.string.safety_check_in_response_crisis, name)
                1 -> getString(R.string.safety_check_in_response_crisis_alt_1, name)
                else -> getString(R.string.safety_check_in_response_crisis_alt_2, name)
            }
            mood == "anger" -> when (nextSafetyCheckInPhraseVariant()) {
                0 -> getString(R.string.safety_check_in_response_anger, name, groundingStyle)
                1 -> getString(R.string.safety_check_in_response_anger_alt_1, name, groundingStyle)
                else -> getString(R.string.safety_check_in_response_anger_alt_2, name, groundingStyle)
            }
            mood == "sadness" -> when (nextSafetyCheckInPhraseVariant()) {
                0 -> getString(R.string.safety_check_in_response_sadness, name, comfortStyle)
                1 -> getString(R.string.safety_check_in_response_sadness_alt_1, name, comfortStyle)
                else -> getString(R.string.safety_check_in_response_sadness_alt_2, name, comfortStyle)
            }
            mood == "stress" -> when (nextSafetyCheckInPhraseVariant()) {
                0 -> getString(R.string.safety_check_in_response_stress, name, groundingStyle)
                1 -> getString(R.string.safety_check_in_response_stress_alt_1, name, groundingStyle)
                else -> getString(R.string.safety_check_in_response_stress_alt_2, name, groundingStyle)
            }
            else -> when (nextSafetyCheckInPhraseVariant()) {
                0 -> getString(R.string.safety_check_in_response_general, name, comfortStyle)
                1 -> getString(R.string.safety_check_in_response_general_alt_1, name, comfortStyle)
                else -> getString(R.string.safety_check_in_response_general_alt_2, name, comfortStyle)
            }
        }
    }

    private fun buildSafetyCopingNudge(mood: String, emergency: Boolean): String {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val comfortStyle = prefs.getString(MainActivity.KEY_SAFETY_COMFORT_STYLE, "calm").orEmpty().ifBlank { "calm" }
        val groundingStyle = prefs.getString(MainActivity.KEY_SAFETY_GROUNDING_STYLE, "gentle").orEmpty().ifBlank { "gentle" }
        val stepByStep = groundingStyle.contains("step", ignoreCase = true)
        val faithStyle = comfortStyle.contains("faith", ignoreCase = true)
        val directStyle = comfortStyle.contains("direct", ignoreCase = true)
        return when {
            emergency -> getString(R.string.safety_check_in_nudge_crisis)
            mood == "stress" && stepByStep -> getString(R.string.safety_check_in_nudge_stress_step)
            mood == "stress" -> getString(R.string.safety_check_in_nudge_stress, groundingStyle)
            mood == "sadness" && faithStyle -> getString(R.string.safety_check_in_nudge_sadness_faith)
            mood == "sadness" && directStyle -> getString(R.string.safety_check_in_nudge_sadness_direct)
            mood == "sadness" -> getString(R.string.safety_check_in_nudge_sadness)
            mood == "anger" && stepByStep -> getString(R.string.safety_check_in_nudge_anger_step)
            mood == "anger" -> getString(R.string.safety_check_in_nudge_anger, groundingStyle)
            directStyle -> getString(R.string.safety_check_in_nudge_general_direct)
            faithStyle -> getString(R.string.safety_check_in_nudge_general_faith)
            else -> getString(R.string.safety_check_in_nudge_general)
        }
    }

    private fun buildSafetySupportMessage(mood: String, emergency: Boolean): String {
        return listOf(
            buildSafetyFollowUpResponse(mood, emergency),
            buildSafetyCopingNudge(mood, emergency)
        ).joinToString(" ")
    }

    private fun buildSafetyRelievedReply(): String {
        return when (nextSafetyCheckInPhraseVariant()) {
            0 -> getString(R.string.safety_check_in_relieved)
            1 -> getString(R.string.safety_check_in_relieved_alt_1)
            else -> getString(R.string.safety_check_in_relieved_alt_2)
        }
    }

    private fun buildSafetyStayReply(): String {
        return when (nextSafetyCheckInPhraseVariant()) {
            0 -> getString(R.string.safety_check_in_stay_reply)
            1 -> getString(R.string.safety_check_in_stay_reply_alt_1)
            else -> getString(R.string.safety_check_in_stay_reply_alt_2)
        }
    }

    private fun buildSafetyLaterReply(): String {
        return when (nextSafetyCheckInPhraseVariant()) {
            0 -> getString(R.string.safety_check_in_later_reply)
            1 -> getString(R.string.safety_check_in_later_reply_alt_1)
            else -> getString(R.string.safety_check_in_later_reply_alt_2)
        }
    }

    private fun buildSafetyFollowingUpReply(): String {
        return when (nextSafetyCheckInPhraseVariant()) {
            0 -> getString(R.string.safety_check_in_following_up)
            1 -> getString(R.string.safety_check_in_following_up_alt_1)
            else -> getString(R.string.safety_check_in_following_up_alt_2)
        }
    }

    private fun buildSafetyMemoryLead(currentMood: String): String? {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val lastAt = prefs.getLong(MainActivity.KEY_LAST_SAFETY_CHECK_IN_AT, 0L)
        if (lastAt <= 0L || System.currentTimeMillis() - lastAt > SAFETY_MEMORY_WINDOW_MS) return null
        val lastMood = prefs.getString(MainActivity.KEY_LAST_SAFETY_MOOD, null).orEmpty()
        val lastChoice = prefs.getString(MainActivity.KEY_LAST_SAFETY_CHOICE, null).orEmpty()
        return when {
            lastChoice == "later" -> getString(R.string.safety_check_in_memory_later)
            lastChoice == "stay" -> getString(R.string.safety_check_in_memory_stay)
            currentMood == "stress" || lastMood == "stress" -> getString(R.string.safety_check_in_memory_stress)
            currentMood == "sadness" || lastMood == "sadness" -> getString(R.string.safety_check_in_memory_sadness)
            currentMood == "anger" || lastMood == "anger" -> getString(R.string.safety_check_in_memory_anger)
            else -> null
        }
    }

    private fun persistSafetyCheckInMemory(choice: String, mood: String) {
        getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(MainActivity.KEY_LAST_SAFETY_CHOICE, choice)
            .putString(MainActivity.KEY_LAST_SAFETY_MOOD, mood)
            .putLong(MainActivity.KEY_LAST_SAFETY_CHECK_IN_AT, System.currentTimeMillis())
            .apply()
    }

    private fun detectSafetyMoodFromReply(normalized: String, fallbackMood: String?): String {
        val angerPhrases = listOf("angry", "mad", "furious", "pissed", "frustrated", "annoyed")
        val sadnessPhrases = listOf("sad", "crying", "down", "depressed", "lonely", "hurt", "hopeless")
        val stressPhrases = listOf("stressed", "overwhelmed", "anxious", "panic", "panicking", "tense")
        return when {
            angerPhrases.any { normalized.contains(it) } -> "anger"
            sadnessPhrases.any { normalized.contains(it) } -> "sadness"
            stressPhrases.any { normalized.contains(it) } -> "stress"
            else -> fallbackMood ?: "general"
        }
    }

    private fun isSafetyImprovedReply(normalized: String): Boolean {
        return normalized.contains("i'm good") ||
            normalized.contains("im good") ||
            normalized.contains("i feel better") ||
            normalized.contains("feeling better") ||
            normalized.contains("i'm okay") ||
            normalized.contains("im okay") ||
            normalized.contains("i am okay") ||
            normalized.contains("i am good") ||
            normalized.contains("better now") ||
            normalized.contains("i'm alright") ||
            normalized.contains("im alright")
    }

    private fun isSafetyDistressReply(normalized: String): Boolean {
        return normalized.contains("not good") ||
            normalized.contains("not okay") ||
            normalized.contains("still upset") ||
            normalized.contains("still angry") ||
            normalized.contains("still sad") ||
            normalized.contains("still stressed") ||
            normalized.contains("still overwhelmed") ||
            normalized.contains("i need help") ||
            normalized.contains("don't feel better") ||
            normalized.contains("do not feel better") ||
            normalized.contains("not better")
    }

    private fun isSafetyStayReply(normalized: String): Boolean {
        return normalized.contains("stay with me") ||
            normalized.contains("stay here") ||
            normalized.contains("stay on me") ||
            normalized.contains("stay with me a minute") ||
            normalized.contains("check on me soon") ||
            normalized.contains("stay close") ||
            normalized.contains("don't leave") ||
            normalized.contains("do not leave")
    }

    private fun isSafetyLaterReply(normalized: String): Boolean {
        return normalized.contains("check back later") ||
            normalized.contains("come back later") ||
            normalized.contains("give me a minute") ||
            normalized.contains("give me some time") ||
            normalized.contains("later is fine") ||
            normalized.contains("check on me later") ||
            normalized.contains("give me space")
    }

    private fun isHighRiskSafetyReply(normalized: String): Boolean {
        val phrases = listOf(
            "kill myself",
            "want to die",
            "hurt myself",
            "harm myself",
            "suicidal",
            "kill someone",
            "hurt someone",
            "harm someone",
            "hurt others",
            "harm others"
        )
        return phrases.any { normalized.contains(it) }
    }

    private fun scheduleNextSafetyFollowUp(delayMinutes: Int, mood: String, emergency: Boolean) {
        val title = pendingSafetyTitle ?: getString(R.string.safety_check_in_title)
        val text = when {
            emergency -> getString(R.string.safety_check_in_text_crisis, resolveEmergencyPersonName())
            mood == "anger" -> getString(R.string.safety_check_in_text_anger, resolveEmergencyPersonName(), "steady")
            mood == "sadness" -> getString(R.string.safety_check_in_text_sadness, resolveEmergencyPersonName(), "calm")
            mood == "stress" -> getString(R.string.safety_check_in_text_stress, resolveEmergencyPersonName(), "gentle")
            else -> getString(R.string.safety_check_in_text_friend, resolveEmergencyPersonName(), "calm")
        }
        DexSafetyCheckInScheduler.scheduleOneTimeCheckIn(
            context = this,
            delayMinutes = delayMinutes,
            title = title,
            text = text,
            voiceCheckIn = true,
            kind = "safety",
            mood = mood,
            emergencyFollowUp = emergency
        )
    }

    private fun sendEscalationSafetySms(triggerMessage: String): String? {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val contactAllowed = prefs.getBoolean(MainActivity.KEY_EMERGENCY_CONTACT_PERMISSION, false)
        if (!contactAllowed) return null
        val trustedContact = prefs.getString(MainActivity.KEY_EMERGENCY_CONTACT, null).orEmpty()
        val phoneNumber = normalizeSmsPhoneNumber(trustedContact)
        if (phoneNumber.isBlank()) return null
        if (!hasPermission(Manifest.permission.SEND_SMS)) return getString(R.string.local_emergency_sms_permission_missing)
        val assistedPersonName = resolveEmergencyPersonName()
        val smsBody = getString(R.string.local_emergency_sms_body, assistedPersonName, triggerMessage.take(72))
        return runCatching {
            resolveSmsManager().sendTextMessage(phoneNumber, null, smsBody, null, null)
        }.fold(
            onSuccess = { getString(R.string.local_emergency_sms_attempting) },
            onFailure = { getString(R.string.local_emergency_sms_failed) }
        )
    }

    private fun clearPendingReminderContext() {
        pendingReminderTitle = null
        pendingReminderText = null
        pendingReminderCallTarget = null
        pendingReminderTextTarget = null
        pendingReminderTextBody = null
    }

    private fun clearPendingSafetyContext() {
        pendingSafetyTitle = null
        pendingSafetyText = null
        pendingSafetyMood = null
        pendingSafetyEmergency = false
        safetyCheckInAttempts = 0
    }

    private fun placeReminderCall(target: String) {
        if (!hasPermission(Manifest.permission.CALL_PHONE)) {
            speakShortStatus(getString(R.string.call_phone_permission_missing))
            return
        }
        val phoneNumber = findPhoneNumberByContactName(target)
        if (phoneNumber.isNullOrBlank()) {
            speakShortStatus(getString(R.string.contact_not_found_phone, target))
            return
        }
        val intent = Intent(Intent.ACTION_CALL).apply {
            data = Uri.parse("tel:$phoneNumber")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            startActivity(intent)
            speakShortStatus(getString(R.string.call_direct_started, target))
        } catch (_: Exception) {
            speakShortStatus(getString(R.string.action_open_failed))
        }
    }

    private fun sendReminderText(target: String, body: String) {
        val phoneNumber = findPhoneNumberByContactName(target)
        if (phoneNumber.isNullOrBlank()) {
            speakShortStatus(getString(R.string.contact_not_found_phone, target))
            return
        }
        sendPhoneSms(phoneNumber, body, target)
    }

    private fun isAffirmativeCommand(normalized: String): Boolean {
        return normalized == "yes" ||
            normalized.startsWith("yes ") ||
            normalized.contains("yes please") ||
            normalized == "yeah" ||
            normalized.startsWith("yeah ") ||
            normalized == "yep" ||
            normalized.startsWith("yep ") ||
            normalized == "okay" ||
            normalized.startsWith("okay ") ||
            normalized == "ok" ||
            normalized.startsWith("ok ") ||
            normalized == "sure" ||
            normalized.startsWith("sure ") ||
            normalized == "please do" ||
            normalized == "go ahead" ||
            normalized.startsWith("go ahead ") ||
            normalized.contains("go ahead and read") ||
            normalized.contains("read it") ||
            normalized.contains("read that") ||
            normalized.contains("read the notification") ||
            normalized.contains("reply to it") ||
            normalized.contains("reply back")
    }

    private fun isNegativeCommand(normalized: String): Boolean {
        return normalized == "no" ||
            normalized.startsWith("no ") ||
            normalized.contains("no thank you") ||
            normalized == "nope" ||
            normalized.startsWith("nope ") ||
            normalized == "nah" ||
            normalized.startsWith("nah ") ||
            normalized.contains("no thanks") ||
            normalized.contains("not now") ||
            normalized.contains("don't") ||
            normalized.contains("do not") ||
            normalized.contains("leave that") ||
            normalized.contains("don't read it") ||
            normalized.contains("do not read it")
    }

    private fun handleCallerMessage(transcript: String) {
        val parsedMessage = normalizeCallerMessageTranscript(transcript)
        if (parsedMessage == null) {
            callMessageCaptureAttempts += 1
            repromptBackgroundListenMode(BackgroundListenMode.CALLER_MESSAGE)
            return
        }
        val baseCaller = lastCaller.takeUnless { it.isBlank() || it == "Unknown caller" }
            ?: lastIncomingNumber
            ?: getString(R.string.unknown_number_label)
        val caller = chooseSavedCallerLabel(baseCaller, parsedMessage.callerName)
        postCallEvent("message", "$caller: ${parsedMessage.message}")
        MainActivity.appendPersistentCallMessageLog(
            context = this,
            caller = caller,
            phoneNumber = lastIncomingNumber,
            message = parsedMessage.message
        )
        callMessageCaptureAttempts = 0
        val savedReply = when (nextCallScreeningPhraseVariant()) {
            0 -> getString(R.string.call_message_saved, caller)
            1 -> getString(R.string.call_message_saved_alt_1, caller)
            else -> getString(R.string.call_message_saved_alt_2, caller)
        }
        speakShortStatus(savedReply)
        mainHandler.postDelayed({ endCurrentCall() }, CALL_MESSAGE_END_DELAY_MS)
    }

    private fun normalizeCallerMessageTranscript(transcript: String): ParsedCallerMessage? {
        val cleaned = transcript
            .trim()
            .replace(Regex("\\s+"), " ")
            .replace(Regex("^[,.;:!?\\-\\s]+|[,.;:!?\\-\\s]+$"), "")
        if (cleaned.length < MIN_CALL_MESSAGE_LENGTH) return null

        var normalized = cleaned.lowercase(Locale.US)
        val junkPhrases = listOf(
            "hello",
            "hey",
            "you there",
            "can you hear me",
            "call me back",
            "pick up",
            "answer the phone",
            "is anybody there",
            "test",
            "testing"
        )
        if (normalized in junkPhrases) return null
        var extractedCallerName: String? = null
        extractCallerName(normalized)?.let { (name, remainder) ->
            extractedCallerName = name
            normalized = remainder
        }

        normalized = normalized
            .replace(Regex("^(?:uh|um|hello|hi|hey|okay|ok|well|so)\\b[\\s,.-]*"), "")
            .replace(Regex("\\b(?:thanks|thank you|bye|goodbye)\\s*$"), "")
            .replace(Regex("\\s+"), " ")
            .trim(' ', ',', '.', ';', ':', '!', '?', '-')

        if (normalized.length < MIN_CALL_MESSAGE_LENGTH) return null
        val wordCount = normalized.split(" ").count { it.isNotBlank() }
        if (wordCount < MIN_CALL_MESSAGE_WORDS && junkPhrases.any { normalized.contains(it) }) return null
        val polished = normalized.replaceFirstChar {
            if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString()
        }
        return ParsedCallerMessage(extractedCallerName, polished)
    }

    private fun extractCallerName(normalizedTranscript: String): Pair<String, String>? {
        val patterns = listOf(
            Regex("^this is ([a-z][a-z ]{1,30}?)(?: calling| speaking| here| and|,|\\.|$)"),
            Regex("^my name is ([a-z][a-z ]{1,30}?)(?: and|,|\\.|$)"),
            Regex("^it is ([a-z][a-z ]{1,30}?)(?: calling| and|,|\\.|$)"),
            Regex("^i am ([a-z][a-z ]{1,30}?)(?: and|,|\\.|$)")
        )
        for (pattern in patterns) {
            val match = pattern.find(normalizedTranscript) ?: continue
            val rawName = match.groupValues.getOrNull(1)?.trim().orEmpty()
            val callerName = rawName
                .split(" ")
                .filter { it.isNotBlank() }
                .take(3)
                .joinToString(" ") { token ->
                    token.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
                }
                .trim()
            if (callerName.isBlank()) continue
            val remainder = normalizedTranscript.removeRange(match.range).trim(' ', ',', '.', ';', ':', '!', '?', '-')
            return callerName to remainder
        }
        return null
    }

    private fun chooseSavedCallerLabel(currentCaller: String, extractedCallerName: String?): String {
        if (extractedCallerName.isNullOrBlank()) return currentCaller
        val normalizedCurrent = currentCaller.lowercase(Locale.US)
        val isWeakCurrent =
            normalizedCurrent == getString(R.string.unknown_number_label).lowercase(Locale.US) ||
                normalizedCurrent == getString(R.string.private_number_label).lowercase(Locale.US) ||
                normalizedCurrent.all { it.isDigit() || it == '+' || it == '-' || it == ' ' || it == '(' || it == ')' }
        return if (isWeakCurrent) extractedCallerName else currentCaller
    }

    private fun nextCallScreeningPhraseVariant(): Int {
        val value = callScreeningPhraseIndex % 3
        callScreeningPhraseIndex += 1
        return value
    }

    private fun sendPendingSmsReply(replyText: String) {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val sender = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, null)
        val senderValue = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_VALUE, null)
        if (sender.isNullOrBlank()) return
        if (senderValue.isNullOrBlank()) {
            speakShortStatus(getString(R.string.incoming_sms_reply_number_missing, sender))
            return
        }
        awaitingSmsReplyChoice = false
        sendPhoneSms(senderValue, replyText, sender)
    }

    private fun isMessageNotification(appName: String, title: String): Boolean {
        if (title.isBlank()) return false
        val lower = appName.lowercase(Locale.US)
        return lower.contains("message") ||
            lower.contains("messenger") ||
            lower.contains("sms") ||
            lower.contains("text")
    }

    private fun findPhoneNumberByContactName(name: String): String? {
        if (!hasPermission(Manifest.permission.READ_CONTACTS)) return null
        val cleanedName = name.trim()
        if (cleanedName.isBlank()) return null
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )
        val cursor: Cursor? = contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            projection,
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?",
            arrayOf("%$cleanedName%"),
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
        )
        cursor?.use {
            while (it.moveToNext()) {
                val displayName = it.getString(0).orEmpty()
                val number = it.getString(1).orEmpty()
                if (number.isNotBlank() && displayName.contains(cleanedName, ignoreCase = true)) {
                    return number
                }
            }
        }
        return null
    }

    private fun resolveEmergencyPersonName(): String {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(MainActivity.KEY_EMERGENCY_PROFILE_NAME, null)
            ?.trim()
            ?.takeUnless { it.isBlank() }
            ?: getString(R.string.safety_person_default_name)
    }

    private fun normalizeSmsPhoneNumber(value: String?): String {
        val digits = value.orEmpty().filter { it.isDigit() }
        return when {
            digits.length == 11 && digits.startsWith("1") -> "+$digits"
            digits.length == 10 -> "+1$digits"
            digits.length > 10 -> "+$digits"
            else -> ""
        }
    }

    private fun nextSafetyCheckInPhraseVariant(): Int {
        val value = callScreeningPhraseIndex % 3
        callScreeningPhraseIndex += 1
        return value
    }

    private fun sendPhoneSms(number: String, body: String, spokenTarget: String) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            speakShortStatus(getString(R.string.sms_send_permission_missing))
            return
        }
        runCatching {
            resolveSmsManager().sendTextMessage(number, null, body, null, null)
        }.onSuccess {
            clearPendingIncomingSms()
            dismissNotification(SMS_NOTIFICATION_ID)
            speakShortStatus(getString(R.string.sms_sent_directly, spokenTarget))
        }.onFailure {
            speakShortStatus(getString(R.string.sms_send_failed, spokenTarget))
        }
    }

    private fun showIncomingCallNotification(caller: String) {
        val fullScreenIntent = Intent(this, MainActivity::class.java).apply {
            putExtra(MainActivity.EXTRA_ASSISTANT_SURFACE, MainActivity.ASSISTANT_SURFACE_CALL)
            putExtra(MainActivity.EXTRA_ASSISTANT_CALLER, caller)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val openAppIntent = PendingIntent.getActivity(
            this,
            100,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val answerIntent = PendingIntent.getService(
            this,
            101,
            Intent(this, DexForegroundService::class.java).apply { action = ACTION_CALL_ANSWER },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val declineIntent = PendingIntent.getService(
            this,
            102,
            Intent(this, DexForegroundService::class.java).apply { action = ACTION_CALL_DECLINE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val takeMessageIntent = PendingIntent.getService(
            this,
            103,
            Intent(this, DexForegroundService::class.java).apply { action = ACTION_CALL_TAKE_MESSAGE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, ACTION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(getString(R.string.call_notification_title, caller))
            .setContentText(getString(R.string.call_notification_text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent)
            .setFullScreenIntent(openAppIntent, true)
            .addAction(0, getString(R.string.answer_call), answerIntent)
            .addAction(0, getString(R.string.take_message_call), takeMessageIntent)
            .addAction(0, getString(R.string.decline_call), declineIntent)
            .build()

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(CALL_NOTIFICATION_ID, notification)
    }

    private fun showIncomingSmsNotification(sender: String, body: String) {
        val openAppIntent = PendingIntent.getActivity(
            this,
            200,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val readIntent = PendingIntent.getService(
            this,
            201,
            Intent(this, DexForegroundService::class.java).apply { action = ACTION_SMS_READ },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val ignoreIntent = PendingIntent.getService(
            this,
            202,
            Intent(this, DexForegroundService::class.java).apply { action = ACTION_SMS_IGNORE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val replyIntent = PendingIntent.getService(
            this,
            203,
            Intent(this, DexForegroundService::class.java).apply { action = ACTION_SMS_REPLY },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        val remoteInput = RemoteInput.Builder(KEY_REMOTE_REPLY_TEXT)
            .setLabel(getString(R.string.incoming_sms_reply_action))
            .build()

        val notification = NotificationCompat.Builder(this, ACTION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(getString(R.string.incoming_sms_notification_title, sender))
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent)
            .addAction(0, getString(R.string.incoming_sms_read_action), readIntent)
            .addAction(0, getString(R.string.incoming_sms_ignore_action), ignoreIntent)
            .addAction(
                NotificationCompat.Action.Builder(0, getString(R.string.incoming_sms_reply_action), replyIntent)
                    .addRemoteInput(remoteInput)
                    .build()
            )
            .build()

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(SMS_NOTIFICATION_ID, notification)
    }

    private fun showIncomingNotificationPrompt(appName: String, body: String) {
        val openAppIntent = PendingIntent.getActivity(
            this,
            300,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val readIntent = PendingIntent.getService(
            this,
            301,
            Intent(this, DexForegroundService::class.java).apply { action = ACTION_NOTIFICATION_READ },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val ignoreIntent = PendingIntent.getService(
            this,
            302,
            Intent(this, DexForegroundService::class.java).apply { action = ACTION_NOTIFICATION_IGNORE },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, ACTION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(getString(R.string.notification_prompt_title, appName))
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent)
            .addAction(0, getString(R.string.notification_read_action), readIntent)
            .addAction(0, getString(R.string.notification_ignore_action), ignoreIntent)
            .build()

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_PROMPT_ID, notification)
    }

    private fun clearPendingIncomingSms() {
        awaitingSmsReplyChoice = false
        getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER)
            .remove(MainActivity.KEY_PENDING_INCOMING_SMS_VALUE)
            .remove(MainActivity.KEY_PENDING_INCOMING_SMS_BODY)
            .apply()
    }

    private fun clearPendingNotification() {
        notificationCommandAttempts = 0
        getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(MainActivity.KEY_PENDING_NOTIFICATION_APP)
            .remove(MainActivity.KEY_PENDING_NOTIFICATION_TITLE)
            .remove(MainActivity.KEY_PENDING_NOTIFICATION_TEXT)
            .apply()
    }

    private fun dismissNotification(notificationId: Int) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(notificationId)
    }

    private fun speakShortStatus(text: String) {
        if (!ttsReady) {
            pendingSpeechText = text
            return
        }
        speakNow(text)
    }

    private fun speakAndThenListen(text: String, mode: BackgroundListenMode) {
        pendingListenMode = mode
        speakShortStatus(text)
    }

    private fun startPendingBackgroundListening() {
        val mode = pendingListenMode ?: return
        pendingListenMode = null
        startBackgroundListening(mode)
    }

    private fun buildBackgroundRecognitionIntent(
        mode: BackgroundListenMode,
        maxResults: Int,
        completeSilenceMs: Long,
        possibleSilenceMs: Long,
        minimumMs: Long
    ): Intent {
        val biasingPhrases = linkedSetOf(
            "yes",
            "no",
            "read it",
            "reply",
            "ignore",
            "answer",
            "decline",
            "speaker",
            "take a message"
        ).apply {
            when (mode) {
                BackgroundListenMode.GENERAL_COMMAND -> addAll(
                    listOf("weather", "forecast", "temperature", "what is", "what's", "tell me", "remind me")
                )
                BackgroundListenMode.CALL_COMMAND -> addAll(
                    listOf("answer it", "answer on speaker", "pick up", "decline it", "take a message")
                )
                BackgroundListenMode.SMS_COMMAND -> addAll(
                    listOf("read it", "reply", "text back", "ignore it")
                )
                BackgroundListenMode.SMS_REPLY -> {
                    val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
                    prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, null)?.let { add(it) }
                }
                BackgroundListenMode.NOTIFICATION_COMMAND -> addAll(
                    listOf("read it", "reply", "ignore it")
                )
                BackgroundListenMode.SAFETY_CHECK_IN -> addAll(
                    listOf("i'm good", "im good", "i feel better", "i'm okay", "stay with me", "check back later", "not really", "still upset", "still stressed", "still sad")
                )
                BackgroundListenMode.REMINDER_CHECK_IN -> addAll(
                    listOf("remind me again", "check back", "ten minutes", "not now")
                )
                BackgroundListenMode.CALLER_MESSAGE -> {
                    lastCaller.takeUnless { it.isBlank() || it == "Unknown caller" }?.let { add(it) }
                }
            }
        }

        return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.US.toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, maxResults)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, completeSilenceMs)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, possibleSilenceMs)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, minimumMs)
            putStringArrayListExtra("android.speech.extra.BIASING_STRINGS", ArrayList(biasingPhrases.filter { it.isNotBlank() }))
        }
    }

    private fun startBackgroundListening(mode: BackgroundListenMode) {
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) return
        val recognizer = speechRecognizer ?: return
        activeListenMode = mode
        val completeSilenceMs = when (mode) {
            BackgroundListenMode.SMS_REPLY -> 6000L
            BackgroundListenMode.GENERAL_COMMAND -> 4200L
            BackgroundListenMode.CALLER_MESSAGE -> 6500L
            BackgroundListenMode.SAFETY_CHECK_IN -> 5200L
            else -> 3600L
        }
        val possibleSilenceMs = when (mode) {
            BackgroundListenMode.SMS_REPLY -> 3800L
            BackgroundListenMode.GENERAL_COMMAND -> 2800L
            BackgroundListenMode.CALLER_MESSAGE -> 4600L
            BackgroundListenMode.SAFETY_CHECK_IN -> 3400L
            else -> 2400L
        }
        val minimumMs = when (mode) {
            BackgroundListenMode.SMS_REPLY -> 14000L
            BackgroundListenMode.GENERAL_COMMAND -> 9000L
            BackgroundListenMode.CALLER_MESSAGE -> 18000L
            BackgroundListenMode.SAFETY_CHECK_IN -> 15000L
            else -> 5000L
        }
        val intent = buildBackgroundRecognitionIntent(mode, 5, completeSilenceMs, possibleSilenceMs, minimumMs)
        runCatching {
            recognizer.cancel()
            recognizer.startListening(intent)
        }.onFailure {
            activeListenMode = null
            logBackgroundRecognizerEvent("${mode.diagnosticLabel()} restart failed, trying again")
            recoverBackgroundRecognizer(mode)
        }
    }

    private fun recoverBackgroundRecognizer(mode: BackgroundListenMode?) {
        if (mode == null) return
        if (!shouldKeepServiceAlive()) return
        if (backgroundRecognizerRecoveryAttempts >= MAX_BACKGROUND_RECOGNIZER_RECOVERY_ATTEMPTS) {
            backgroundRecognizerRecoveryAttempts = 0
            logBackgroundRecognizerEvent("${mode.diagnosticLabel()} recovery limit reached")
            repromptBackgroundListenMode(mode)
            return
        }
        backgroundRecognizerRecoveryAttempts += 1
        val attempt = backgroundRecognizerRecoveryAttempts
        mainHandler.postDelayed({
            recreateSpeechRecognizer()
            logBackgroundRecognizerEvent(
                "restarted recognizer for ${mode.diagnosticLabel()} (attempt $attempt of $MAX_BACKGROUND_RECOGNIZER_RECOVERY_ATTEMPTS)"
            )
            startBackgroundListening(mode)
        }, BACKGROUND_RECOGNIZER_RECOVERY_DELAY_MS)
    }

    private fun logBackgroundRecognizerEvent(detail: String) {
        MainActivity.appendPersistentActivityLog(this, "Background voice", detail)
    }

    private fun isAppInForeground(): Boolean {
        return getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            .getBoolean(MainActivity.KEY_APP_IN_FOREGROUND, false)
    }

    private fun sendBackgroundDexChat(message: String) {
        val trimmed = message.trim()
        if (trimmed.isBlank()) {
            repromptBackgroundListenMode(BackgroundListenMode.GENERAL_COMMAND)
            return
        }
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val token = prefs.getString(MainActivity.KEY_TOKEN, null)
        val serverUrl = prefs.getString(MainActivity.KEY_SERVER_URL, MainActivity.DEFAULT_SERVER_URL)?.trimEnd('/').orEmpty()
        if (token.isNullOrBlank() || serverUrl.isBlank()) {
            speakShortStatus(getString(R.string.wake_mode_server_needed))
            return
        }
        logBackgroundRecognizerEvent("handling wake command in background: ${trimmed.take(48)}")
        Thread {
            val spokenReply = runCatching {
                val payload = JSONObject().apply { put("message", trimmed) }
                val request = Request.Builder()
                    .url("$serverUrl/dex/chat")
                    .post(payload.toString().toRequestBody(jsonType))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer $token")
                    .build()
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        val body = response.body?.string().orEmpty()
                        throw IOException(body.ifBlank { "Background Dex chat failed with ${response.code}" })
                    }
                    val json = JSONObject(response.body?.string().orEmpty())
                    json.optString("reply").ifBlank { getString(R.string.wake_mode_fallback_reply) }
                }
            }.getOrElse { error ->
                logBackgroundRecognizerEvent("background wake command failed: ${error.message ?: "unknown error"}")
                getString(R.string.wake_mode_fallback_reply)
            }
            mainHandler.post {
                speakShortStatus(spokenReply)
            }
        }.start()
    }

    private fun backgroundSpeechErrorLabel(error: Int): String {
        return when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "audio error"
            SpeechRecognizer.ERROR_CLIENT -> "client error"
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission error"
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network error"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy recognizer"
            SpeechRecognizer.ERROR_SERVER -> "server error"
            SpeechRecognizer.ERROR_TOO_MANY_REQUESTS -> "too many requests"
            else -> "speech error $error"
        }
    }

    private fun BackgroundListenMode.diagnosticLabel(): String {
        return when (this) {
            BackgroundListenMode.GENERAL_COMMAND -> "general wake listening"
            BackgroundListenMode.CALL_COMMAND -> "call command listening"
            BackgroundListenMode.SMS_COMMAND -> "sms prompt listening"
            BackgroundListenMode.SMS_REPLY -> "sms reply listening"
            BackgroundListenMode.NOTIFICATION_COMMAND -> "notification listening"
            BackgroundListenMode.SAFETY_CHECK_IN -> "safety check-in listening"
            BackgroundListenMode.CALLER_MESSAGE -> "caller message listening"
            BackgroundListenMode.REMINDER_CHECK_IN -> "reminder check-in listening"
        }
    }

    @Suppress("DEPRECATION")
    private fun enableSpeakerForActiveCall() {
        runCatching {
            audioManager?.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager?.isSpeakerphoneOn = true
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

    private fun speakNow(text: String) {
        textToSpeech?.setSpeechRate(DEX_TTS_BACKGROUND_RATE)
        textToSpeech?.setPitch(DEX_TTS_PITCH)
        textToSpeech?.speak(
            text,
            TextToSpeech.QUEUE_FLUSH,
            null,
            "dex_bg_status_${System.currentTimeMillis()}"
        )
    }

    private fun postCallEvent(event: String, caller: String) {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val token = prefs.getString(MainActivity.KEY_TOKEN, null) ?: return
        val serverUrl = prefs.getString(MainActivity.KEY_SERVER_URL, MainActivity.DEFAULT_SERVER_URL)?.trimEnd('/') ?: return

        Thread {
            runCatching {
                val payload = JSONObject().apply {
                    put("event", event)
                    put("caller", caller)
                    put("timestamp", System.currentTimeMillis())
                }
                val request = Request.Builder()
                    .url("$serverUrl/dex/call-event")
                    .post(payload.toString().toRequestBody(jsonType))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer $token")
                    .build()
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        val body = response.body?.string().orEmpty()
                        throw IOException(body.ifBlank { "Background call event failed with ${response.code}" })
                    }
                }
            }
        }.start()
    }

    companion object {
        private const val CHANNEL_ID = "dex_background_service"
        private const val ACTION_CHANNEL_ID = "dex_background_actions"
        private const val NOTIFICATION_ID = 4107
        private const val CALL_NOTIFICATION_ID = 4108
        private const val SMS_NOTIFICATION_ID = 4109
        private const val NOTIFICATION_PROMPT_ID = 4110
        const val ACTION_ANNOUNCE_SMS = "com.konvictartz.dex.action.ANNOUNCE_SMS"
        const val ACTION_ANNOUNCE_NOTIFICATION = "com.konvictartz.dex.action.ANNOUNCE_NOTIFICATION"
        const val ACTION_SAFETY_CHECK_IN = "com.konvictartz.dex.action.SAFETY_CHECK_IN"
        const val ACTION_REMINDER_CHECK_IN = "com.konvictartz.dex.action.REMINDER_CHECK_IN"
        const val ACTION_CALL_ANSWER = "com.konvictartz.dex.action.CALL_ANSWER"
        const val ACTION_CALL_DECLINE = "com.konvictartz.dex.action.CALL_DECLINE"
        const val ACTION_CALL_TAKE_MESSAGE = "com.konvictartz.dex.action.CALL_TAKE_MESSAGE"
        const val ACTION_SMS_READ = "com.konvictartz.dex.action.SMS_READ"
        const val ACTION_SMS_IGNORE = "com.konvictartz.dex.action.SMS_IGNORE"
        const val ACTION_SMS_REPLY = "com.konvictartz.dex.action.SMS_REPLY"
        const val ACTION_NOTIFICATION_READ = "com.konvictartz.dex.action.NOTIFICATION_READ"
        const val ACTION_NOTIFICATION_IGNORE = "com.konvictartz.dex.action.NOTIFICATION_IGNORE"
        const val EXTRA_SMS_SENDER = "extra_sms_sender"
        const val EXTRA_SMS_BODY = "extra_sms_body"
        const val EXTRA_NOTIFICATION_APP = "extra_notification_app"
        const val EXTRA_NOTIFICATION_TITLE = "extra_notification_title"
        const val EXTRA_NOTIFICATION_TEXT = "extra_notification_text"
        const val KEY_REMOTE_REPLY_TEXT = "dex_remote_reply_text"
        private const val AUTO_TAKE_MESSAGE_DELAY_MS = 5500L
        private const val CALL_MESSAGE_END_DELAY_MS = 1200L
        private const val MAX_CALL_MESSAGE_CAPTURE_ATTEMPTS = 2
        private const val MAX_NOTIFICATION_COMMAND_ATTEMPTS = 2
        private const val MAX_SAFETY_CHECK_IN_ATTEMPTS = 2
        private const val SAFETY_MEMORY_WINDOW_MS = 6 * 60 * 60 * 1000L
        private const val MIN_CALL_MESSAGE_LENGTH = 8
        private const val MIN_CALL_MESSAGE_WORDS = 3
        private const val DEX_TTS_BACKGROUND_RATE = 0.88f
        private const val DEX_TTS_PITCH = 0.95f
        private const val BACKGROUND_RECOGNIZER_RECOVERY_DELAY_MS = 900L
        private const val MAX_BACKGROUND_RECOGNIZER_RECOVERY_ATTEMPTS = 2
    }
}
