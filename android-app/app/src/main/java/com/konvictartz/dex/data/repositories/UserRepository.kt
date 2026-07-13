package com.konvictartz.dex.data.repositories

import com.konvictartz.dex.core.models.UserProfile
import com.konvictartz.dex.data.cloud.FirebaseUserStore

class UserRepository(private val userStore: FirebaseUserStore) {
    suspend fun currentUser(userId: String): UserProfile? = userStore.getUser(userId)
    suspend fun save(profile: UserProfile) = userStore.saveUser(profile)
}
