package com.konvictartz.dex.data.local

import com.konvictartz.dex.core.models.Contact

class ContactDao {
    private val contacts = linkedMapOf<String, Contact>()

    fun upsert(contact: Contact) {
        contacts[contact.id.ifBlank { contact.displayName.lowercase() }] = contact
    }

    fun findByName(name: String): Contact? =
        contacts.values.firstOrNull { it.displayName.equals(name, ignoreCase = true) }

    fun all(): List<Contact> = contacts.values.toList()
}
