package com.konvictartz.dex.data.cloud

import com.konvictartz.dex.core.models.MemoryContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class FirebaseMemorySource(
    private val baseUrl: String,
    private val tokenProvider: () -> String?,
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun pushMemory(context: MemoryContext) {
        val payload = JSONObject()
            .put("key", "dex_memory_context")
            .put("value", JSONObject(context.facts).toString())
        post("/dex/memory", payload)
    }

    suspend fun pullMemory(userId: String): MemoryContext? {
        val response = get("/dex/memory") ?: return null
        val memory = response.optJSONObject("memory") ?: JSONObject()
        val facts = mutableMapOf<String, String>()
        memory.keys().forEach { key -> facts[key] = memory.optString(key) }
        return MemoryContext(userId = userId, facts = facts)
    }

    private fun get(path: String): JSONObject? {
        val token = tokenProvider().orEmpty()
        if (baseUrl.isBlank() || token.isBlank()) return null
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}$path")
            .header("Authorization", "Bearer $token")
            .build()
        return client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) null else JSONObject(response.body?.string().orEmpty())
        }
    }

    private fun post(path: String, payload: JSONObject) {
        val token = tokenProvider().orEmpty()
        if (baseUrl.isBlank() || token.isBlank()) return
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}$path")
            .header("Authorization", "Bearer $token")
            .post(payload.toString().toRequestBody(jsonType))
            .build()
        client.newCall(request).execute().close()
    }
}
