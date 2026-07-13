package com.konvictartz.dex.data.local

import android.content.Context

class PreferencesStore(context: Context) {
    private val prefs = context.getSharedPreferences("dex_ai_preferences", Context.MODE_PRIVATE)

    fun putString(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    fun getString(key: String, fallback: String = ""): String = prefs.getString(key, fallback) ?: fallback
}
