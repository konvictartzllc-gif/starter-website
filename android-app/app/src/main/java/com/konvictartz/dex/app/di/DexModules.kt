package com.konvictartz.dex.app.di

import android.content.Context
import com.konvictartz.dex.domain.intent.CommandRouter
import com.konvictartz.dex.domain.intent.IntentClassifier
import com.konvictartz.dex.domain.usecases.ExecuteDexCommand
import com.konvictartz.dex.domain.usecases.ProcessVoiceCommand
import com.konvictartz.dex.features.apps.AppLauncher
import com.konvictartz.dex.features.apps.MediaController
import com.konvictartz.dex.features.calls.TwilioCallService
import com.konvictartz.dex.features.sms.TextBeltService

object DexModules {
    fun intentClassifier(): IntentClassifier = IntentClassifier()
    fun commandRouter(): CommandRouter = CommandRouter()
    fun processVoiceCommand(): ProcessVoiceCommand = ProcessVoiceCommand(intentClassifier())
    fun executeDexCommand(context: Context): ExecuteDexCommand =
        ExecuteDexCommand(
            appLauncher = AppLauncher(context),
            mediaController = MediaController(context),
            callService = TwilioCallService(context),
            smsService = TextBeltService(context),
        )
}
