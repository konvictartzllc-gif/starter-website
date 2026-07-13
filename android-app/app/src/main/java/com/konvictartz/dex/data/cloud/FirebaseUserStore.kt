package com.konvictartz.dex.data.cloud

import com.konvictartz.dex.core.models.UserProfile
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class FirebaseUserStore(
    private val baseUrl: String,
    private val tokenProvider: () -> String?,
    private val client: OkHttpClient = OkHttpClient(),
) {
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    suspend fun getUser(userId: String): UserProfile? {
        val token = tokenProvider().orEmpty()
        if (baseUrl.isBlank() || token.isBlank()) return null
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/auth/me")
            .header("Authorization", "Bearer $token")
            .build()
        return client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            val body = JSONObject(response.body?.string().orEmpty())
            val user = body.optJSONObject("user") ?: body
            UserProfile(
                id = user.optString("id", userId),
                name = user.optString("name"),
                email = user.optString("email"),
                accessType = user.optString("access_type"),
            )
        }
    }

    suspend fun saveUser(profile: UserProfile) {
        val token = tokenProvider().orEmpty()
        if (baseUrl.isBlank() || token.isBlank()) return
        val body = JSONObject()
            .put("name", profile.name)
            .put("email", profile.email)
        val request = Request.Builder()
            .url("${baseUrl.trimEnd('/')}/dex/preferences")
            .header("Authorization", "Bearer $token")
            .post(body.toString().toRequestBody(jsonType))
            .build()
        client.newCall(request).execute().close()
    }
}
