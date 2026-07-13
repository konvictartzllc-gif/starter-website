package com.konvictartz.dex.domain.usecases

import com.konvictartz.dex.core.models.DexCommand
import com.konvictartz.dex.domain.intent.IntentClassifier

class ProcessVoiceCommand(
    private val classifier: IntentClassifier = IntentClassifier(),
) {
    operator fun invoke(text: String): DexCommand = classifier.classify(text)
}
