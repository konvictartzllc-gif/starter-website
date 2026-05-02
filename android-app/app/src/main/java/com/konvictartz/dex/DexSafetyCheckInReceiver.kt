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

        DexSafetyCheckInScheduler.showCheckInNotification(context, title, text)
        val serviceIntent = Intent(context, DexForegroundService::class.java).apply {
            action = DexForegroundService.ACTION_SAFETY_CHECK_IN
            putExtra(DexSafetyCheckInScheduler.EXTRA_TITLE, title)
            putExtra(DexSafetyCheckInScheduler.EXTRA_TEXT, text)
        }
        androidx.core.content.ContextCompat.startForegroundService(context, serviceIntent)
    }
}
