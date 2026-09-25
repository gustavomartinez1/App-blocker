import { CATEGORIES, ESSENTIAL_APPS, getService, servicesInCategory } from './catalog.js';
import type { EvalContext, Platform, Rule, Subject, Target } from './schema.js';

/** Plataformas donde los identificadores de app no distinguen mayúsculas. */
const CASE_INSENSITIVE: ReadonlySet<Platform> = new Set(['windows', 'macos']);

function sameAppId(platform: Platform, a: string, b: string): boolean {
  return CASE_INSENSITIVE.has(platform) ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** "https://www.Example.com:8080/a?b" -> "example.com" */
export function normalizeHost(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0] ?? '';
  s = s.replace(/^[^@]*@/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  s = s.replace(/^\*\./, '').replace(/^www\./, '');
  return s;
}

/** "https://www.youtube.com/Shorts/x?y" -> "youtube.com/shorts/x?y" */
export function normalizeUrl(input: string): string {
  const s = input.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const slash = s.search(/[/?#]/);
  const host = normalizeHost(slash === -1 ? s : s.slice(0, slash));
  const rest = slash === -1 ? '' : s.slice(slash);
  let decoded = rest;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    // URL mal codificada: se usa tal cual.
  }
  return (host + decoded).toLowerCase();
}

export function domainMatches(host: string, domain: string): boolean {
  const h = normalizeHost(host);
  const d = normalizeHost(domain);
  if (!d) return false;
  return h === d || h.endsWith('.' + d);
}

function urlPrefixMatches(url: string, prefix: string): boolean {
  const u = normalizeUrl(url);
  const p = normalizeUrl(prefix);
  const pSlash = p.indexOf('/');
  const pHost = pSlash === -1 ? p : p.slice(0, pSlash);
  const pPath = pSlash === -1 ? '' : p.slice(pSlash);
  const uSlash = u.search(/[/?#]/);
  const uHost = uSlash === -1 ? u : u.slice(0, uSlash);
  const uPath = uSlash === -1 ? '' : u.slice(uSlash);
  // Permite subdominios típicos (m.youtube.com/shorts coincide con youtube.com/shorts).
  return domainMatches(uHost, pHost) && uPath.startsWith(pPath);
}

function keywordMatches(url: string, keyword: string): boolean {
  return normalizeUrl(url).includes(keyword.trim().toLowerCase());
}

export function isEssential(subject: Subject): boolean {
  if (subject.type !== 'app') return false;
  const list = ESSENTIAL_APPS[subject.platform];
  return !!list?.some((id) => sameAppId(subject.platform, id, subject.id));
}

export function matchesTarget(target: Target, subject: Subject): boolean {
  switch (target.kind) {
    case 'all':
      return true;
    case 'app':
      return (
        subject.type === 'app' &&
        (!target.platform || target.platform === subject.platform) &&
        sameAppId(subject.platform, target.id, subject.id)
      );
    case 'service': {
      const svc = getService(target.id);
      if (!svc) return false;
      if (subject.type === 'app') {
        return !!svc.apps[subject.platform]?.some((id) => sameAppId(subject.platform, id, subject.id));
      }
      return svc.domains.some((d) => domainMatches(subject.url, d));
    }
    case 'domain':
      return subject.type === 'web' && domainMatches(subject.url, target.domain);
    case 'url':
      return subject.type === 'web' && urlPrefixMatches(subject.url, target.prefix);
    case 'keyword':
      return subject.type === 'web' && keywordMatches(subject.url, target.keyword);
    case 'category': {
      if (servicesInCategory(target.category).some((svc) => matchesTarget({ kind: 'service', id: svc.id }, subject))) {
        return true;
      }
      if (subject.type !== 'web') return false;
      const cat = CATEGORIES[target.category];
      return (
        !!cat.domains?.some((d) => domainMatches(subject.url, d)) ||
        !!cat.keywords?.some((k) => normalizeHost(subject.url).includes(k))
      );
    }
    case 'iosSelection':
      // Sólo el dispositivo iOS sabe qué contiene la selección; lo aplica Screen Time.
      return false;
  }
}

export function matchesAny(targets: readonly Target[], subject: Subject): boolean {
  return targets.some((t) => matchesTarget(t, subject));
}

/** ¿La regla aplica a este dispositivo/plataforma? */
export function ruleAppliesTo(rule: Rule, ctx: EvalContext): boolean {
  if (rule.platforms?.length && ctx.platform && !rule.platforms.includes(ctx.platform)) return false;
  if (rule.deviceIds?.length && ctx.deviceId && !rule.deviceIds.includes(ctx.deviceId)) return false;
  return true;
}

/** ¿La regla cubre este sujeto? (ignora horarios, límites y excepciones temporales) */
export function ruleCovers(rule: Rule, subject: Subject, ctx: EvalContext = {}): boolean {
  return (
    rule.enabled &&
    ruleAppliesTo(rule, ctx) &&
    matchesAny(rule.targets, subject) &&
    !matchesAny(rule.exceptions, subject)
  );
}

/** Dominios concretos que representa un objetivo (para DNS, archivo hosts, etc.). */
export function targetDomains(target: Target): string[] {
  switch (target.kind) {
    case 'service':
      return getService(target.id)?.domains ?? [];
    case 'domain':
      return [normalizeHost(target.domain)];
    case 'category':
      return [
        ...servicesInCategory(target.category).flatMap((s) => s.domains),
        ...(CATEGORIES[target.category].domains ?? []),
      ];
    default:
      return [];
  }
}

/** Identificadores de app concretos que representa un objetivo en una plataforma. */
export function targetAppIds(target: Target, platform: Platform): string[] {
  switch (target.kind) {
    case 'app':
      return !target.platform || target.platform === platform ? [target.id] : [];
    case 'service':
      return getService(target.id)?.apps[platform] ?? [];
    case 'category':
      return servicesInCategory(target.category).flatMap((s) => s.apps[platform] ?? []);
    default:
      return [];
  }
}

export function describeTarget(target: Target): string {
  switch (target.kind) {
    case 'all':
      return 'Todo el dispositivo';
    case 'app':
      return target.label ?? target.id;
    case 'service':
      return getService(target.id)?.name ?? target.id;
    case 'domain':
      return target.domain;
    case 'url':
      return target.prefix;
    case 'keyword':
      return `“${target.keyword}”`;
    case 'category':
      return `Categoría: ${CATEGORIES[target.category].name}`;
    case 'iosSelection':
      return target.label ?? 'Selección de iPhone';
  }
}
