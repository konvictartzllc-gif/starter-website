package com.konvictartz.dex

import android.Manifest
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
import android.telecom.TelecomManager
import android.telephony.PhoneStateListener
import android.telephony.TelephonyManager
import android.speech.tts.TextToSpeech
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
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
    private val mainHandler = Handler(Looper.getMainLooper())
    private var autoAnswerPending = false
    private val autoAnswerRunnable = Runnable {
        if (lastCallState == TelephonyManager.CALL_STATE_RINGING) {
            autoAnswerPending = true
            answerRingingCall()
        }
    }

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
        startCallMonitoringIfReady()
        return START_STICKY
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(autoAnswerRunnable)
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
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.background_service_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.background_service_channel_description)
            setShowBadge(false)
        }
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }

    private fun startCallMonitoringIfReady() {
        if (!shouldMonitorCalls()) return
        startCallMonitoring()
    }

    private fun shouldMonitorCalls(): Boolean {
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val phoneBackendEnabled = prefs.getBoolean(MainActivity.KEY_PHONE_BACKEND_ENABLED, false)
        val hasToken = !prefs.getString(MainActivity.KEY_TOKEN, null).isNullOrBlank()
        return hasToken &&
            phoneBackendEnabled &&
            hasPermission(Manifest.permission.READ_PHONE_STATE) &&
            hasPermission(Manifest.permission.ANSWER_PHONE_CALLS)
    }

    private fun hasPermission(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
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
        mainHandler.removeCallbacks(autoAnswerRunnable)
        autoAnswerPending = false
        lastCallState = TelephonyManager.CALL_STATE_IDLE
        lastCaller = "Unknown caller"
    }

    private fun handleCallStateChanged(state: Int, phoneNumber: String?) {
        val resolvedCaller = resolveCallerLabel(phoneNumber)
        when (state) {
            TelephonyManager.CALL_STATE_RINGING -> {
                lastCaller = resolvedCaller
                if (isLikelySpamCaller(resolvedCaller, phoneNumber)) {
                    mainHandler.removeCallbacks(autoAnswerRunnable)
                    autoAnswerPending = false
                    postCallEvent("declined", resolvedCaller)
                    declineRingingCall()
                } else {
                    postCallEvent("incoming", resolvedCaller)
                    speakIncomingCallPrompt(resolvedCaller)
                    mainHandler.removeCallbacks(autoAnswerRunnable)
                    mainHandler.postDelayed(autoAnswerRunnable, AUTO_ANSWER_DELAY_MS)
                }
            }
            TelephonyManager.CALL_STATE_OFFHOOK -> {
                mainHandler.removeCallbacks(autoAnswerRunnable)
                if (lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                    postCallEvent("answered", resolvedCaller)
                }
                autoAnswerPending = false
            }
            TelephonyManager.CALL_STATE_IDLE -> {
                mainHandler.removeCallbacks(autoAnswerRunnable)
                if (lastCallState == TelephonyManager.CALL_STATE_RINGING) {
                    if (!autoAnswerPending) {
                        postCallEvent("declined", resolvedCaller)
                    }
                }
                autoAnswerPending = false
                lastCaller = "Unknown caller"
            }
        }
        lastCallState = state
    }

    private fun resolveCallerLabel(phoneNumber: String?): String {
        val rawNumber = phoneNumber?.trim().orEmpty()
        if (rawNumber.isBlank()) {
            return if (lastCaller.isNotBlank()) lastCaller else "Unknown caller"
        }
        val contactName = lookupContactName(rawNumber)
        return contactName ?: rawNumber
    }

    private fun lookupContactName(phoneNumber: String): String? {
        if (!hasPermission(Manifest.permission.READ_CONTACTS)) return null
        val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(phoneNumber))
        val projection = arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME)
        val cursor: Cursor? = contentResolver.query(uri, projection, null, null, null)
        cursor?.use {
            if (it.moveToFirst()) {
                return it.getString(0)
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
        if (!ttsReady) return
        textToSpeech?.speak(
            getString(R.string.call_background_prompt_template, caller),
            TextToSpeech.QUEUE_FLUSH,
            null,
            "dex_bg_call_${System.currentTimeMillis()}"
        )
    }

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
        private const val NOTIFICATION_ID = 4107
        private const val AUTO_ANSWER_DELAY_MS = 1200L
    }
}
