import { z } from 'zod';
import { isValidIpOrCidr } from './ip.js';

/**
 * Esquemas de la política de bloqueo. Son la única fuente de verdad: el
 * servidor valida con ellos lo que envía el panel, y los agentes (escritorio,
 * extensión) reciben exactamente esta forma. Los agentes nativos (Kotlin/Swift)
 * replican la misma estructura JSON.
 */

export const PLATFORMS = ['android', 'ios', 'windows', 'macos', 'linux', 'chromeos', 'browser'] as const;
export const platformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof platformSchema>;

export const CATEGORY_IDS = [
  'social',
  'messaging',
  'video',
  'streaming',
  'games',
  'adult',
  'gambling',
  'shopping',
  'news',
  'dating',
  'ai',
  'browsers',
  'bypass',
  'app_stores',
] as const;
export const categorySchema = z.enum(CATEGORY_IDS);
export type CategoryId = z.infer<typeof categorySchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Formato HH:MM');
const weekday = z.number().int().min(0).max(6); // 0 = domingo

export const timeWindowSchema = z.object({
  /** Días en que INICIA la ventana. Una ventana 22:00-07:00 del viernes termina el sábado. */
  days: z.array(weekday).min(1),
  start: hhmm,
  end: hhmm,
});
export type TimeWindow = z.infer<typeof timeWindowSchema>;

/** Qué se bloquea. */
export const targetSchema = z.discriminatedUnion('kind', [
  /** App concreta por identificador de plataforma (paquete Android, bundle id, ejecutable). */
  z.object({
    kind: z.literal('app'),
    id: z.string().min(1),
    platform: platformSchema.optional(),
    label: z.string().optional(),
  }),
  /** Servicio del catálogo (p. ej. "instagram"): cubre app móvil, app de escritorio y sitio web. */
  z.object({ kind: z.literal('service'), id: z.string().min(1) }),
  /** Dominio y todos sus subdominios. */
  z.object({ kind: z.literal('domain'), domain: z.string().min(1) }),
  /** Prefijo de URL, p. ej. "youtube.com/shorts". */
  z.object({ kind: z.literal('url'), prefix: z.string().min(1) }),
  /** Palabra clave en la URL o búsqueda. */
  z.object({ kind: z.literal('keyword'), keyword: z.string().min(2) }),
  /** Dirección IP o rango CIDR (IPv4/IPv6), p. ej. "203.0.113.7" o "10.0.0.0/8". */
  z.object({ kind: z.literal('ip'), ip: z.string().refine(isValidIpOrCidr, 'IP o rango CIDR inválido') }),
  /** Categoría completa del catálogo. */
  z.object({ kind: z.literal('category'), category: categorySchema }),
  /**
   * Selección opaca de iOS (FamilyActivitySelection). Apple no permite
   * referirse a apps por bundle id: la selección se hace en el dispositivo y
   * sólo ese dispositivo sabe qué contiene.
   */
  z.object({ kind: z.literal('iosSelection'), selectionId: z.string().min(1), label: z.string().optional() }),
  /** Todo el dispositivo (salvo apps esenciales y lista permitida). */
  z.object({ kind: z.literal('all') }),
]);
export type Target = z.infer<typeof targetSchema>;

const ruleBase = {
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  enabled: z.boolean().default(true),
  targets: z.array(targetSchema).min(1),
  /** Excepciones dentro de la regla (p. ej. "todo menos WhatsApp"). */
  exceptions: z.array(targetSchema).default([]),
  /** Si se indica, la regla sólo aplica en estas plataformas. */
  platforms: z.array(platformSchema).optional(),
  /** Si se indica, la regla sólo aplica en estos dispositivos. */
  deviceIds: z.array(z.string()).optional(),
  /** Estricta: no se pueden pedir desbloqueos ni usar códigos para esta regla. */
  strict: z.boolean().default(false),
};

export const ruleSchema = z.discriminatedUnion('mode', [
  /** Bloqueo definitivo (hasta que el administrador lo quite). */
  z.object({ ...ruleBase, mode: z.literal('always') }),
  /** Bloqueo por horario. Con invert=true se bloquea FUERA de las ventanas. */
  z.object({
    ...ruleBase,
    mode: z.literal('schedule'),
    windows: z.array(timeWindowSchema).min(1),
    invert: z.boolean().default(false),
  }),
  /** Límite diario de uso (compartido entre todos los dispositivos del perfil). */
  z.object({
    ...ruleBase,
    mode: z.literal('limit'),
    dailyMinutes: z.number().int().min(0).max(24 * 60),
    /** Límite distinto por día de la semana (0 = domingo). */
    perDay: z.record(z.string().regex(/^[0-6]$/), z.number().int().min(0).max(24 * 60)).optional(),
    /** Número máximo de aperturas por día. */
    maxOpens: z.number().int().min(1).optional(),
  }),
  /** Cada `useMinutes` de uso, bloquea `breakMinutes` (descansos obligatorios). */
  z.object({
    ...ruleBase,
    mode: z.literal('interval'),
    useMinutes: z.number().int().min(1).max(24 * 60),
    breakMinutes: z.number().int().min(1).max(24 * 60),
    /** Opcional: el ciclo sólo corre dentro de estas ventanas. */
    windows: z.array(timeWindowSchema).optional(),
  }),
  /** Bloqueo temporal hasta una fecha (sesión de enfoque / castigo). */
  z.object({ ...ruleBase, mode: z.literal('until'), until: z.string().datetime() }),
]);
export type Rule = z.infer<typeof ruleSchema>;
export type RuleMode = Rule['mode'];

export const settingsSchema = z.object({
  /** Bloquea sitios para adultos (categoría + DNS familiar). */
  blockAdultContent: z.boolean().default(true),
  /** Fuerza SafeSearch en Google/Bing/DuckDuckGo y modo restringido en YouTube. */
  enforceSafeSearch: z.boolean().default(true),
  /** Bloquea navegación de incógnito donde la plataforma lo permita. */
  blockIncognito: z.boolean().default(true),
  /** Impide desinstalar el agente sin autorización. */
  preventUninstall: z.boolean().default(true),
  /** Las apps nuevas quedan bloqueadas hasta que el admin las apruebe. */
  approveNewApps: z.boolean().default(false),
  /** Bloquea apps de VPN/proxy que sirven para saltarse el filtro. */
  blockBypassTools: z.boolean().default(true),
  /** Bloquea el acceso a ajustes sensibles (fecha/hora, accesibilidad, VPN, apps). */
  protectSettings: z.boolean().default(true),
  /** Permite al usuario pedir desbloqueos desde la pantalla de bloqueo. */
  unlockRequestsEnabled: z.boolean().default(true),
  /** Permite desbloquear sin internet con códigos de un solo uso. */
  offlineCodesEnabled: z.boolean().default(true),
  /** Minutos antes del fin de un límite para avisar al usuario. */
  warnBeforeMinutes: z.number().int().min(0).max(60).default(5),
  /** Avisar al admin si un dispositivo deja de reportar por más de N minutos. */
  offlineAlertMinutes: z.number().int().min(5).max(24 * 60).default(60),
  /**
   * Modo autocontrol: cambios que relajan la política esperan este tiempo
   * antes de aplicarse (contra impulsos). 0 = inmediato.
   */
  relaxCooldownMinutes: z.number().int().min(0).max(7 * 24 * 60).default(0),
});
export type Settings = z.infer<typeof settingsSchema>;

export const overrideSchema = z.discriminatedUnion('type', [
  /** Liberar el dispositivo: no se bloquea nada (salvo reglas estrictas) hasta `until`. */
  z.object({ id: z.string(), type: z.literal('pause'), until: z.string().datetime(), note: z.string().optional() }),
  /** Bloquear todo (salvo esenciales) hasta `until`. */
  z.object({ id: z.string(), type: z.literal('lock'), until: z.string().datetime(), note: z.string().optional() }),
  /** Desbloqueo temporal de objetivos concretos o de una regla. */
  z.object({
    id: z.string(),
    type: z.literal('unlock'),
    until: z.string().datetime(),
    ruleId: z.string().optional(),
    targets: z.array(targetSchema).optional(),
    note: z.string().optional(),
  }),
  /** Minutos extra sobre los límites de un día (sin ruleId = todas las reglas de límite). */
  z.object({
    id: z.string(),
    type: z.literal('bonus'),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    minutes: z.number().int().min(1).max(24 * 60),
    ruleId: z.string().optional(),
    note: z.string().optional(),
  }),
]);
export type Override = z.infer<typeof overrideSchema>;

/** Lo que el administrador edita. */
export const policyInputSchema = z.object({
  rules: z.array(ruleSchema).max(200).default([]),
  /** Siempre permitido (además de las apps esenciales del sistema). */
  allowlist: z.array(targetSchema).default([]),
  settings: settingsSchema.default({}),
});
export type PolicyInput = z.infer<typeof policyInputSchema>;

/** Política completa que se entrega a los dispositivos. */
export const policySchema = policyInputSchema.extend({
  version: z.number().int().min(0),
  profileId: z.string(),
  timezone: z.string(),
  overrides: z.array(overrideSchema).default([]),
});
export type Policy = z.infer<typeof policySchema>;

/** Lo que se está intentando usar. */
export type Subject =
  | { type: 'app'; platform: Platform; id: string; label?: string }
  | { type: 'web'; url: string };

/** Contexto del dispositivo que evalúa. */
export interface EvalContext {
  platform?: Platform;
  deviceId?: string;
}
