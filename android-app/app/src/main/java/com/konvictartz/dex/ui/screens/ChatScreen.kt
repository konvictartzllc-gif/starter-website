package com.konvictartz.dex.ui.screens

import android.content.Context
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.konvictartz.dex.ui.components.DexMicButton

class ChatScreen {
    val route = "chat"

    fun create(context: Context, status: String, onMic: () -> Unit): View =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
            addView(TextView(context).apply { text = status })
            addView(DexMicButton(context).apply {
                setListening(false)
                setOnClickListener { onMic() }
            })
        }
}
