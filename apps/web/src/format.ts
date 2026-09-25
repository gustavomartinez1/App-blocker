export { formatDuration } from '@guardian/core';

export const PLATFORM_LABELS: Record<string, string> = {
  android: 'Android',
  ios: 'iPhone / iPad',
  windows: 'Windows',
  macos: 'Mac',
  linux: 'Linux',
  chromeos: 'Chromebook',
  browser: 'Navegador',
};

export const PLATFORM_ICONS: Record<string, string> = {
  android: '🤖',
  ios: '📱',
  windows: '🪟',
  macos: '💻',
  linux: '🐧',
  chromeos: '💻',
  browser: '🌐',
};

export function timeAgo(ms: number | null): string {
  if (!ms) return 'nunca';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

export function clock(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined) return '';
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('es-MX', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function minutesUntilTomorrow(): number {
  const now = new Date();
  const t = new Date(now);
  t.setHours(24, 0, 0, 0);
  return Math.max(1, Math.round((t.getTime() - now.getTime()) / 60_000));
}
