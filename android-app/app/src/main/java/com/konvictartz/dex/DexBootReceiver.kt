package com.konvictartz.dex

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class DexBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return

        DexLearningReminderScheduler.rescheduleFromPrefs(context)

        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val autoStartEnabled = prefs.getBoolean(MainActivity.KEY_AUTO_START_ASSISTANT, false)
        val shouldRun = prefs.getBoolean(MainActivity.KEY_BACKGROUND_SERVICE_ENABLED, false)
        val hasToken = !prefs.getString(MainActivity.KEY_TOKEN, null).isNullOrBlank()
        if (!autoStartEnabled || !shouldRun || !hasToken) return

        val serviceIntent = Intent(context, DexForegroundService::class.java)
        ContextCompat.startForegroundService(context, serviceIntent)
    }
}
