package com.konvictartz.dex

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class DexLearningReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val title = intent?.getStringExtra(DexLearningReminderScheduler.EXTRA_TITLE)
            ?: context.getString(R.string.learning_reminder_title)
        val text = intent?.getStringExtra(DexLearningReminderScheduler.EXTRA_TEXT)
            ?: context.getString(R.string.learning_reminder_text)

        DexLearningReminderScheduler.showReminderNotification(context, title, text)
        DexLearningReminderScheduler.rescheduleFromPrefs(context)
    }
}
