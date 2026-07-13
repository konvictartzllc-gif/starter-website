package com.konvictartz.dex.ui.screens

import android.content.Context
import android.view.View
import com.konvictartz.dex.ui.components.DexCard

class PermissionsScreen {
    val route = "permissions"

    fun create(context: Context): View =
        DexCard(context).apply { bind("Permissions", "Microphone, calls, contacts, SMS, notifications, and accessibility.") }
}
