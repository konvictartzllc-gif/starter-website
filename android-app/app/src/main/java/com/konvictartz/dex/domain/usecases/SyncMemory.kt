package com.konvictartz.dex.domain.usecases

import com.konvictartz.dex.core.models.MemoryContext
import com.konvictartz.dex.data.repositories.MemoryRepository

class SyncMemory(private val memoryRepository: MemoryRepository) {
    suspend fun push(context: MemoryContext) = memoryRepository.save(context)
    suspend fun pull(userId: String): MemoryContext = memoryRepository.load(userId)
}
