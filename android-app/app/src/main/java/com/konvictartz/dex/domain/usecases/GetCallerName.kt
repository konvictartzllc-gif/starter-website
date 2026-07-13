package com.konvictartz.dex.domain.usecases

import com.konvictartz.dex.data.repositories.ContactRepository

class GetCallerName(private val contactRepository: ContactRepository) {
    fun lookup(phoneNumber: String): String? =
        contactRepository.all().firstOrNull { contact ->
            contact.phoneNumber.filter(Char::isDigit).takeLast(7) == phoneNumber.filter(Char::isDigit).takeLast(7)
        }?.displayName
}
