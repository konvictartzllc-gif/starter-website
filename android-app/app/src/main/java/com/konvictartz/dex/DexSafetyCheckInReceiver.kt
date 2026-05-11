package com.konvictartz.dex

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DexSafetyCheckInReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val title = intent?.getStringExtra(DexSafetyCheckInScheduler.EXTRA_TITLE)
            ?: context.getString(R.string.safety_check_in_title)
        val text = intent?.getStringExtra(DexSafetyCheckInScheduler.EXTRA_TEXT)
            ?: context.getString(R.string.safety_check_in_text)
        val voiceCheckIn = intent?.getBooleanExtra(DexSafetyCheckInScheduler.EXTRA_VOICE_CHECK_IN, false) == true
        val kind = intent?.getStringExtra(DexSafetyCheckInScheduler.EXTRA_KIND).orEmpty()
        val mood = intent?.getStringExtra(DexSafetyCheckInScheduler.EXTRA_MOOD).orEmpty()
        val emergencyFollowUp = intent?.getBooleanExtra(DexSafetyCheckInScheduler.EXTRA_IS_EMERGENCY, false) == true

        DexSafetyCheckInScheduler.showCheckInNotification(context, title, text)
        val serviceIntent = Intent(context, DexForegroundService::class.java).apply {
            action = if (voiceCheckIn) {
                if (kind == "safety") DexForegroundService.ACTION_SAFETY_CHECK_IN else DexForegroundService.ACTION_REMINDER_CHECK_IN
            } else {
                DexForegroundService.ACTION_SAFETY_CHECK_IN
            }
            putExtra(DexSafetyCheckInScheduler.EXTRA_TITLE, title)
            putExtra(DexSafetyCheckInScheduler.EXTRA_TEXT, text)
            putExtra(DexSafetyCheckInScheduler.EXTRA_KIND, kind)
            putExtra(DexSafetyCheckInScheduler.EXTRA_MOOD, mood)
            putExtra(DexSafetyCheckInScheduler.EXTRA_IS_EMERGENCY, emergencyFollowUp)
        }
        androidx.core.content.ContextCompat.startForegroundService(context, serviceIntent)
    }
}
