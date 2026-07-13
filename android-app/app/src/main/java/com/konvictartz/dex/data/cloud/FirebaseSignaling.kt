package com.konvictartz.dex.data.cloud

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class FirebaseSignaling(
    private val baseUrl: String,
    private val tokenProvider: () -> String?,
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun publishSignal(userId: String, type: String, payload: Map<String, String>) {
        val token = tokenProvider().orEmpty()
        if (baseUrl.isBlank() || token.isBlank()) return
        val body = JSONObject()
            .put("userId", userId)
            .put("type", type)
            .put("payload", JSONObject(payload))
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/dex/signals")
            .header("Authorization", "Bearer $token")
            .post(body.toString().toRequestBody(jsonType))
            .build()
        client.newCall(request).execute().close()
    }
}
