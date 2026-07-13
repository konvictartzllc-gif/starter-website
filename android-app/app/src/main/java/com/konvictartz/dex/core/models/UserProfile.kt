package com.konvictartz.dex.core.models

data class UserProfile(
    val id: String,
    val name: String = "",
    val email: String = "",
    val accessType: String = "",
)
