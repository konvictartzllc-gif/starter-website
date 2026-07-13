package com.konvictartz.dex.features.apps

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Settings
import com.konvictartz.dex.core.models.DexCommand
import com.konvictartz.dex.core.models.DexResponse

class AppLauncher(private val context: Context) {
    fun open(target: String, command: DexCommand? = null): DexResponse {
        val launchTarget = resolveTarget(target)
            ?: return DexResponse("I could not find $target on this Android device.", command, handled = true, error = "app_not_found")
        val intent = launchTarget.packages
            .asSequence()
            .mapNotNull { context.packageManager.getLaunchIntentForPackage(it) }
            .firstOrNull()
            ?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            ?: launchTarget.actionIntent?.apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            ?: launchTarget.webUri?.let { Intent(Intent.ACTION_VIEW, it).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            ?: return DexResponse("${launchTarget.label} is not available on this Android device.", command, handled = true, error = "app_not_available")

        return try {
            context.startActivity(intent)
            DexResponse("Opening ${launchTarget.label}.", command, handled = true)
        } catch (error: Exception) {
            DexResponse("I could not open ${launchTarget.label} right now.", command, handled = true, error = error.message)
        }
    }

    private data class LaunchTarget(
        val label: String,
        val packages: List<String> = emptyList(),
        val actionIntent: Intent? = null,
        val webUri: Uri? = null,
    )

    private fun resolveTarget(raw: String): LaunchTarget? {
        val target = raw.trim().lowercase()
        fun app(label: String, vararg packages: String) = LaunchTarget(label, packages.toList())
        return when {
            target.contains("gmail") || target == "email" || target == "mail" ->
                LaunchTarget("Gmail", listOf("com.google.android.gm"), webUri = Uri.parse("https://mail.google.com"))
            target.contains("facebook messenger") || target == "messenger" ->
                LaunchTarget("Messenger", listOf("com.facebook.orca"), webUri = Uri.parse("https://www.messenger.com"))
            target.contains("facebook") ->
                LaunchTarget("Facebook", listOf("com.facebook.katana", "com.facebook.lite"), webUri = Uri.parse("https://www.facebook.com"))
            target.contains("instagram") -> app("Instagram", "com.instagram.android")
            target.contains("tiktok") -> app("TikTok", "com.zhiliaoapp.musically")
            target.contains("spotify") -> app("Spotify", "com.spotify.music")
            target.contains("youtube music") -> app("YouTube Music", "com.google.android.apps.youtube.music")
            target.contains("youtube") -> app("YouTube", "com.google.android.youtube")
            target.contains("maps") || target == "map" || target.contains("google maps") -> app("Google Maps", "com.google.android.apps.maps")
            target.contains("calendar") -> app("Calendar", "com.google.android.calendar", "com.samsung.android.calendar")
            target.contains("camera") -> LaunchTarget("Camera", actionIntent = Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA))
            target.contains("calculator") || target == "calc" -> app("Calculator", "com.google.android.calculator", "com.sec.android.app.popupcalculator")
            target.contains("settings") -> LaunchTarget("Settings", actionIntent = Intent(Settings.ACTION_SETTINGS))
            target.contains("chrome") -> app("Chrome", "com.android.chrome")
            target.contains("browser") -> LaunchTarget("Browser", actionIntent = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com")))
            target.contains("photos") || target.contains("google photos") -> app("Google Photos", "com.google.android.apps.photos")
            target.contains("gallery") -> app("Gallery", "com.sec.android.gallery3d")
            target.contains("messages") || target == "message" || target == "texts" -> app("Messages", "com.google.android.apps.messaging", "com.samsung.android.messaging")
            target.contains("phone") || target.contains("dialer") -> LaunchTarget("Phone", actionIntent = Intent(Intent.ACTION_DIAL))
            target.contains("contacts") -> LaunchTarget(
                "Contacts",
                actionIntent = Intent(Intent.ACTION_VIEW).apply { type = ContactsContract.Contacts.CONTENT_TYPE },
            )
            target.contains("clock") || target.contains("alarm") -> app("Clock", "com.google.android.deskclock", "com.sec.android.app.clockpackage")
            target.contains("notes") || target.contains("samsung notes") -> app("Notes", "com.samsung.android.app.notes")
            else -> null
        }
    }
}
