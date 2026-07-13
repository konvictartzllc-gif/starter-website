package com.konvictartz.dex.features.memory

import com.konvictartz.dex.core.models.MemoryContext

interface MemorySyncService {
    suspend fun sync(context: MemoryContext)
}
