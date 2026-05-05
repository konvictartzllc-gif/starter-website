package com.konvictartz.dex

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Telephony
import androidx.core.content.ContextCompat

class DexSmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
            return
        }

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) return

        val sender = messages.firstOrNull()?.displayOriginatingAddress?.trim().orEmpty()
        val body = messages.joinToString(separator = "") { it.messageBody.orEmpty() }.trim()
        if (sender.isBlank() || body.isBlank()) return

        val signature = "${sender.lowercase()}|${body.lowercase()}"
        context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(MainActivity.KEY_LAST_SMS_EVENT_SIGNATURE, signature)
            .putLong(MainActivity.KEY_LAST_SMS_EVENT_AT, System.currentTimeMillis())
            .apply()

        val serviceIntent = Intent(context, DexForegroundService::class.java).apply {
            action = DexForegroundService.ACTION_ANNOUNCE_SMS
            putExtra(DexForegroundService.EXTRA_SMS_SENDER, sender)
            putExtra(DexForegroundService.EXTRA_SMS_BODY, body)
        }
        ContextCompat.startForegroundService(context, serviceIntent)
    }
}
