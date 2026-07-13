package com.konvictartz.dex.ui.components

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View
import kotlin.math.max

class DexWaveform @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(124, 92, 255)
        strokeCap = Paint.Cap.ROUND
        strokeWidth = 8f
    }
    private var levels: List<Float> = listOf(0.2f, 0.5f, 0.8f, 0.4f, 0.65f)

    fun setLevels(nextLevels: List<Float>) {
        levels = nextLevels.ifEmpty { levels }.map { it.coerceIn(0.05f, 1f) }
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (levels.isEmpty()) return
        val gap = width.toFloat() / max(1, levels.size)
        levels.forEachIndexed { index, level ->
            val centerX = gap * index + gap / 2f
            val halfHeight = height * level / 2f
            canvas.drawLine(centerX, height / 2f - halfHeight, centerX, height / 2f + halfHeight, paint)
        }
    }
}
