package com.konvictartz.dex.domain.usecases

import com.konvictartz.dex.core.models.DexResponse
import com.konvictartz.dex.features.calls.TwilioCallService

class StartCall(private val callService: TwilioCallService) {
    fun call(phoneNumber: String): DexResponse = callService.startCall(phoneNumber)
}
