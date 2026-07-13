package com.konvictartz.dex.ui.screens

import android.content.Context
import android.view.View
import com.konvictartz.dex.ui.components.DexCard

class SettingsScreen {
    val route = "settings"

    fun create(context: Context): View =
        DexCard(context).apply { bind("Settings", "Manage Dex server, account, voice, memory, and permissions.") }
}
