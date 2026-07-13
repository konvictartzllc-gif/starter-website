package com.konvictartz.dex.data.repositories

import com.konvictartz.dex.core.models.Contact
import com.konvictartz.dex.data.local.ContactDao

class ContactRepository(private val contactDao: ContactDao) {
    fun findByName(name: String): Contact? = contactDao.findByName(name)
    fun save(contact: Contact) = contactDao.upsert(contact)
    fun all(): List<Contact> = contactDao.all()
}
