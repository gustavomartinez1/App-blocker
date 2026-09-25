import { Agent, type AgentData, type Decision, type Subject } from '@guardian/core';

/**
 * Service worker de la extensión. Bloquea navegaciones, cuenta el tiempo en la
 * pestaña activa, fuerza SafeSearch y protege la extensión contra manipulación.
 */

const VERSION = chrome.runtime.getManifest().version;
const BLOCK_PAGE = chrome.runtime.getURL('blocked.html');

const agent = new Agent({
  platform: 'browser',
  agentVersion: VERSION,
  storage: {
    load: async () => ((await chrome.storage.local.get('agent')).agent as AgentData | undefined) ?? null,
    save: async (data) => chrome.storage.local.set({ agent: data }),
  },
});

const ready = agent.init().then(async (paired) => {
  if (paired) {
    agent.connectLive();
    await agent.sync().catch(() => undefined);
    await applySafeSearchRules();
  }
});

// ------------------------------------------------------------ bloqueo de navegación

/** Páginas del navegador con las que se puede desactivar la extensión. */
const PROTECTED_PAGES = [/^chrome:\/\/extensions/, /^edge:\/\/extensions/, /^brave:\/\/extensions/, /^about:addons/, /^about:debugging/, /^chrome:\/\/settings\/(reset|clearBrowserData)/];

const SAFE_SEARCH_PARAMS: { test: RegExp; key: string; value: string }[] = [
  { test: /^https:\/\/(www\.)?google\.[a-z.]+\/search/, key: 'safe', value: 'active' },
  { test: /^https:\/\/(www\.)?bing\.com\/search/, key: 'adlt', value: 'strict' },
  { test: /^https:\/\/(html\.)?duckduckgo\.com\//, key: 'kp', value: '1' },
];

function isWeb(url: string): boolean {
  return /^https?:\/\//.test(url);
}

async function guard(tabId: number, url: string): Promise<void> {
  await ready;
  if (!agent.paired || url.startsWith(BLOCK_PAGE)) return;
  const settings = agent.state.bundle.policy.settings;

  if (settings.protectSettings && !agent.hasAdminAccess() && PROTECTED_PAGES.some((re) => re.test(url))) {
    await agent.report('settings_attempt', { screen: url.split('?')[0] });
    await chrome.tabs.update(tabId, { url: `${BLOCK_PAGE}?u=${encodeURIComponent(url)}&settings=1` });
    return;
  }
  if (!isWeb(url)) return;

  if (settings.enforceSafeSearch) {
    for (const s of SAFE_SEARCH_PARAMS) {
      if (!s.test.test(url)) continue;
      const u = new URL(url);
      if (u.searchParams.get(s.key) !== s.value) {
        u.searchParams.set(s.key, s.value);
        await chrome.tabs.update(tabId, { url: u.toString() });
        return;
      }
    }
  }

  const subject: Subject = { type: 'web', url };
  const decision = await agent.open(subject);
  if (decision.blocked) await chrome.tabs.update(tabId, { url: `${BLOCK_PAGE}?u=${encodeURIComponent(url)}` });
}

chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId === 0) void guard(d.tabId, d.url);
});
// Sitios de una sola página (YouTube Shorts, Instagram Reels) cambian la URL sin recargar.
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId === 0) void guard(d.tabId, d.url);
});

// ------------------------------------------------------------ tiempo de uso

interface Active {
  url: string;
  tabId: number;
  since: number;
}

let idleState: chrome.idle.IdleState = 'active';

async function getActive(): Promise<Active | undefined> {
  return (await chrome.storage.session.get('active')).active as Active | undefined;
}

/** Suma el tiempo de la pestaña activa y la reemplaza por la actual. */
async function account(): Promise<void> {
  await ready;
  if (!agent.paired) return;
  const now = Date.now();
  const prev = await getActive();
  if (prev && idleState === 'active' && isWeb(prev.url)) {
    const delta = Math.min(now - prev.since, 90_000);
    const decision = await agent.use({ type: 'web', url: prev.url }, delta);
    if (decision.blocked) await chrome.tabs.update(prev.tabId, { url: `${BLOCK_PAGE}?u=${encodeURIComponent(prev.url)}` }).catch(() => undefined);
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const next: Active | undefined = tab?.id !== undefined && tab.url ? { tabId: tab.id, url: tab.url, since: now } : undefined;
  await chrome.storage.session.set({ active: next });
}

chrome.tabs.onActivated.addListener(() => void account());
chrome.tabs.onUpdated.addListener((_id, info) => info.url && void account());
chrome.windows.onFocusChanged.addListener(() => void account());
chrome.idle.setDetectionInterval(120);
chrome.idle.onStateChanged.addListener((s) => {
  void account().then(() => (idleState = s));
});

// ------------------------------------------------------------ sincronización y protección

chrome.alarms.create('tick', { periodInMinutes: 0.5 });
chrome.alarms.create('sync', { periodInMinutes: 1 });
chrome.alarms.create('heartbeat', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (a) => {
  await ready;
  if (!agent.paired) return;
  if (a.name === 'tick') await account();
  if (a.name === 'sync') {
    await agent.sync().catch(() => undefined);
    await applySafeSearchRules();
    await checkBypassExtensions();
  }
  if (a.name === 'heartbeat') {
    const incognito = await chrome.extension.isAllowedIncognitoAccess();
    await agent.heartbeat({ protections: { extension: true, incognitoBlocked: incognito } }).catch(() => undefined);
  }
});

/** YouTube modo restringido mediante encabezado (lo respeta YouTube en todos los navegadores). */
async function applySafeSearchRules(): Promise<void> {
  if (!agent.paired || !chrome.declarativeNetRequest) return;
  const on = agent.state.bundle.policy.settings.enforceSafeSearch;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: on
      ? [
          {
            id: 1,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              requestHeaders: [{ header: 'YouTube-Restrict', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: 'Strict' }],
            },
            condition: { requestDomains: ['youtube.com', 'youtubei.googleapis.com', 'youtube.googleapis.com', 'youtube-nocookie.com'] },
          },
        ]
      : [],
  });
}

/** Detecta (y desactiva) extensiones de VPN/proxy que sirven para saltarse el filtro. */
async function checkBypassExtensions(): Promise<void> {
  if (!chrome.management?.getAll || !agent.state.bundle.policy.settings.blockBypassTools) return;
  const reported = ((await chrome.storage.local.get('bypassReported')).bypassReported as string[] | undefined) ?? [];
  for (const ext of await chrome.management.getAll()) {
    if (ext.id === chrome.runtime.id || !ext.enabled || !/\b(vpn|proxy|unblock|hola|tor)\b/i.test(`${ext.name} ${ext.description}`)) continue;
    if (!reported.includes(ext.id)) {
      reported.push(ext.id);
      await agent.report('bypass_detected', { label: `Extensión: ${ext.name}` });
    }
    if (ext.mayDisable) await chrome.management.setEnabled(ext.id, false).catch(() => undefined);
  }
  await chrome.storage.local.set({ bypassReported: reported });
}

// Ventanas de incógnito: si están prohibidas se cierran.
chrome.windows.onCreated.addListener(async (w) => {
  await ready;
  if (agent.paired && w.incognito && w.id !== undefined && agent.state.bundle.policy.settings.blockIncognito) {
    await chrome.windows.remove(w.id).catch(() => undefined);
    await agent.report('settings_attempt', { screen: 'Ventana de incógnito' });
  }
});

// ------------------------------------------------------------ mensajes de popup y página de bloqueo

type Message =
  | { type: 'status' }
  | { type: 'pair'; server: string; code: string; name: string }
  | { type: 'check'; url: string }
  | { type: 'request'; url: string; minutes: number; reason?: string }
  | { type: 'requestStatus'; id: string }
  | { type: 'code'; code: string };

async function handle(msg: Message): Promise<unknown> {
  await ready;
  if (msg.type === 'pair') {
    if (agent.paired && !agent.hasAdminAccess()) throw new Error('Ya está vinculada');
    await agent.pair(msg.server, msg.code, msg.name);
    agent.connectLive();
    await applySafeSearchRules();
    return { ok: true };
  }
  if (!agent.paired) return { paired: false };
  switch (msg.type) {
    case 'status':
      return { paired: true, profile: agent.state.bundle.profile, statuses: agent.statuses(), settings: agent.state.bundle.policy.settings };
    case 'check':
      return agent.check({ type: 'web', url: msg.url });
    case 'request': {
      const subject: Subject = { type: 'web', url: msg.url };
      const decision: Decision = agent.check(subject);
      if (decision.strict) throw new Error('Este bloqueo no admite solicitudes');
      return agent.requestUnlock(subject, decision, msg.minutes, msg.reason);
    }
    case 'requestStatus': {
      const r = await agent.requestStatus(msg.id);
      if (r.status === 'approved') await agent.sync();
      return r;
    }
    case 'code':
      return agent.enterCode(msg.code);
  }
}

chrome.runtime.onMessage.addListener((msg: Message, _sender, reply) => {
  handle(msg).then(
    (r) => reply({ ok: true, data: r }),
    (e: Error) => reply({ ok: false, error: e.message }),
  );
  return true;
});
