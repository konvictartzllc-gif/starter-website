package com.konvictartz.dex.features.notifications

interface NotificationActions {
    fun readLatest()
    fun reply(text: String)
}
