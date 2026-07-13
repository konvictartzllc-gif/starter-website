package com.konvictartz.dex.domain.usecases

import com.konvictartz.dex.core.models.DexResponse
import com.konvictartz.dex.features.sms.TextBeltService

class SendSms(private val textBeltService: TextBeltService) {
    fun send(phoneNumber: String, body: String): DexResponse = textBeltService.send(phoneNumber, body)
}
