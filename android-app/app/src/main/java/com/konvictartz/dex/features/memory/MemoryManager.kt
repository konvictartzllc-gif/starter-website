package com.konvictartz.dex.features.memory

class MemoryManager {
    private val facts = linkedMapOf<String, String>()

    fun remember(key: String, value: String) {
        facts[key] = value
    }

    fun recall(key: String): String? = facts[key]
}
