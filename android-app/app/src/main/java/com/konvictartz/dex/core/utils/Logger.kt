package com.konvictartz.dex.core.utils

import android.util.Log

object Logger {
    private const val TAG = "DexAI"

    fun info(message: String) {
        Log.i(TAG, message)
    }

    fun warn(message: String, error: Throwable? = null) {
        Log.w(TAG, message, error)
    }
}
