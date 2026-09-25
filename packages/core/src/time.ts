import type { TimeWindow } from './schema.js';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY_MINUTES = 24 * 60;

export interface LocalTime {
  /** Fecha local YYYY-MM-DD. */
  day: string;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  /** Minutos desde la medianoche local, con fracción de segundos. */
  minutes: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function localTime(date: Date, timeZone: string): LocalTime {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: WEEKDAYS[parts.weekday ?? 'Sun'] ?? 0,
    minutes: hour * 60 + Number(parts.minute) + Number(parts.second) / 60,
  };
}

export function localDay(date: Date, timeZone: string): string {
  return localTime(date, timeZone).day;
}

/** Instante de la próxima medianoche local (aprox. en días con cambio de horario). */
export function nextLocalMidnight(date: Date, timeZone: string): Date {
  const { minutes } = localTime(date, timeZone);
  return new Date(date.getTime() + (DAY_MINUTES - minutes) * MINUTE);
}

export function parseHHMM(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Si la ventana está activa ahora, cuántos minutos le quedan; si no, null. */
function minutesLeftInWindow(w: TimeWindow, lt: LocalTime): number | null {
  const s = parseHHMM(w.start);
  const e = parseHHMM(w.end);
  const today = w.days.includes(lt.weekday);
  const yesterday = w.days.includes((lt.weekday + 6) % 7);
  if (e > s) {
    return today && lt.minutes >= s && lt.minutes < e ? e - lt.minutes : null;
  }
  // Ventana que cruza la medianoche (o de 24 h si inicio == fin).
  if (today && lt.minutes >= s) return DAY_MINUTES - lt.minutes + e;
  if (yesterday && lt.minutes < e) return e - lt.minutes;
  return null;
}

export interface WindowState {
  active: boolean;
  /** Si está activa: cuándo termina (encadenando ventanas contiguas). */
  endsAt?: Date;
  /** Si no está activa: cuándo empieza la próxima. */
  nextStart?: Date;
}

export function windowState(windows: TimeWindow[], now: Date, timeZone: string): WindowState {
  let cursor = now;
  let active = false;
  // Encadena ventanas contiguas (p. ej. 22:00-00:00 + 00:00-07:00), máximo 8 saltos.
  for (let i = 0; i < 8; i++) {
    const lt = localTime(cursor, timeZone);
    let best: number | null = null;
    for (const w of windows) {
      const left = minutesLeftInWindow(w, lt);
      if (left !== null && (best === null || left > best)) best = left;
    }
    if (best === null) break;
    active = true;
    cursor = new Date(cursor.getTime() + Math.ceil(best * MINUTE));
  }
  if (active) return { active, endsAt: cursor };
  return { active: false, nextStart: nextWindowStart(windows, now, timeZone) };
}

function nextWindowStart(windows: TimeWindow[], now: Date, timeZone: string): Date | undefined {
  const lt = localTime(now, timeZone);
  let best: number | undefined;
  for (let offset = 0; offset <= 7; offset++) {
    const wd = (lt.weekday + offset) % 7;
    for (const w of windows) {
      if (!w.days.includes(wd)) continue;
      const delta = offset * DAY_MINUTES + parseHHMM(w.start) - lt.minutes;
      if (delta > 0 && (best === undefined || delta < best)) best = delta;
    }
  }
  return best === undefined ? undefined : new Date(now.getTime() + Math.ceil(best * MINUTE));
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / MINUTE));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
