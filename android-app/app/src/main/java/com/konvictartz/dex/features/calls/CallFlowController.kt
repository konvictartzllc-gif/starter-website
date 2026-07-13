package com.konvictartz.dex.features.calls

class CallFlowController(
    private val callerIDManager: CallerIDManager,
) {
    fun callerLabel(number: String): String = callerIDManager.resolve(number) ?: number
}
