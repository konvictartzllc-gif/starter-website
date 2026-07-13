package com.konvictartz.dex.core.models

enum class DexIntent {
    OPEN_APP,
    OPEN_MEDIA,
    START_CALL,
    SEND_SMS,
    REMIND,
    SYNC_MEMORY,
    UNKNOWN,
}

data class DexCommand(
    val intent: DexIntent,
    val target: String = "",
    val device: String = "ANDROID",
    val rawText: String = "",
    val parameters: Map<String, String> = emptyMap(),
)
