/**
 * Direcciones IP y rangos CIDR (IPv4 e IPv6), para bloquear servidores por IP
 * además de por dominio.
 */

export function parseIPv4(s: string): number[] | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

export function parseIPv6(input: string): number[] | null {
  let s = input.replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (!s.includes(':')) return null;
  // IPv4 incrustada al final (::ffff:1.2.3.4)
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  let v4: number[] | null = null;
  if (tail.includes('.')) {
    v4 = parseIPv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}0:0`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (h: string) => (h === '' ? [] : h.split(':'));
  const head = toGroups(halves[0] ?? '');
  const rest = halves.length === 2 ? toGroups(halves[1] ?? '') : [];
  const missing = 8 - head.length - rest.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 0xff);
  }
  if (v4) bytes.splice(12, 4, ...v4);
  return bytes.length === 16 ? bytes : null;
}

export function parseIP(s: string): number[] | null {
  return parseIPv4(s) ?? parseIPv6(s);
}

/** "10.0.0.0/8", "2001:db8::/32" o una IP suelta. */
export function parseCidr(s: string): { bytes: number[]; prefix: number } | null {
  const [addr = '', prefixStr] = s.trim().split('/');
  const bytes = parseIP(addr);
  if (!bytes) return null;
  const max = bytes.length * 8;
  const prefix = prefixStr === undefined ? max : Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max || (prefixStr !== undefined && !/^\d+$/.test(prefixStr))) return null;
  return { bytes, prefix };
}

export function isValidIpOrCidr(s: string): boolean {
  return parseCidr(s) !== null;
}

/** ¿La IP `host` está dentro del rango `cidr`? */
export function ipMatches(host: string, cidr: string): boolean {
  const ip = parseIP(host);
  const range = parseCidr(cidr);
  if (!ip || !range || ip.length !== range.bytes.length) return false;
  let bits = range.prefix;
  for (let i = 0; bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if (((ip[i] ?? 0) & mask) !== ((range.bytes[i] ?? 0) & mask)) return false;
  }
  return true;
}
