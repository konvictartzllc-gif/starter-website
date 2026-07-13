package com.konvictartz.dex.ui.components

import android.content.Context
import android.util.AttributeSet

class DexMicButton @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : DexButton(context, attrs) {
    fun setListening(listening: Boolean) {
        text = if (listening) "Listening" else "Talk"
        isSelected = listening
    }
}
