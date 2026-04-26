package com.konvictartz.dex

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

object DexLearningReminderScheduler {
    private const val REMINDER_REQUEST_CODE = 8224
    const val CHANNEL_ID = "dex_learning_reminders"
    const val EXTRA_TITLE = "extra_title"
    const val EXTRA_TEXT = "extra_text"

    fun scheduleDailyReminder(context: Context, reminderTime: String, title: String, text: String) {
        val triggerAtMillis = nextTriggerMillis(reminderTime)
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarmManager.cancel(createPendingIntent(context, title, text))
        alarmManager.setAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            triggerAtMillis,
            createPendingIntent(context, title, text)
        )
    }

    fun cancelReminder(context: Context) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        alarmManager.cancel(createPendingIntent(context, "", ""))
    }

    fun showReminderNotification(context: Context, title: String, text: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }

        createNotificationChannel(context)
        val openAppIntent = Intent(context, MainActivity::class.java)
        val contentIntent = PendingIntent.getActivity(
            context,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(contentIntent)
            .build()

        NotificationManagerCompat.from(context).notify(REMINDER_REQUEST_CODE, notification)
    }

    fun rescheduleFromPrefs(context: Context) {
        val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
        val enabled = prefs.getBoolean(MainActivity.KEY_LEARNING_REMINDER_ENABLED, false)
        val time = prefs.getString(MainActivity.KEY_LEARNING_REMINDER_TIME, "") ?: ""
        val title = prefs.getString(MainActivity.KEY_LEARNING_REMINDER_TITLE, context.getString(R.string.learning_reminder_title))
            ?: context.getString(R.string.learning_reminder_title)
        val text = prefs.getString(MainActivity.KEY_LEARNING_REMINDER_TEXT, context.getString(R.string.learning_reminder_text))
            ?: context.getString(R.string.learning_reminder_text)

        if (!enabled || time.isBlank()) {
            cancelReminder(context)
            return
        }

        scheduleDailyReminder(context, time, title, text)
    }

    private fun nextTriggerMillis(reminderTime: String): Long {
        val time = runCatching { LocalTime.parse(reminderTime) }.getOrDefault(LocalTime.of(18, 0))
        var triggerDateTime = LocalDateTime.now()
            .withHour(time.hour)
            .withMinute(time.minute)
            .withSecond(0)
            .withNano(0)

        if (!triggerDateTime.isAfter(LocalDateTime.now())) {
            triggerDateTime = triggerDateTime.plusDays(1)
        }

        return triggerDateTime
            .atZone(ZoneId.systemDefault())
            .toInstant()
            .toEpochMilli()
    }

    private fun createPendingIntent(context: Context, title: String, text: String): PendingIntent {
        val intent = Intent(context, DexLearningReminderReceiver::class.java).apply {
            putExtra(EXTRA_TITLE, title)
            putExtra(EXTRA_TEXT, text)
        }
        return PendingIntent.getBroadcast(
            context,
            REMINDER_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.learning_reminder_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = context.getString(R.string.learning_reminder_channel_description)
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(channel)
    }
}
