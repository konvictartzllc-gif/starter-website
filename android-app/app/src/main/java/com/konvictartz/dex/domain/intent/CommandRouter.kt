package com.konvictartz.dex.domain.intent

import com.konvictartz.dex.core.models.DexCommand
import com.konvictartz.dex.core.models.DexIntent

enum class DexActionRoute {
    OPEN_APP,
    OPEN_MEDIA,
    START_CALL,
    SEND_SMS,
    REMIND,
    AI_FALLBACK,
}

class CommandRouter {
    fun route(command: DexCommand): DexActionRoute =
        when (command.intent) {
            DexIntent.OPEN_APP -> DexActionRoute.OPEN_APP
            DexIntent.OPEN_MEDIA -> DexActionRoute.OPEN_MEDIA
            DexIntent.START_CALL -> DexActionRoute.START_CALL
            DexIntent.SEND_SMS -> DexActionRoute.SEND_SMS
            DexIntent.REMIND -> DexActionRoute.REMIND
            DexIntent.SYNC_MEMORY, DexIntent.UNKNOWN -> DexActionRoute.AI_FALLBACK
        }
}
