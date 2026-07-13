package com.konvictartz.dex.domain.usecases

import com.konvictartz.dex.core.models.DexResponse
import com.konvictartz.dex.features.apps.AppLauncher

class OpenApp(private val appLauncher: AppLauncher) {
    fun open(target: String): DexResponse = appLauncher.open(target)
}
