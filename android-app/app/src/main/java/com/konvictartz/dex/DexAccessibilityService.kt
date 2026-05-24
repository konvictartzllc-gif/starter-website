package com.konvictartz.dex

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

class DexAccessibilityService : AccessibilityService() {
    override fun onServiceConnected() {
        instance = this
        serviceInfo = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                AccessibilityEvent.TYPE_VIEW_CLICKED or
                AccessibilityEvent.TYPE_VIEW_FOCUSED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
            notificationTimeout = 120L
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        lastPackageName = event?.packageName?.toString().orEmpty()
        lastClassName = event?.className?.toString().orEmpty()
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    companion object {
        @Volatile
        private var instance: DexAccessibilityService? = null
        @Volatile
        var lastPackageName: String = ""
            private set
        @Volatile
        var lastClassName: String = ""
            private set

        fun isRunning(): Boolean = instance != null

        fun performBack(): Boolean =
            instance?.performGlobalAction(GLOBAL_ACTION_BACK) == true

        fun performHome(): Boolean =
            instance?.performGlobalAction(GLOBAL_ACTION_HOME) == true

        fun currentScreenText(limit: Int = 40): List<String> {
            val root = instance?.rootInActiveWindow ?: return emptyList()
            val values = mutableListOf<String>()
            collectText(root, values, limit)
            return values
        }

        private fun collectText(node: AccessibilityNodeInfo?, values: MutableList<String>, limit: Int) {
            if (node == null || values.size >= limit) return
            val text = node.text?.toString()?.trim().orEmpty()
            val description = node.contentDescription?.toString()?.trim().orEmpty()
            if (text.isNotBlank()) values += text
            if (description.isNotBlank() && description != text) values += description
            for (index in 0 until node.childCount) {
                collectText(node.getChild(index), values, limit)
                if (values.size >= limit) break
            }
        }
    }
}
