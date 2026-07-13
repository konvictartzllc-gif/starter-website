package com.konvictartz.dex.features.calls

interface CallerIDManager {
    fun resolve(number: String): String?
}
