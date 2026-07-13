package com.konvictartz.dex.data.repositories

import com.konvictartz.dex.data.local.PreferencesStore

class SettingsRepository(private val preferencesStore: PreferencesStore) {
    fun get(key: String): String = preferencesStore.getString(key)
    fun set(key: String, value: String) = preferencesStore.putString(key, value)
}
