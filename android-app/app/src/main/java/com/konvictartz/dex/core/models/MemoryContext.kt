package com.konvictartz.dex.core.models

data class MemoryContext(
    val userId: String,
    val facts: Map<String, String> = emptyMap(),
    val recentCommands: List<DexCommand> = emptyList(),
)
