package com.konvictartz.dex.domain.intent

object ActionMapper {
    fun canonicalAppName(target: String): String {
        val normalized = target.trim().lowercase()
        return when {
            normalized.contains("youtube music") -> "YouTube Music"
            normalized.contains("youtube") -> "YouTube"
            normalized.contains("gmail") || normalized == "email" || normalized == "mail" -> "Gmail"
            normalized.contains("maps") -> "Google Maps"
            normalized.contains("calendar") -> "Calendar"
            normalized.contains("camera") -> "Camera"
            normalized.contains("settings") -> "Settings"
            normalized.contains("phone") || normalized.contains("dialer") -> "Phone"
            else -> target.trim()
        }
    }
}
