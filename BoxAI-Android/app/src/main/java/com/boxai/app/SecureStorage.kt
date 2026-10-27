package com.boxai.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Penyimpanan rahasia: AES-256-GCM dengan kunci di Android Keystore (tidak bisa diekspor).
 * Nilai terenkripsi disimpan di SharedPreferences terpisah dari preferensi biasa.
 * Nilai rahasia tidak pernah ditulis ke log.
 */
class SecureStorage(context: Context) {
    private val prefs = context.getSharedPreferences("boxai_secrets", Context.MODE_PRIVATE)

    fun get(key: String): String {
        if (!validKey(key)) return ""
        val raw = prefs.getString(key, null) ?: return ""
        return try { decrypt(raw) } catch (_: Exception) { "" }
    }

    fun set(key: String, value: String) {
        if (!validKey(key) || value.length > MAX_LEN) return
        if (value.isEmpty()) { prefs.edit().remove(key).apply(); return }
        try { prefs.edit().putString(key, encrypt(value)).apply() } catch (_: Exception) { }
    }

    fun clearAll() { prefs.edit().clear().apply() }

    private fun secretKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KS).apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KS)
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.ENCRYPT_MODE, secretKey())
        val ct = c.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(c.iv + ct, Base64.NO_WRAP)
    }

    private fun decrypt(encoded: String): String {
        val all = Base64.decode(encoded, Base64.NO_WRAP)
        val iv = all.copyOfRange(0, IV_LEN)
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        return String(c.doFinal(all, IV_LEN, all.size - IV_LEN), Charsets.UTF_8)
    }

    companion object {
        private const val ANDROID_KS = "AndroidKeyStore"
        private const val ALIAS = "boxai_secret_key_v1"
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private const val IV_LEN = 12
        private const val MAX_LEN = 4096
        private val ALLOWED = setOf("hf", "gh", "cf", "meta")
        fun validKey(k: String) = k in ALLOWED
    }
}
