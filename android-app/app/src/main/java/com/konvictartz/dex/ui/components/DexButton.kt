package com.konvictartz.dex.ui.components

import android.content.Context
import android.util.AttributeSet
import com.google.android.material.button.MaterialButton

open class DexButton @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = com.google.android.material.R.attr.materialButtonStyle,
) : MaterialButton(context, attrs, defStyleAttr) {
    init {
        minHeight = 48
        isAllCaps = false
    }

    fun bind(label: String, enabled: Boolean = true, onClick: (() -> Unit)? = null) {
        text = label
        isEnabled = enabled
        setOnClickListener { onClick?.invoke() }
    }
}
