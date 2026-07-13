package com.konvictartz.dex.ui.screens

import android.content.Context
import android.view.View
import com.konvictartz.dex.ui.components.DexCard

class ContactsScreen {
    val route = "contacts"

    fun create(context: Context): View =
        DexCard(context).apply { bind("Contacts", "Caller names, aliases, and trusted contact routing.") }
}
