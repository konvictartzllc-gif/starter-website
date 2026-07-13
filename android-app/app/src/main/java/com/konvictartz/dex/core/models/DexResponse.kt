package com.konvictartz.dex.core.models

data class DexResponse(
    val spokenText: String,
    val command: DexCommand? = null,
    val handled: Boolean = false,
    val error: String? = null,
)
