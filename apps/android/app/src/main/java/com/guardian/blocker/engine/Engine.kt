package com.guardian.blocker.engine

import java.net.URLDecoder
import java.time.Instant
import java.time.ZoneId
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/*
 * Port a Kotlin del motor de packages/core (time.ts, match.ts, engine.ts).
 * Debe comportarse igual: las pruebas de EngineTest replican las de TypeScript.
 */

const val MINUTE = 60_000L
private const val DAY_MINUTES = 24 * 60

// ------------------------------------------------------------------ hora local

data class LocalTime(val day: String, val weekday: Int, val minutes: Double)

fun localTime(nowMs: Long, timezone: String): LocalTime {
    val zone = runCatching { ZoneId.of(timezone) }.getOrDefault(ZoneId.systemDefault())
    val z = Instant.ofEpochMilli(nowMs).atZone(zone)
    return LocalTime(
        day = z.toLocalDate().toString(),
        weekday = z.dayOfWeek.value % 7, // domingo = 0
        minutes = z.hour * 60 + z.minute + z.second / 60.0,
    )
}

fun nextLocalMidnight(nowMs: Long, timezone: String): Long =
    nowMs + ((DAY_MINUTES - localTime(nowMs, timezone).minutes) * MINUTE).toLong()

fun parseHHMM(v: String): Int {
    val (h, m) = v.split(":").map { it.toInt() }
    return h * 60 + m
}

private fun minutesLeftInWindow(w: TimeWindow, lt: LocalTime): Double? {
    val s = parseHHMM(w.start)
    val e = parseHHMM(w.end)
    val today = lt.weekday in w.days
    val yesterday = ((lt.weekday + 6) % 7) in w.days
    if (e > s) return if (today && lt.minutes >= s && lt.minutes < e) e - lt.minutes else null
    if (today && lt.minutes >= s) return DAY_MINUTES - lt.minutes + e
    if (yesterday && lt.minutes < e) return e - lt.minutes
    return null
}

data class WindowState(val active: Boolean, val endsAt: Long? = null, val nextStart: Long? = null)

fun windowState(windows: List<TimeWindow>, nowMs: Long, tz: String): WindowState {
    var cursor = nowMs
    var active = false
    repeat(8) {
        val lt = localTime(cursor, tz)
        val best = windows.mapNotNull { minutesLeftInWindow(it, lt) }.maxOrNull() ?: return@repeat
        active = true
        cursor += ceil(best * MINUTE).toLong()
    }
    if (active) return WindowState(true, endsAt = cursor)
    val lt = localTime(nowMs, tz)
    var best: Double? = null
    for (offset in 0..7) {
        val wd = (lt.weekday + offset) % 7
        for (w in windows) {
            if (wd !in w.days) continue
            val delta = offset * DAY_MINUTES + parseHHMM(w.start) - lt.minutes
            if (delta > 0 && (best == null || delta < best)) best = delta
        }
    }
    return WindowState(false, nextStart = best?.let { nowMs + ceil(it * MINUTE).toLong() })
}

fun formatDuration(ms: Long): String {
    val total = max(0, Math.round(ms / MINUTE.toDouble()))
    val h = total / 60
    val m = total % 60
    return when {
        h == 0L -> "$m min"
        m == 0L -> "$h h"
        else -> "$h h $m min"
    }
}

// ------------------------------------------------------------------ coincidencias

fun normalizeHost(input: String): String {
    var s = input.trim().lowercase()
    s = s.replace(Regex("^[a-z][a-z0-9+.-]*://"), "")
    s = s.split(Regex("[/?#]"))[0]
    s = s.replace(Regex("^[^@]*@"), "").replace(Regex(":\\d+$"), "").removeSuffix(".")
    s = s.removePrefix("*.").removePrefix("www.")
    return s
}

fun normalizeUrl(input: String): String {
    val s = input.trim().replace(Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://"), "")
    val slash = s.indexOfFirst { it == '/' || it == '?' || it == '#' }
    val host = normalizeHost(if (slash == -1) s else s.substring(0, slash))
    val rest = if (slash == -1) "" else s.substring(slash)
    val decoded = runCatching { URLDecoder.decode(rest.replace("+", "%2B"), "UTF-8") }.getOrDefault(rest)
    return (host + decoded).lowercase()
}

fun domainMatches(host: String, domain: String): Boolean {
    val h = normalizeHost(host)
    val d = normalizeHost(domain)
    return d.isNotEmpty() && (h == d || h.endsWith(".$d"))
}

private fun urlPrefixMatches(url: String, prefix: String): Boolean {
    val u = normalizeUrl(url)
    val p = normalizeUrl(prefix)
    val ps = p.indexOf('/')
    val pHost = if (ps == -1) p else p.substring(0, ps)
    val pPath = if (ps == -1) "" else p.substring(ps)
    val us = u.indexOfFirst { it == '/' || it == '?' || it == '#' }
    val uHost = if (us == -1) u else u.substring(0, us)
    val uPath = if (us == -1) "" else u.substring(us)
    return domainMatches(uHost, pHost) && uPath.startsWith(pPath)
}

class Matcher(private val catalog: Catalog) {
    fun isEssential(subject: Subject) = subject is Subject.App && subject.id in catalog.essentialApps

    fun matches(t: Target, s: Subject): Boolean = when (t) {
        Target.All -> true
        is Target.App -> s is Subject.App && (t.platform == null || t.platform == s.platform) && t.id == s.id
        is Target.Service -> catalog.service(t.id)?.let { svc ->
            when (s) {
                is Subject.App -> s.id in svc.apps
                is Subject.Web -> svc.domains.any { domainMatches(s.url, it) }
            }
        } ?: false
        is Target.Domain -> s is Subject.Web && domainMatches(s.url, t.domain)
        is Target.Url -> s is Subject.Web && urlPrefixMatches(s.url, t.prefix)
        is Target.Keyword -> s is Subject.Web && normalizeUrl(s.url).contains(t.keyword.trim().lowercase())
        is Target.Category -> catalog.inCategory(t.category).any { matches(Target.Service(it.id), s) } ||
            (s is Subject.Web && (
                catalog.categoryDomains[t.category].orEmpty().any { domainMatches(s.url, it) } ||
                    catalog.categoryKeywords[t.category].orEmpty().any { normalizeHost(s.url).contains(it) }
                ))
        is Target.IosSelection -> false
    }

    fun matchesAny(targets: List<Target>, s: Subject) = targets.any { matches(it, s) }

    fun appliesTo(rule: Rule, platform: String?, deviceId: String?): Boolean {
        if (!rule.platforms.isNullOrEmpty() && platform != null && platform !in rule.platforms) return false
        if (!rule.deviceIds.isNullOrEmpty() && deviceId != null && deviceId !in rule.deviceIds) return false
        return true
    }

    fun covers(rule: Rule, s: Subject, platform: String?, deviceId: String?) =
        rule.enabled && appliesTo(rule, platform, deviceId) && matchesAny(rule.targets, s) && !matchesAny(rule.exceptions, s)

    fun domainsOf(t: Target): List<String> = when (t) {
        is Target.Service -> catalog.service(t.id)?.domains.orEmpty()
        is Target.Domain -> listOf(normalizeHost(t.domain))
        is Target.Category -> catalog.inCategory(t.category).flatMap { it.domains } + catalog.categoryDomains[t.category].orEmpty()
        else -> emptyList()
    }

    fun appIdsOf(t: Target, platform: String): List<String> = when (t) {
        is Target.App -> if (t.platform == null || t.platform == platform) listOf(t.id) else emptyList()
        is Target.Service -> catalog.service(t.id)?.apps.orEmpty()
        is Target.Category -> catalog.inCategory(t.category).flatMap { it.apps }
        else -> emptyList()
    }
}

// ------------------------------------------------------------------ uso

data class RuleUsage(
    val usedMs: Long = 0,
    val opens: Int = 0,
    val intervalUsedMs: Long = 0,
    val breakUntil: Long? = null,
    val lastUsedAt: Long? = null,
)

data class UsageState(val day: String, val rules: Map<String, RuleUsage> = emptyMap()) {
    fun rule(id: String) = rules[id] ?: RuleUsage()
    fun with(id: String, u: RuleUsage) = copy(rules = rules + (id to u))
}

fun ensureDay(u: UsageState, nowMs: Long, tz: String): UsageState {
    val day = localTime(nowMs, tz).day
    if (u.day == day) return u
    return UsageState(day, u.rules.filter { (it.value.breakUntil ?: 0) > nowMs }.mapValues { RuleUsage(breakUntil = it.value.breakUntil) })
}

fun mergeUsage(a: UsageState, b: UsageState): UsageState {
    if (a.day != b.day) return if (a.day > b.day) a else b
    val out = a.rules.toMutableMap()
    for ((id, u) in b.rules) {
        val x = out[id]
        out[id] = if (x == null) u else RuleUsage(
            usedMs = x.usedMs + u.usedMs,
            opens = x.opens + u.opens,
            intervalUsedMs = max(x.intervalUsedMs, u.intervalUsedMs),
            breakUntil = listOfNotNull(x.breakUntil, u.breakUntil).maxOrNull(),
            lastUsedAt = listOfNotNull(x.lastUsedAt, u.lastUsedAt).maxOrNull(),
        )
    }
    return UsageState(a.day, out)
}

// ------------------------------------------------------------------ motor

data class RuleStatus(
    val rule: Rule,
    val blocked: Boolean,
    val until: Long?,
    val usedMs: Long,
    val limitMs: Long?,
    val remainingMs: Long?,
    val nextBlockAt: Long?,
)

class Engine(private val catalog: Catalog, private val platform: String, private val deviceId: String?) {
    val matcher = Matcher(catalog)

    private data class State(val blocked: Boolean, val until: Long?, val remainingMs: Long? = null, val nextBlockAt: Long? = null, val limitMs: Long? = null)

    private fun activeOverrides(p: Policy, now: Long) = p.overrides.filter { it.type == "bonus" || (it.until ?: 0) > now }

    private fun bonus(overrides: List<Override>, rule: Rule, day: String) =
        overrides.filter { it.type == "bonus" && it.day == day && (it.ruleId == null || it.ruleId == rule.id) }.sumOf { it.minutes }

    private fun state(rule: Rule, p: Policy, usage: UsageState, now: Long, overrides: List<Override>): State {
        val tz = p.timezone
        val u = usage.rule(rule.id)
        return when (rule.mode) {
            "always" -> State(true, null)
            "until" -> if ((rule.until ?: 0) > now) State(true, rule.until) else State(false, null)
            "schedule" -> {
                val ws = windowState(rule.windows, now, tz)
                if (rule.invert) {
                    if (ws.active) State(false, null, remainingMs = ws.endsAt?.minus(now), nextBlockAt = ws.endsAt) else State(true, ws.nextStart)
                } else {
                    if (ws.active) State(true, ws.endsAt) else State(false, null, nextBlockAt = ws.nextStart)
                }
            }
            "limit" -> {
                val lt = localTime(now, tz)
                val limitMs = ((rule.perDay[lt.weekday] ?: rule.dailyMinutes) + bonus(overrides, rule, lt.day)) * MINUTE
                val midnight = nextLocalMidnight(now, tz)
                when {
                    rule.maxOpens != null && u.opens > rule.maxOpens -> State(true, midnight, 0, limitMs = limitMs)
                    u.usedMs >= limitMs -> State(true, midnight, 0, limitMs = limitMs)
                    else -> State(false, null, limitMs - u.usedMs, limitMs = limitMs)
                }
            }
            "interval" -> when {
                rule.windows.isNotEmpty() && !windowState(rule.windows, now, tz).active -> State(false, null)
                (u.breakUntil ?: 0) > now -> State(true, u.breakUntil)
                else -> State(false, null, max(0, rule.useMinutes * MINUTE - u.intervalUsedMs))
            }
            else -> State(false, null)
        }
    }

    private fun message(mode: String, name: String?, until: Long?, now: Long): String {
        val left = until?.let { " Se libera en ${formatDuration(it - now)}." } ?: ""
        return when (mode) {
            "lock" -> "El administrador bloqueó el dispositivo.$left"
            "always" -> "Bloqueado por “$name”."
            "schedule" -> "Fuera del horario permitido (“$name”).$left"
            "limit" -> "Se terminó el tiempo de hoy para “$name”.$left"
            "interval" -> "Hora de descansar (“$name”).$left"
            else -> "Bloqueo temporal activo (“$name”).$left"
        }
    }

    private fun unlockCovers(o: Override, rule: Rule?, s: Subject): Boolean {
        if (o.type != "unlock") return false
        if (!o.targets.isNullOrEmpty() && matcher.matchesAny(o.targets, s)) return true
        return rule != null && o.ruleId == rule.id
    }

    fun evaluate(p: Policy, usageIn: UsageState, s: Subject, now: Long): Decision {
        if (matcher.isEssential(s)) return Decision(false, allowedBy = "essential", message = "App esencial")
        if (matcher.matchesAny(p.allowlist, s)) return Decision(false, allowedBy = "allowlist", message = "Permitido siempre")
        val usage = ensureDay(usageIn, now, p.timezone)
        val overrides = activeOverrides(p, now)
        val paused = overrides.firstOrNull { it.type == "pause" }
        val lock = overrides.firstOrNull { it.type == "lock" }
        val subjectUnlock = overrides.firstOrNull { unlockCovers(it, null, s) }

        var rules = p.rules.filter { r -> matcher.covers(r, s, platform, deviceId) && overrides.none { unlockCovers(it, r, s) } }
        if (paused != null) rules = rules.filter { it.strict }

        var bestRule: Rule? = null
        var bestMode: String? = null
        var bestUntil: Long? = null
        var bestSet = false
        var anyStrict = false
        var remaining: Long? = null
        fun rank(u: Long?) = u ?: Long.MAX_VALUE

        if (lock != null && paused == null && subjectUnlock == null) {
            bestMode = "lock"; bestUntil = lock.until; bestSet = true
        }
        for (rule in rules) {
            val st = state(rule, p, usage, now, overrides)
            if (st.blocked) {
                anyStrict = anyStrict || rule.strict
                if (!bestSet || rank(st.until) > rank(bestUntil)) {
                    bestRule = rule; bestMode = rule.mode; bestUntil = st.until; bestSet = true
                }
            } else if (st.remainingMs != null) {
                remaining = remaining?.let { min(it, st.remainingMs) } ?: st.remainingMs
            }
        }
        if (bestSet) {
            return Decision(
                blocked = true,
                mode = bestMode,
                ruleId = bestRule?.id,
                ruleName = bestRule?.name,
                until = bestUntil,
                strict = (bestRule?.strict ?: false) || anyStrict,
                message = message(bestMode!!, bestRule?.name, bestUntil, now),
            )
        }
        if (subjectUnlock != null) return Decision(false, remainingMs = remaining, allowedBy = "unlock", message = "Desbloqueo temporal")
        if (paused != null) return Decision(false, allowedBy = "pause", message = "Dispositivo liberado por el administrador")
        return Decision(false, remainingMs = remaining, message = "Permitido")
    }

    fun recordUsage(p: Policy, usageIn: UsageState, s: Subject, deltaMs: Long, now: Long): UsageState {
        var usage = ensureDay(usageIn, now, p.timezone)
        if (deltaMs <= 0 || matcher.isEssential(s) || matcher.matchesAny(p.allowlist, s)) return usage
        for (rule in p.rules) {
            if (rule.mode != "limit" && rule.mode != "interval") continue
            if (!matcher.covers(rule, s, platform, deviceId)) continue
            val u = usage.rule(rule.id)
            var next = u.copy(usedMs = u.usedMs + deltaMs, lastUsedAt = now)
            if (rule.mode == "interval") {
                val breakMs = rule.breakMinutes * MINUTE
                val idle = u.lastUsedAt?.let { now - deltaMs - it } ?: 0
                val reset = idle >= breakMs || (u.breakUntil != null && u.breakUntil <= now - deltaMs)
                val used = (if (reset) 0 else u.intervalUsedMs) + deltaMs
                next = if (used >= rule.useMinutes * MINUTE) next.copy(intervalUsedMs = 0, breakUntil = now + breakMs) else next.copy(intervalUsedMs = used)
            }
            usage = usage.with(rule.id, next)
        }
        return usage
    }

    fun recordOpen(p: Policy, usageIn: UsageState, s: Subject, now: Long): UsageState {
        var usage = ensureDay(usageIn, now, p.timezone)
        for (rule in p.rules) {
            if (rule.mode != "limit" || rule.maxOpens == null || !matcher.covers(rule, s, platform, deviceId)) continue
            val u = usage.rule(rule.id)
            usage = usage.with(rule.id, u.copy(opens = u.opens + 1))
        }
        return usage
    }

    fun statuses(p: Policy, usageIn: UsageState, now: Long): List<RuleStatus> {
        val usage = ensureDay(usageIn, now, p.timezone)
        val overrides = activeOverrides(p, now)
        val paused = overrides.any { it.type == "pause" }
        return p.rules.filter { matcher.appliesTo(it, platform, deviceId) }.map { rule ->
            val st = state(rule, p, usage, now, overrides)
            val unlocked = overrides.any { it.type == "unlock" && it.ruleId == rule.id }
            val blocked = rule.enabled && st.blocked && !unlocked && (!paused || rule.strict)
            RuleStatus(rule, blocked, if (blocked) st.until else null, usage.rule(rule.id).usedMs, st.limitMs, st.remainingMs, st.nextBlockAt)
        }
    }

    /** Apps concretas bloqueadas ahora (para suspenderlas si somos propietarios del dispositivo). */
    fun blockedPackagesNow(p: Policy, usage: UsageState, installed: Collection<String>, now: Long): Set<String> =
        installed.filter { pkg ->
            val s = Subject.App(platform, pkg)
            // Sólo reglas con objetivos concretos: "todo el dispositivo" lo cubre la pantalla de bloqueo.
            p.rules.any { r -> r.targets.any { it !is Target.All && matcher.matches(it, s) } } && evaluate(p, usage, s, now).blocked
        }.toSet()
}
