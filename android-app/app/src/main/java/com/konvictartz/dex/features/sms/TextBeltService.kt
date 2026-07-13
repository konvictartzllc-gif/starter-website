package com.konvictartz.dex.features.sms

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import com.konvictartz.dex.core.models.DexCommand
import com.konvictartz.dex.core.models.DexResponse

class TextBeltService(private val context: Context) {
    fun send(phoneNumber: String, body: String, command: DexCommand? = null): DexResponse {
        val target = phoneNumber.filter { it.isDigit() || it == '+' }
        if (target.isBlank() || body.isBlank()) {
            return DexResponse("I need a phone number and message before I can send that text.", command, handled = true, error = "missing_sms_details")
        }

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) {
            return try {
                SmsManager.getDefault().sendTextMessage(target, null, body, null, null)
                DexResponse("Text sent.", command, handled = true)
            } catch (error: Exception) {
                DexResponse("I could not send that text directly, so I opened a draft.", command, handled = openDraft(target, body), error = error.message)
            }
        }

        return DexResponse("I opened a text draft for you to send.", command, handled = openDraft(target, body))
    }

    private fun openDraft(phoneNumber: String, body: String): Boolean =
        try {
            context.startActivity(
                Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:$phoneNumber"))
                    .putExtra("sms_body", body)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            true
        } catch (_: Exception) {
            false
        }
}
