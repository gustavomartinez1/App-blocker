package com.guardian.blocker.engine

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.OffsetDateTime

/** Réplica de packages/core/test/engine.test.ts para garantizar el mismo comportamiento. */
class EngineTest {
    private val catalog = Catalog(
        services = listOf(
            CatalogService("tiktok", "TikTok", "social", listOf("com.zhiliaoapp.musically"), listOf("tiktok.com")),
            CatalogService("instagram", "Instagram", "social", listOf("com.instagram.android"), listOf("instagram.com")),
            CatalogService("whatsapp", "WhatsApp", "messaging", listOf("com.whatsapp"), listOf("whatsapp.com")),
        ),
        categoryDomains = mapOf("adult" to listOf("pornhub.com")),
        categoryKeywords = mapOf("adult" to listOf("porn")),
        essentialApps = setOf("com.google.android.dialer"),
    )
    private val engine = Engine(catalog, "android", "d1")
    private val tiktok = Subject.App("android", "com.zhiliaoapp.musically")
    private val tiktokWeb = Subject.Web("https://www.tiktok.com/@x")
    private val whatsapp = Subject.App("android", "com.whatsapp")
    private val dialer = Subject.App("android", "com.google.android.dialer")
    private val u0 = UsageState("2026-09-21")

    private fun at(hhmm: String, day: String = "2026-09-21") = OffsetDateTime.parse("${day}T$hhmm:00-06:00").toInstant().toEpochMilli()

    private fun policy(vararg rules: String, extra: String = ""): Policy = PolicyParser.policy(
        JSONObject("""{"version":1,"profileId":"p","timezone":"America/Mexico_City","rules":[${rules.joinToString(",")}]$extra}"""),
    )

    private fun rule(id: String, json: String) = """{"id":"$id","name":"Regla $id","targets":[{"kind":"service","id":"tiktok"}],$json}"""

    @Test fun alwaysBlocksAppAndWeb() {
        val p = policy(rule("r0", """"mode":"always""""))
        assertTrue(engine.evaluate(p, u0, tiktok, at("10:00")).blocked)
        assertTrue(engine.evaluate(p, u0, tiktokWeb, at("10:00")).blocked)
        assertFalse(engine.evaluate(p, u0, whatsapp, at("10:00")).blocked)
        assertNull(engine.evaluate(p, u0, tiktok, at("10:00")).until)
    }

    @Test fun allExceptWhatsappAndEssentials() {
        val p = policy("""{"id":"a","name":"Todo","mode":"always","targets":[{"kind":"all"}],"exceptions":[{"kind":"service","id":"whatsapp"}]}""")
        assertTrue(engine.evaluate(p, u0, tiktok, at("10:00")).blocked)
        assertFalse(engine.evaluate(p, u0, whatsapp, at("10:00")).blocked)
        assertEquals("essential", engine.evaluate(p, u0, dialer, at("10:00")).allowedBy)
    }

    @Test fun overnightSchedule() {
        val p = policy(rule("r0", """"mode":"schedule","windows":[{"days":[0,1,2,3,4,5,6],"start":"22:00","end":"07:00"}]"""))
        assertFalse(engine.evaluate(p, u0, tiktok, at("21:59")).blocked)
        val d = engine.evaluate(p, u0, tiktok, at("23:30"))
        assertTrue(d.blocked)
        assertEquals(at("07:00", "2026-09-22"), d.until)
        assertFalse(engine.evaluate(p, u0, tiktok, at("07:00")).blocked)
    }

    @Test fun invertedSchedule() {
        val p = policy(rule("r0", """"mode":"schedule","invert":true,"windows":[{"days":[1,2,3,4,5],"start":"16:00","end":"18:00"}]"""))
        assertFalse(engine.evaluate(p, u0, tiktok, at("17:00")).blocked)
        assertEquals(at("16:00", "2026-09-22"), engine.evaluate(p, u0, tiktok, at("19:00")).until)
    }

    @Test fun dailyLimitSharedAcrossAppAndWeb() {
        val p = policy("""{"id":"r0","name":"Redes","mode":"limit","dailyMinutes":30,"targets":[{"kind":"category","category":"social"}]}""")
        var u = engine.recordUsage(p, u0, tiktok, 20 * MINUTE, at("10:00"))
        assertEquals(10 * MINUTE, engine.evaluate(p, u, tiktokWeb, at("10:00")).remainingMs)
        u = engine.recordUsage(p, u, tiktokWeb, 10 * MINUTE, at("10:10"))
        val d = engine.evaluate(p, u, Subject.App("android", "com.instagram.android"), at("10:10"))
        assertTrue(d.blocked)
        assertEquals(at("00:00", "2026-09-22"), d.until)
        assertFalse(engine.evaluate(p, u, tiktok, at("08:00", "2026-09-22")).blocked)
    }

    @Test fun maxOpens() {
        val p = policy(rule("r0", """"mode":"limit","dailyMinutes":600,"maxOpens":2"""))
        var u = u0
        repeat(2) {
            u = engine.recordOpen(p, u, tiktok, at("10:00"))
            assertFalse(engine.evaluate(p, u, tiktok, at("10:00")).blocked)
        }
        u = engine.recordOpen(p, u, tiktok, at("11:00"))
        assertTrue(engine.evaluate(p, u, tiktok, at("11:00")).blocked)
    }

    @Test fun intervalBreaks() {
        val p = policy(rule("r0", """"mode":"interval","useMinutes":20,"breakMinutes":10"""))
        var u = u0
        for (m in 1..20) u = engine.recordUsage(p, u, tiktok, MINUTE, at("10:%02d".format(m)))
        val d = engine.evaluate(p, u, tiktok, at("10:20"))
        assertTrue(d.blocked)
        assertEquals(at("10:30"), d.until)
        assertFalse(engine.evaluate(p, u, tiktok, at("10:30")).blocked)
    }

    @Test fun pauseKeepsStrictRules() {
        val until = isoFromMillis(at("12:00"))
        val p = policy(
            rule("r0", """"mode":"always""""),
            """{"id":"s","name":"Adultos","mode":"always","strict":true,"targets":[{"kind":"category","category":"adult"}]}""",
            extra = ""","overrides":[{"id":"o","type":"pause","until":"$until"}]""",
        )
        assertEquals("pause", engine.evaluate(p, u0, tiktok, at("11:00")).allowedBy)
        val adult = engine.evaluate(p, u0, Subject.Web("https://pornhub.com"), at("11:00"))
        assertTrue(adult.blocked)
        assertTrue(adult.strict)
    }

    @Test fun lockBlocksEverythingButEssentials() {
        val until = isoFromMillis(at("12:00"))
        val p = policy(extra = ""","overrides":[{"id":"o","type":"lock","until":"$until"}]""")
        assertEquals("lock", engine.evaluate(p, u0, whatsapp, at("11:00")).mode)
        assertFalse(engine.evaluate(p, u0, dialer, at("11:00")).blocked)
    }

    @Test fun urlPrefixAndKeyword() {
        val m = Matcher(catalog)
        assertTrue(m.matches(Target.Url("youtube.com/shorts"), Subject.Web("https://m.youtube.com/shorts/xyz")))
        assertFalse(m.matches(Target.Url("youtube.com/shorts"), Subject.Web("https://www.youtube.com/watch?v=1")))
        assertTrue(m.matches(Target.Keyword("casino"), Subject.Web("https://www.google.com/search?q=Casino%20online")))
        assertFalse(domainMatches("notfacebook.com", "facebook.com"))
    }

    @Test fun codesMatchTypeScriptVector() {
        // Mismo vector que packages/core/test/match-codes.test.ts
        assertEquals("428045", Codes.generate("secreto-de-prueba", 60, 1_800_000_000_000))
        assertEquals(60, Codes.verify("secreto-de-prueba", "428045", 1_800_000_000_000)?.minutes)
        assertNull(Codes.verify("otro", "428045", 1_800_000_000_000))
    }
}
