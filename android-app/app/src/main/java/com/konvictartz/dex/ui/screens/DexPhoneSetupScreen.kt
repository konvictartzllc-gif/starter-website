package com.konvictartz.dex.ui.screens

import android.content.Context
import android.view.View
import com.konvictartz.dex.ui.components.DexCard

class DexPhoneSetupScreen {
    val route = "phone_setup"

    fun create(context: Context): View =
        DexCard(context).apply { bind("Dex Phone Setup", "Connect call screening, caller ID, SMS, and phone actions.") }
}
