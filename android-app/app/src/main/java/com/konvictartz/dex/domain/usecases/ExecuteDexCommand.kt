package com.konvictartz.dex.domain.usecases

import com.konvictartz.dex.core.models.DexCommand
import com.konvictartz.dex.core.models.DexIntent
import com.konvictartz.dex.core.models.DexResponse
import com.konvictartz.dex.features.apps.AppLauncher
import com.konvictartz.dex.features.apps.MediaController
import com.konvictartz.dex.features.calls.TwilioCallService
import com.konvictartz.dex.features.sms.TextBeltService

class ExecuteDexCommand(
    private val appLauncher: AppLauncher,
    private val mediaController: MediaController,
    private val callService: TwilioCallService,
    private val smsService: TextBeltService,
) {
    fun execute(command: DexCommand): DexResponse =
        when (command.intent) {
            DexIntent.OPEN_APP -> {
                val query = command.parameters["query"].orEmpty()
                when {
                    command.target.equals("YouTube", ignoreCase = true) && query.isNotBlank() ->
                        mediaController.play(query, command)
                    command.target.equals("YouTube Music", ignoreCase = true) && query.isNotBlank() ->
                        mediaController.openYouTubeMusic(query, command)
                    else -> appLauncher.open(command.target, command)
                }
            }
            DexIntent.OPEN_MEDIA -> {
                if (command.rawText.contains("youtube music", ignoreCase = true)) {
                    mediaController.openYouTubeMusic(command.target, command)
                } else {
                    mediaController.play(command.target, command)
                }
            }
            DexIntent.START_CALL -> callService.startCall(command.target, command)
            DexIntent.SEND_SMS -> {
                val parsed = parseSms(command.target)
                smsService.send(parsed.first, parsed.second, command)
            }
            DexIntent.REMIND, DexIntent.SYNC_MEMORY, DexIntent.UNKNOWN ->
                DexResponse("", command, handled = false)
        }

    private fun parseSms(raw: String): Pair<String, String> {
        val match = Regex("^(?:text|message)\\s+(\\+?[0-9()\\- .]+)\\s+(.+)$", RegexOption.IGNORE_CASE).find(raw.trim())
        return if (match == null) "" to "" else match.groupValues[1] to match.groupValues[2]
    }
}
