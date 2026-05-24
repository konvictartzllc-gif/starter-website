package com.konvictartz.dex

import android.content.Context
import android.content.Intent
import android.telecom.Call
import android.telecom.CallScreeningService
import androidx.core.content.ContextCompat
import java.util.Locale

class DexCallScreeningService : CallScreeningService() {
    override fun onScreenCall(callDetails: Call.Details) {
        val number = callDetails.handle?.schemeSpecificPart.orEmpty()
        val caller = number.ifBlank { getString(R.string.unknown_number_label) }
        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val phoneEnabled = prefs.getBoolean(MainActivity.KEY_PHONE_BACKEND_ENABLED, false)
        val autoDeclineSpam = prefs.getBoolean(MainActivity.KEY_AUTO_DECLINE_SPAM, true)
        val spam = isLikelySpam(number)

        if (phoneEnabled) {
            MainActivity.appendPersistentActivityLog(this, "Call screening", "Screened incoming call from $caller")
            val intent = Intent(this, DexForegroundService::class.java).apply {
                action = DexForegroundService.ACTION_CALL_SCREENED
                putExtra(DexForegroundService.EXTRA_CALL_IS_RINGING, true)
                putExtra(DexForegroundService.EXTRA_CALLER_NAME, caller)
                putExtra(DexForegroundService.EXTRA_CALLER_NUMBER, number)
            }
            ContextCompat.startForegroundService(this, intent)
        }

        val response = CallResponse.Builder()
            .setDisallowCall(phoneEnabled && autoDeclineSpam && spam)
            .setRejectCall(phoneEnabled && autoDeclineSpam && spam)
            .setSkipNotification(false)
            .setSkipCallLog(false)
            .build()

        respondToCall(callDetails, response)
    }

    private fun isLikelySpam(number: String): Boolean {
        val normalized = number.lowercase(Locale.US)
        val digits = normalized.filter { it.isDigit() }
        return normalized.contains("spam") ||
            normalized.contains("scam") ||
            normalized.contains("fraud") ||
            digits.startsWith("000")
    }
}
