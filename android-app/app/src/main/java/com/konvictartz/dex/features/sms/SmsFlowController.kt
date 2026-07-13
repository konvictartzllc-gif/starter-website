package com.konvictartz.dex.features.sms

import com.konvictartz.dex.core.models.DexResponse

class SmsFlowController(
    private val textBeltService: TextBeltService,
) {
    fun sendDraft(phoneNumber: String, body: String): DexResponse = textBeltService.send(phoneNumber, body)
}
