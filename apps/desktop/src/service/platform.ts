import { homedir, platform as osPlatform } from 'node:os';
import { join } from 'node:path';
import type { Platform } from '@guardian/core';

export function currentPlatform(): Platform {
  switch (osPlatform()) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'linux';
  }
}

export function hostsPath(p: Platform = currentPlatform()): string {
  if (process.env.GUARDIAN_HOSTS_FILE) return process.env.GUARDIAN_HOSTS_FILE;
  return p === 'windows' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : '/etc/hosts';
}

/** Carpeta de datos del servicio (sólo escribible por administradores). */
export function dataDir(p: Platform = currentPlatform()): string {
  if (process.env.GUARDIAN_DATA_DIR) return process.env.GUARDIAN_DATA_DIR;
  if (p === 'windows') return join(process.env.ProgramData ?? 'C:\\ProgramData', 'Guardian');
  if (p === 'macos') return '/Library/Application Support/Guardian';
  return process.getuid?.() === 0 ? '/var/lib/guardian' : join(homedir(), '.local', 'share', 'guardian');
}

export const LOCAL_API_PORT = Number(process.env.GUARDIAN_LOCAL_PORT ?? 47631);
