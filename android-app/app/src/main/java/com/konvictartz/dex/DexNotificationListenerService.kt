package com.konvictartz.dex

import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class DexNotificationListenerService : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn?.notification ?: return
        val packageName = sbn.packageName ?: return
        if (packageName == packageName()) return
        if (notification.flags and android.app.Notification.FLAG_ONGOING_EVENT != 0) return
        if (notification.flags and android.app.Notification.FLAG_GROUP_SUMMARY != 0) return

        val extras = notification.extras
        val title = extras?.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val text = extras?.getCharSequence(android.app.Notification.EXTRA_TEXT)?.toString()?.trim().orEmpty()
        val appLabel = runCatching {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0)).toString()
        }.getOrDefault(packageName)

        if (title.isBlank() && text.isBlank()) return

        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, MODE_PRIVATE)
        val notificationsEnabled = prefs.getBoolean(MainActivity.KEY_NOTIFICATIONS_ENABLED, false)
        val hasToken = !prefs.getString(MainActivity.KEY_TOKEN, null).isNullOrBlank()
        val appInForeground = prefs.getBoolean(MainActivity.KEY_APP_IN_FOREGROUND, false)
        if (!notificationsEnabled || !hasToken || appInForeground) return

        val content = if (text.isNotBlank()) text else title
        prefs.edit()
            .putString(MainActivity.KEY_PENDING_NOTIFICATION_APP, appLabel)
            .putString(MainActivity.KEY_PENDING_NOTIFICATION_TITLE, title)
            .putString(MainActivity.KEY_PENDING_NOTIFICATION_TEXT, content)
            .apply()

        val intent = Intent(this, DexForegroundService::class.java).apply {
            action = DexForegroundService.ACTION_ANNOUNCE_NOTIFICATION
            putExtra(DexForegroundService.EXTRA_NOTIFICATION_APP, appLabel)
            putExtra(DexForegroundService.EXTRA_NOTIFICATION_TITLE, title)
            putExtra(DexForegroundService.EXTRA_NOTIFICATION_TEXT, content)
        }
        startForegroundService(intent)
    }

    private fun packageName(): String = applicationContext.packageName
}
