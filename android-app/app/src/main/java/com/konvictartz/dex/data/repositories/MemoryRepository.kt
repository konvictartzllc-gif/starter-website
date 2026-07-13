package com.konvictartz.dex.data.repositories

import com.konvictartz.dex.core.models.MemoryContext
import com.konvictartz.dex.data.cloud.FirebaseMemorySource
import com.konvictartz.dex.data.local.MemoryDao

class MemoryRepository(
    private val memoryDao: MemoryDao,
    private val cloud: FirebaseMemorySource? = null,
) {
    suspend fun save(context: MemoryContext) {
        context.facts.forEach { (key, value) -> memoryDao.put(key, value) }
        cloud?.pushMemory(context)
    }

    suspend fun load(userId: String): MemoryContext {
        val cloudContext = cloud?.pullMemory(userId)
        if (cloudContext != null) {
            cloudContext.facts.forEach { (key, value) -> memoryDao.put(key, value) }
            return cloudContext
        }
        return MemoryContext(userId = userId, facts = memoryDao.all())
    }
}
