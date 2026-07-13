package com.konvictartz.dex.core.utils

import com.konvictartz.dex.core.models.DexCommand
import com.konvictartz.dex.core.models.DexIntent
import org.json.JSONObject

object JsonParser {
    fun parseDexCommand(json: String): DexCommand {
        val body = JSONObject(json)
        val intent = runCatching { DexIntent.valueOf(body.optString("intent", "UNKNOWN")) }
            .getOrDefault(DexIntent.UNKNOWN)
        return DexCommand(
            intent = intent,
            target = body.optString("target"),
            device = body.optString("device", "ANDROID"),
            rawText = body.optString("rawText"),
        )
    }

    fun toJson(command: DexCommand): JSONObject =
        JSONObject()
            .put("intent", command.intent.name)
            .put("target", command.target)
            .put("device", command.device)
            .put("rawText", command.rawText)
}
