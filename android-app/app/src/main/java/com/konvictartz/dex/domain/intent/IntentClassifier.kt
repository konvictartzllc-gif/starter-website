package com.konvictartz.dex.domain.intent

import com.konvictartz.dex.core.models.DexCommand
import com.konvictartz.dex.core.models.DexIntent

class IntentClassifier {
    fun classify(text: String): DexCommand {
        val trimmed = text.trim()
        val normalized = trimmed.lowercase()
        val youtubeCommand = extractYouTubeOpenCommand(trimmed)
        if (youtubeCommand != null) return youtubeCommand

        val openTarget = Regex(
            "^(?:open|launch|start|pull up|take me to|show me|bring up)\\s+(?:my\\s+)?(.+?)$",
            RegexOption.IGNORE_CASE,
        ).find(trimmed)?.groupValues?.getOrNull(1)

        if (!openTarget.isNullOrBlank()) {
            return DexCommand(
                intent = DexIntent.OPEN_APP,
                target = cleanAppTarget(openTarget),
                rawText = trimmed,
            )
        }

        if (
            normalized.startsWith("play ") ||
            normalized.contains("open youtube") ||
            normalized.contains("youtube music")
        ) {
            return DexCommand(
                intent = DexIntent.OPEN_MEDIA,
                target = cleanMediaTarget(trimmed),
                rawText = trimmed,
            )
        }

        return when {
            normalized.startsWith("call ") || normalized.contains(" phone ") ->
                DexCommand(DexIntent.START_CALL, target = trimmed.removePrefix("call ").trim(), rawText = trimmed)
            normalized.startsWith("text ") || normalized.startsWith("message ") ->
                DexCommand(DexIntent.SEND_SMS, target = trimmed, rawText = trimmed)
            normalized.startsWith("remind ") || normalized.contains(" reminder") ->
                DexCommand(DexIntent.REMIND, target = trimmed, rawText = trimmed)
            else -> DexCommand(DexIntent.UNKNOWN, rawText = trimmed)
        }
    }

    private fun cleanAppTarget(value: String): String =
        value
            .replace(Regex("^the\\s+", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s+app$", RegexOption.IGNORE_CASE), "")
            .trim()

    private fun cleanMediaTarget(value: String): String =
        value
            .replace(Regex("^(?:play|open|put on|pull up)\\s+", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\b(?:on\\s+)?(?:youtube|youtube music|music|video|song|track)\\b", RegexOption.IGNORE_CASE), " ")
            .replace(Regex("\\s+"), " ")
            .trim()

    private fun extractYouTubeOpenCommand(value: String): DexCommand? {
        val match = Regex(
            "^(?:open|launch|start|pull up)\\s+(?:the\\s+)?(?:youtube|yt)(?:\\s+app)?(?:\\s+(?:and\\s+)?(?:play|search|look up|find)\\s+(.+))?$",
            RegexOption.IGNORE_CASE,
        ).find(value.trim()) ?: return null
        val query = match.groupValues.getOrNull(1)
            ?.replace(Regex("\\b(?:some\\s+)?(?:music|video|song|track)\\b", RegexOption.IGNORE_CASE), " ")
            ?.replace(Regex("\\s+"), " ")
            ?.trim()
            .orEmpty()
        return DexCommand(
            intent = DexIntent.OPEN_APP,
            target = "YouTube",
            rawText = value.trim(),
            parameters = if (query.isBlank()) emptyMap() else mapOf("query" to query),
        )
    }
}
