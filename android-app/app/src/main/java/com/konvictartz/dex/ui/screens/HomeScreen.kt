package com.konvictartz.dex.ui.screens

import android.content.Context
import android.view.View
import android.widget.LinearLayout
import com.konvictartz.dex.ui.components.DexButton
import com.konvictartz.dex.ui.components.DexCard

class HomeScreen {
    val route = "home"

    fun create(context: Context, onTalk: () -> Unit): View =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 24, 24, 24)
            addView(DexCard(context).apply { bind("Dex AI", "Voice, calls, SMS, memory, and Android actions are ready.") })
            addView(DexButton(context).apply { bind("Talk to Dex", onClick = onTalk) })
        }
}
