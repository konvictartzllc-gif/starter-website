package com.konvictartz.dex.data.local

class MemoryDao {
    private val values = linkedMapOf<String, String>()

    fun put(key: String, value: String) {
        values[key] = value
    }

    fun get(key: String): String? = values[key]

    fun all(): Map<String, String> = values.toMap()
}
