import { describeTarget } from './match.js';
import type { Rule, TimeWindow } from './schema.js';

export const WEEKDAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

export function describeDays(days: number[]): string {
  const set = [...new Set(days)].sort();
  if (set.length === 7) return 'todos los días';
  if (set.join() === '1,2,3,4,5') return 'lun a vie';
  if (set.join() === '0,6') return 'fines de semana';
  return set.map((d) => WEEKDAY_NAMES[d]).join(', ');
}

export function describeWindow(w: TimeWindow): string {
  return `${describeDays(w.days)} ${w.start}–${w.end}`;
}

/** Descripción corta en español, p. ej. "Límite 60 min/día · Instagram, TikTok". */
export function describeRule(rule: Rule): string {
  const what = rule.targets.map(describeTarget).join(', ');
  const except = rule.exceptions.length ? ` (excepto ${rule.exceptions.map(describeTarget).join(', ')})` : '';
  let how: string;
  switch (rule.mode) {
    case 'always':
      how = 'Bloqueo permanente';
      break;
    case 'schedule':
      how = `${rule.invert ? 'Permitido sólo' : 'Bloqueado'} ${rule.windows.map(describeWindow).join('; ')}`;
      break;
    case 'limit':
      how = `Límite ${rule.dailyMinutes} min/día${rule.maxOpens ? `, máx. ${rule.maxOpens} aperturas` : ''}`;
      break;
    case 'interval':
      how = `Cada ${rule.useMinutes} min de uso, descanso de ${rule.breakMinutes} min`;
      break;
    case 'until':
      how = `Bloqueado hasta ${new Date(rule.until).toLocaleString('es-MX')}`;
      break;
  }
  return `${how} · ${what}${except}`;
}
