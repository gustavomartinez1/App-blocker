package com.guardian.blocker.engine

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Códigos de desbloqueo sin conexión. Mismo algoritmo que packages/core/src/codes.ts:
 * HMAC-SHA256(secreto, "paso:minutos") con truncamiento dinámico a 6 dígitos, pasos de 10 min.
 */
object Codes {
    const val STEP_SECONDS = 600L
    val DURATIONS = listOf(0, 15, 30, 60, 120, 240, 1440)

    fun step(nowMs: Long) = nowMs / 1000 / STEP_SECONDS

    fun generate(secret: String, minutes: Int, nowMs: Long): String = code(secret, step(nowMs), minutes)

    private fun code(secret: String, step: Long, minutes: Int): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        val h = mac.doFinal("$step:$minutes".toByteArray(Charsets.UTF_8))
        val o = h[31].toInt() and 0x0f
        val bin = ((h[o].toInt() and 0x7f) shl 24) or ((h[o + 1].toInt() and 0xff) shl 16) or ((h[o + 2].toInt() and 0xff) shl 8) or (h[o + 3].toInt() and 0xff)
        return (bin % 1_000_000).toString().padStart(6, '0')
    }

    data class Verified(val minutes: Int, val step: Long)

    fun verify(secret: String, input: String, nowMs: Long): Verified? {
        val clean = input.filter { it.isDigit() }
        if (clean.length != 6) return null
        val s = step(nowMs)
        for (st in listOf(s, s - 1)) for (m in DURATIONS) if (code(secret, st, m) == clean) return Verified(m, st)
        return null
    }
}
