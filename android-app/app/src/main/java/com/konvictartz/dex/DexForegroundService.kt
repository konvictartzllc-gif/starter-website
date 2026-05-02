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
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.ContactsContract
import android.provider.Telephony
import android.telephony.SmsManager
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.speech.tts.TextToSpeech
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

class DexForegroundService : Service(), TextToSpeech.OnInitListener {
    private val client = OkHttpClient()
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private var telephonyManager: TelephonyManager? = null
    private var telecomManager: TelecomManager? = null
    private var phoneStateListener: PhoneStateListener? = null
    private var textToSpeech: TextToSpeech? = null
    private var ttsReady = false
    private var lastCallState = TelephonyManager.CALL_STATE_IDLE
    private var lastCaller = "Unknown caller"
    private var currentCallWasAnswered = false
    private var pendingSpeechText: String? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
        telephonyManager = getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        telecomManager = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
        textToSpeech = TextToSpeech(this, this)
        startCallMonitoringIfReady()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(NOTIFICATION_ID, buildNotification())
        when (intent?.action) {
            ACTION_ANNOUNCE_SMS -> handleIncomingSms(intent)
            ACTION_CALL_ANSWER -> handleCallAnswerAction()
            ACTION_CALL_DECLINE -> handleCallDeclineAction()
            ACTION_SMS_READ -> handleSmsReadAction()
            ACTION_SMS_IGNORE -> handleSmsIgnoreAction()
            ACTION_SMS_REPLY -> handleSmsReplyAction(intent)
        }
        startCallMonitoringIfReady()
        return START_STICKY
    }

    override fun onDestroy() {
        stopCallMonitoring()
        textToSpeech?.stop()
        textToSpeech?.shutdown()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) {
            ttsReady = false
            return
        }
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
            hasPermission(Manifest.permission.ANSWER_PHONE_CALLS)
    }

    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
    }

    @SuppressLint("MissingPermission")
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
        currentCallWasAnswered = false
    }

    private fun handleCallStateChanged(state: Int, phoneNumber: String?) {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        if (prefs.getBoolean(MainActivity.KEY_APP_IN_FOREGROUND, false)) {
            lastCallState = state
            return
        }
        val rawNumber = phoneNumber?.trim().orEmpty()
        val resolvedCaller = resolveCallerLabel(phoneNumber)
        val autoDeclineSpam = prefs.getBoolean(MainActivity.KEY_AUTO_DECLINE_SPAM, true)
        when (state) {
            TelephonyManager.CALL_STATE_RINGING -> {
                currentCallWasAnswered = false
                lastCaller = resolvedCaller
                if (autoDeclineSpam && isLikelySpamCaller(resolvedCaller, phoneNumber)) {
                    postCallEvent("declined", resolvedCaller)
                    declineRingingCall()
                    speakShortStatus(getString(R.string.call_spam_blocked))
                } else {
                    postCallEvent("incoming", resolvedCaller)
                    showIncomingCallNotification(resolvedCaller)
                    speakIncomingCallPrompt(resolvedCaller)
                }
            }
            TelephonyManager.CALL_STATE_OFFHOOK -> {
                currentCallWasAnswered = true
                dismissNotification(CALL_NOTIFICATION_ID)
                if (lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                    postCallEvent("answered", resolvedCaller)
                }
            }
            TelephonyManager.CALL_STATE_IDLE -> {
                dismissNotification(CALL_NOTIFICATION_ID)
                if (lastCallState == TelephonyManager.CALL_STATE_RINGING && !currentCallWasAnswered) {
                    postCallEvent("declined", resolvedCaller)
                }
                lastCaller = "Unknown caller"
                currentCallWasAnswered = false
            }
        }
        lastCallState = state
    }

    private fun resolveCallerLabel(phoneNumber: String?): String {
        val rawNumber = phoneNumber?.trim().orEmpty()
        if (rawNumber.isBlank()) {
            return lastCaller.takeUnless { it.isBlank() || it == "Unknown caller" } ?: getString(R.string.private_number_label)
        }
        val contactName = lookupContactName(rawNumber)
        return contactName ?: rawNumber
    }

    private fun lookupContactName(phoneNumber: String): String? {
        if (!hasPermission(Manifest.permission.READ_CONTACTS)) return null
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
        return rawNumber.startsWith("000")
    }

    private fun speakIncomingCallPrompt(caller: String) {
        speakShortStatus(getString(R.string.call_background_prompt_template, caller))
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
        prefs.edit()
            .putString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, sender)
            .putString(MainActivity.KEY_PENDING_INCOMING_SMS_VALUE, rawSender)
            .putString(MainActivity.KEY_PENDING_INCOMING_SMS_BODY, smsBody)
            .apply()

        showIncomingSmsNotification(sender, smsBody)
        speakShortStatus(getString(R.string.incoming_sms_prompt, sender))
    }

    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    private fun answerRingingCall() {
        if (!hasPermission(Manifest.permission.ANSWER_PHONE_CALLS)) return
        try {
            val manager = telecomManager ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.acceptRingingCall()
            }
        } catch (_: Exception) {
            // Some OEMs can still block background answering. We leave the call ringing if that happens.
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

    private fun handleCallAnswerAction() {
        answerRingingCall()
        currentCallWasAnswered = true
        dismissNotification(CALL_NOTIFICATION_ID)
        speakShortStatus(getString(R.string.call_answered))
    }

    private fun handleCallDeclineAction() {
        declineRingingCall()
        dismissNotification(CALL_NOTIFICATION_ID)
        speakShortStatus(getString(R.string.call_declined))
    }

    private fun handleSmsReadAction() {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val sender = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, null)
        val body = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_BODY, null)
        if (!sender.isNullOrBlank() && !body.isNullOrBlank()) {
            speakShortStatus(getString(R.string.incoming_sms_readback, sender, body))
        }
    }

    private fun handleSmsIgnoreAction() {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val sender = prefs.getString(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER, "that sender").orEmpty()
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

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            speakShortStatus(getString(R.string.sms_send_permission_missing))
            return
        }

        runCatching {
            @Suppress("DEPRECATION")
            val smsManager = SmsManager.getDefault()
            smsManager.sendTextMessage(senderValue, null, replyText, null, null)
        }.onSuccess {
            clearPendingIncomingSms()
            dismissNotification(SMS_NOTIFICATION_ID)
            speakShortStatus(getString(R.string.sms_sent_directly, sender))
        }.onFailure {
            speakShortStatus(getString(R.string.sms_send_failed, sender))
        }
    }

    private fun showIncomingCallNotification(caller: String) {
        val openAppIntent = PendingIntent.getActivity(
            this,
            100,
            Intent(this, MainActivity::class.java),
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

        val notification = NotificationCompat.Builder(this, ACTION_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(getString(R.string.call_notification_title, caller))
            .setContentText(getString(R.string.call_notification_text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setContentIntent(openAppIntent)
            .addAction(0, getString(R.string.answer_call), answerIntent)
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

    private fun clearPendingIncomingSms() {
        getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .remove(MainActivity.KEY_PENDING_INCOMING_SMS_SENDER)
            .remove(MainActivity.KEY_PENDING_INCOMING_SMS_VALUE)
            .remove(MainActivity.KEY_PENDING_INCOMING_SMS_BODY)
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

    private fun speakNow(text: String) {
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
        const val ACTION_ANNOUNCE_SMS = "com.konvictartz.dex.action.ANNOUNCE_SMS"
        const val ACTION_CALL_ANSWER = "com.konvictartz.dex.action.CALL_ANSWER"
        const val ACTION_CALL_DECLINE = "com.konvictartz.dex.action.CALL_DECLINE"
        const val ACTION_SMS_READ = "com.konvictartz.dex.action.SMS_READ"
        const val ACTION_SMS_IGNORE = "com.konvictartz.dex.action.SMS_IGNORE"
        const val ACTION_SMS_REPLY = "com.konvictartz.dex.action.SMS_REPLY"
        const val EXTRA_SMS_SENDER = "extra_sms_sender"
        const val EXTRA_SMS_BODY = "extra_sms_body"
        const val KEY_REMOTE_REPLY_TEXT = "dex_remote_reply_text"
    }
}
