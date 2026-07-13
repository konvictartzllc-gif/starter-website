package com.konvictartz.dex.app.navigation

enum class DexRoute(val route: String) {
    HOME("home"),
    CHAT("chat"),
    SETTINGS("settings"),
    PERMISSIONS("permissions"),
    CONTACTS("contacts"),
    PHONE_SETUP("phone_setup"),
}

object DexNavigationGraph {
    val startDestination: DexRoute = DexRoute.HOME
    val routes: List<DexRoute> = DexRoute.entries
}
