package com.konvictartz.dex.features.apps

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.konvictartz.dex.core.models.DexCommand
import com.konvictartz.dex.core.models.DexResponse

class MediaController(private val context: Context) {
    fun play(target: String, command: DexCommand? = null): DexResponse {
        val query = target.trim()
        val uri = if (query.isBlank()) {
            Uri.parse("https://www.youtube.com")
        } else {
            Uri.parse("https://www.youtube.com/results?search_query=${Uri.encode(query)}")
        }
        return open(uri, if (query.isBlank()) "Opening YouTube." else "Opening YouTube and playing $query.", command)
    }

    fun openYouTubeMusic(target: String, command: DexCommand? = null): DexResponse {
        val query = target.trim()
        val uri = if (query.isBlank()) {
            Uri.parse("https://music.youtube.com")
        } else {
            Uri.parse("https://music.youtube.com/search?q=${Uri.encode(query)}")
        }
        return open(uri, if (query.isBlank()) "Opening YouTube Music." else "Opening YouTube Music for $query.", command)
    }

    private fun open(uri: Uri, reply: String, command: DexCommand?): DexResponse =
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            DexResponse(reply, command, handled = true)
        } catch (error: Exception) {
            DexResponse("I could not open media right now.", command, handled = true, error = error.message)
        }
}
