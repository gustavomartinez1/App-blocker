package com.guardian.blocker.engine

import org.json.JSONArray
import org.json.JSONObject

/*
 * Modelo de la política. Refleja exactamente el JSON de packages/core/src/schema.ts.
 * Se parsea con org.json (incluido en Android) para no añadir dependencias.
 */

sealed class Target {
    data class App(val id: String, val platform: String?, val label: String?) : Target()
    data class Service(val id: String) : Target()
    data class Domain(val domain: String) : Target()
    data class Url(val prefix: String) : Target()
    data class Keyword(val keyword: String) : Target()
    data class Category(val category: String) : Target()
    data class IosSelection(val selectionId: String) : Target()
    object All : Target()

    fun toJson(): JSONObject = when (this) {
        is App -> JSONObject().put("kind", "app").put("id", id).apply { platform?.let { put("platform", it) }; label?.let { put("label", it) } }
        is Service -> JSONObject().put("kind", "service").put("id", id)
        is Domain -> JSONObject().put("kind", "domain").put("domain", domain)
        is Url -> JSONObject().put("kind", "url").put("prefix", prefix)
        is Keyword -> JSONObject().put("kind", "keyword").put("keyword", keyword)
        is Category -> JSONObject().put("kind", "category").put("category", category)
        is IosSelection -> JSONObject().put("kind", "iosSelection").put("selectionId", selectionId)
        All -> JSONObject().put("kind", "all")
    }

    companion object {
        fun parse(o: JSONObject): Target? = when (o.optString("kind")) {
            "app" -> App(o.getString("id"), o.optStringOrNull("platform"), o.optStringOrNull("label"))
            "service" -> Service(o.getString("id"))
            "domain" -> Domain(o.getString("domain"))
            "url" -> Url(o.getString("prefix"))
            "keyword" -> Keyword(o.getString("keyword"))
            "category" -> Category(o.getString("category"))
            "iosSelection" -> IosSelection(o.getString("selectionId"))
            "all" -> All
            else -> null
        }

        fun parseList(a: JSONArray?): List<Target> = a.objects().mapNotNull { parse(it) }
    }
}

data class TimeWindow(val days: List<Int>, val start: String, val end: String)

data class Rule(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val targets: List<Target>,
    val exceptions: List<Target>,
    val platforms: List<String>?,
    val deviceIds: List<String>?,
    val strict: Boolean,
    val mode: String,
    val windows: List<TimeWindow>,
    val invert: Boolean,
    val dailyMinutes: Int,
    val perDay: Map<Int, Int>,
    val maxOpens: Int?,
    val useMinutes: Int,
    val breakMinutes: Int,
    val until: Long?,
)

data class Override(
    val id: String,
    val type: String,
    val until: Long?,
    val ruleId: String?,
    val targets: List<Target>?,
    val day: String?,
    val minutes: Int,
    val note: String?,
) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("type", type).apply {
        until?.let { put("until", isoFromMillis(it)) }
        ruleId?.let { put("ruleId", it) }
        targets?.let { t -> put("targets", JSONArray(t.map { it.toJson() })) }
        day?.let { put("day", it) }
        if (type == "bonus") put("minutes", minutes)
        note?.let { put("note", it) }
    }
}

data class Settings(
    val blockAdultContent: Boolean = true,
    val enforceSafeSearch: Boolean = true,
    val blockIncognito: Boolean = true,
    val preventUninstall: Boolean = true,
    val approveNewApps: Boolean = false,
    val blockBypassTools: Boolean = true,
    val protectSettings: Boolean = true,
    val unlockRequestsEnabled: Boolean = true,
    val offlineCodesEnabled: Boolean = true,
    val warnBeforeMinutes: Int = 5,
)

data class Policy(
    val version: Int,
    val profileId: String,
    val timezone: String,
    val rules: List<Rule>,
    val allowlist: List<Target>,
    val settings: Settings,
    val overrides: List<Override>,
)

data class CatalogService(val id: String, val name: String, val category: String, val apps: List<String>, val domains: List<String>)

data class Catalog(
    val services: List<CatalogService>,
    val categoryDomains: Map<String, List<String>>,
    val categoryKeywords: Map<String, List<String>>,
    val essentialApps: Set<String>,
) {
    private val byId = services.associateBy { it.id }
    fun service(id: String) = byId[id]
    fun inCategory(category: String) = services.filter { it.category == category }

    companion object {
        val EMPTY = Catalog(emptyList(), emptyMap(), emptyMap(), emptySet())

        fun parse(o: JSONObject?): Catalog {
            if (o == null) return EMPTY
            val services = o.optJSONArray("services").objects().map {
                CatalogService(it.getString("id"), it.getString("name"), it.getString("category"), it.optJSONArray("apps").strings(), it.optJSONArray("domains").strings())
            }
            val cats = o.optJSONObject("categories") ?: JSONObject()
            val domains = mutableMapOf<String, List<String>>()
            val keywords = mutableMapOf<String, List<String>>()
            for (key in cats.keys()) {
                val c = cats.getJSONObject(key)
                domains[key] = c.optJSONArray("domains").strings()
                keywords[key] = c.optJSONArray("keywords").strings()
            }
            return Catalog(services, domains, keywords, o.optJSONArray("essentialApps").strings().toSet())
        }
    }
}

sealed class Subject {
    data class App(val platform: String, val id: String, val label: String? = null) : Subject()
    data class Web(val url: String) : Subject()
}

data class Decision(
    val blocked: Boolean,
    val mode: String? = null,
    val ruleId: String? = null,
    val ruleName: String? = null,
    /** Fin del bloqueo (epoch ms); null = indefinido. */
    val until: Long? = null,
    val strict: Boolean = false,
    val remainingMs: Long? = null,
    val allowedBy: String? = null,
    val message: String,
)

// ------------------------------------------------------------------ parseo

object PolicyParser {
    fun rule(o: JSONObject): Rule {
        val perDay = mutableMapOf<Int, Int>()
        o.optJSONObject("perDay")?.let { pd -> for (k in pd.keys()) perDay[k.toInt()] = pd.getInt(k) }
        return Rule(
            id = o.getString("id"),
            name = o.getString("name"),
            enabled = o.optBoolean("enabled", true),
            targets = Target.parseList(o.optJSONArray("targets")),
            exceptions = Target.parseList(o.optJSONArray("exceptions")),
            platforms = o.optJSONArray("platforms")?.strings(),
            deviceIds = o.optJSONArray("deviceIds")?.strings(),
            strict = o.optBoolean("strict", false),
            mode = o.getString("mode"),
            windows = o.optJSONArray("windows").objects().map { w ->
                TimeWindow(w.getJSONArray("days").ints(), w.getString("start"), w.getString("end"))
            },
            invert = o.optBoolean("invert", false),
            dailyMinutes = o.optInt("dailyMinutes", 0),
            perDay = perDay,
            maxOpens = if (o.has("maxOpens")) o.getInt("maxOpens") else null,
            useMinutes = o.optInt("useMinutes", 0),
            breakMinutes = o.optInt("breakMinutes", 0),
            until = o.optStringOrNull("until")?.let { millisFromIso(it) },
        )
    }

    fun override(o: JSONObject) = Override(
        id = o.getString("id"),
        type = o.getString("type"),
        until = o.optStringOrNull("until")?.let { millisFromIso(it) },
        ruleId = o.optStringOrNull("ruleId"),
        targets = o.optJSONArray("targets")?.let { Target.parseList(it) },
        day = o.optStringOrNull("day"),
        minutes = o.optInt("minutes", 0),
        note = o.optStringOrNull("note"),
    )

    fun settings(o: JSONObject?): Settings {
        if (o == null) return Settings()
        val d = Settings()
        return Settings(
            blockAdultContent = o.optBoolean("blockAdultContent", d.blockAdultContent),
            enforceSafeSearch = o.optBoolean("enforceSafeSearch", d.enforceSafeSearch),
            blockIncognito = o.optBoolean("blockIncognito", d.blockIncognito),
            preventUninstall = o.optBoolean("preventUninstall", d.preventUninstall),
            approveNewApps = o.optBoolean("approveNewApps", d.approveNewApps),
            blockBypassTools = o.optBoolean("blockBypassTools", d.blockBypassTools),
            protectSettings = o.optBoolean("protectSettings", d.protectSettings),
            unlockRequestsEnabled = o.optBoolean("unlockRequestsEnabled", d.unlockRequestsEnabled),
            offlineCodesEnabled = o.optBoolean("offlineCodesEnabled", d.offlineCodesEnabled),
            warnBeforeMinutes = o.optInt("warnBeforeMinutes", d.warnBeforeMinutes),
        )
    }

    fun policy(o: JSONObject) = Policy(
        version = o.getInt("version"),
        profileId = o.getString("profileId"),
        timezone = o.getString("timezone"),
        rules = o.optJSONArray("rules").objects().map { rule(it) },
        allowlist = Target.parseList(o.optJSONArray("allowlist")),
        settings = settings(o.optJSONObject("settings")),
        overrides = o.optJSONArray("overrides").objects().map { override(it) },
    )
}

// ------------------------------------------------------------------ utilidades JSON

fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }
fun JSONArray?.strings(): List<String> = if (this == null) emptyList() else (0 until length()).map { getString(it) }
fun JSONArray?.ints(): List<Int> = if (this == null) emptyList() else (0 until length()).map { getInt(it) }
fun JSONObject.optStringOrNull(key: String): String? = if (has(key) && !isNull(key)) getString(key) else null

fun millisFromIso(s: String): Long = java.time.Instant.parse(s).toEpochMilli()
fun isoFromMillis(ms: Long): String = java.time.Instant.ofEpochMilli(ms).toString()
