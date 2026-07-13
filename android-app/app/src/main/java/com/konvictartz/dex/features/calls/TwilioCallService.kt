package com.konvictartz.dex.features.calls

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.ContextCompat
import com.konvictartz.dex.core.models.DexCommand
import com.konvictartz.dex.core.models.DexResponse

class TwilioCallService(private val context: Context) {
    fun startCall(phoneNumber: String, command: DexCommand? = null): DexResponse {
        val digits = phoneNumber.filter { it.isDigit() || it == '+' }
        if (digits.isBlank()) return DexResponse("I need a phone number before I can start that call.", command, handled = true, error = "missing_phone")
        val action = if (ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED) {
            Intent.ACTION_CALL
        } else {
            Intent.ACTION_DIAL
        }
        return try {
            context.startActivity(Intent(action, Uri.parse("tel:$digits")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            DexResponse("Starting the call.", command, handled = true)
        } catch (error: Exception) {
            DexResponse("I could not start that call right now.", command, handled = true, error = error.message)
        }
    }
}
