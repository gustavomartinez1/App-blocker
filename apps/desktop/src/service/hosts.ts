import type { WebBlockList } from '@guardian/core';

export const BEGIN = '# >>> Guardián: no editar (se restaura automáticamente) >>>';
export const END = '# <<< Guardián <<<';

/** El archivo hosts no admite comodines: se bloquean también los subdominios más comunes. */
const COMMON_SUBDOMAINS = ['www', 'm', 'mobile', 'web', 'api', 'app'];

/**
 * Genera la sección de Guardián del archivo hosts.
 * `safeSearch` mapea host → IP (p. ej. www.google.com → IP de forcesafesearch.google.com).
 */
export function renderHostsSection(list: WebBlockList, safeSearch: Record<string, string> = {}): string {
  const lines: string[] = [BEGIN];
  for (const [host, ip] of Object.entries(safeSearch).sort()) lines.push(`${ip} ${host}`);
  const allowed = new Set(list.allowedDomains);
  const hosts = new Set<string>();
  for (const d of list.blockedDomains) {
    if (allowed.has(d)) continue;
    hosts.add(d);
    for (const sub of COMMON_SUBDOMAINS) hosts.add(`${sub}.${d}`);
  }
  for (const h of [...hosts].sort()) {
    lines.push(`0.0.0.0 ${h}`);
    lines.push(`:: ${h}`);
  }
  lines.push(END);
  return lines.join('\n');
}

/** Reemplaza (o agrega) la sección de Guardián conservando el resto del archivo. */
export function applyHostsSection(original: string, section: string): string {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const stripped = stripHostsSection(original).replace(/\s+$/, '');
  return `${stripped}${eol}${eol}${section.split('\n').join(eol)}${eol}`;
}

export function stripHostsSection(content: string): string {
  const start = content.indexOf(BEGIN);
  if (start === -1) return content;
  const end = content.indexOf(END, start);
  const tail = end === -1 ? '' : content.slice(end + END.length);
  return content.slice(0, start).replace(/\s+$/, '') + tail.replace(/^\r?\n/, '\n');
}

export function currentHostsSection(content: string): string | null {
  const start = content.indexOf(BEGIN);
  const end = content.indexOf(END, start);
  if (start === -1 || end === -1) return null;
  return content.slice(start, end + END.length).replace(/\r\n/g, '\n');
}
