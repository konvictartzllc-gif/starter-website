package com.konvictartz.dex.data.local

class DexDatabase(
    val contactDao: ContactDao = ContactDao(),
    val memoryDao: MemoryDao = MemoryDao(),
)
