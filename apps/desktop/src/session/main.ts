import { formatDuration, type Decision, type RuleStatus } from '@guardian/core';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, Tray } from 'electron';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentPlatform, dataDir, LOCAL_API_PORT } from '../service/platform.js';
import { ForegroundWatcher } from './foreground.js';

/**
 * App de sesión: corre en la sesión del usuario (inicio automático), detecta
 * la app en primer plano, muestra la pantalla de bloqueo y los avisos, y
 * permite pedir desbloqueos o usar códigos. Toda la lógica vive en el
 * servicio privilegiado; si cierran esta app, el servicio lo reporta al admin.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const ui = (file: string) => join(here, 'ui', file);
const platform = currentPlatform();
const IDLE_SECONDS = 120;

let tray: Tray | null = null;
let overlay: BrowserWindow | null = null;
let pairWindow: BrowserWindow | null = null;
let lastDecision: { foreground: Decision | null; desktop: Decision } | null = null;
let lastForeground: { id: string; label: string } | null = null;
const warned = new Set<string>();

function token(): string {
  return readFileSync(join(dataDir(platform), 'session.token'), 'utf8').trim();
}

async function service<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${LOCAL_API_PORT}${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

function showPairWindow(): void {
  if (pairWindow) return pairWindow.focus();
  pairWindow = new BrowserWindow({
    width: 460,
    height: 560,
    resizable: false,
    title: 'Vincular Guardián',
    webPreferences: { preload: ui('preload.cjs'), contextIsolation: true },
  });
  void pairWindow.loadFile(ui('pair.html'), { query: { name: hostname() } });
  pairWindow.on('closed', () => (pairWindow = null));
}

function showOverlay(decision: Decision, label: string): void {
  const payload = JSON.stringify({ decision, label });
  if (overlay) {
    overlay.webContents.send('decision', payload);
    if (!overlay.isVisible()) overlay.show();
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.focus();
    return;
  }
  const { bounds } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    ...bounds,
    frame: false,
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    closable: false,
    minimizable: false,
    movable: false,
    webPreferences: { preload: ui('preload.cjs'), contextIsolation: true },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  void overlay.loadFile(ui('blocked.html'), { query: { data: payload } });
  overlay.on('closed', () => (overlay = null));
}

function hideOverlay(): void {
  if (overlay?.isVisible()) overlay.hide();
}

async function loop(): Promise<void> {
  try {
    const status = await service<{ paired: boolean; statuses?: RuleStatus[]; warnBeforeMinutes?: number }>('/status');
    if (!status.paired) {
      hideOverlay();
      showPairWindow();
      return;
    }
    const idle = powerMonitor.getSystemIdleTime() > IDLE_SECONDS || powerMonitor.getSystemIdleState(IDLE_SECONDS) === 'locked';
    const fg = await watcher.current();
    lastForeground = fg;
    const d = await service<{ foreground: Decision | null; desktop: Decision }>('/foreground', 'POST', { app: fg, idle });
    lastDecision = d;

    if (d.desktop.blocked) {
      showOverlay(d.desktop, 'la computadora');
    } else if (d.foreground?.blocked && fg) {
      // El servicio ya cerró la app; avisamos por qué.
      new Notification({ title: `${fg.label} está bloqueada`, body: d.foreground.message }).show();
      hideOverlay();
    } else {
      hideOverlay();
    }
    warnings(status.statuses ?? [], status.warnBeforeMinutes ?? 5);
    updateTray(status.statuses ?? []);
  } catch (e) {
    tray?.setToolTip(`Guardián: sin conexión con el servicio (${(e as Error).message})`);
  }
}

function warnings(statuses: RuleStatus[], minutes: number): void {
  if (!minutes) return;
  const day = new Date().toDateString();
  for (const s of statuses) {
    const key = `${day}:${s.ruleId}`;
    if (!s.blocked && s.remainingMs !== undefined && s.remainingMs > 0 && s.remainingMs <= minutes * 60_000 && !warned.has(key)) {
      warned.add(key);
      new Notification({ title: 'Se acaba el tiempo', body: `Te quedan ${formatDuration(s.remainingMs)} de “${s.name}”.` }).show();
    }
  }
}

function updateTray(statuses: RuleStatus[]): void {
  if (!tray) return;
  const limits = statuses.filter((s) => s.remainingMs !== undefined && !s.blocked);
  const lines = limits.map((s) => `${s.name}: quedan ${formatDuration(s.remainingMs!)}`);
  tray.setToolTip(['Guardián activo', ...lines].join('\n'));
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromPath(ui('tray.png')).resize({ width: 16, height: 16 }));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Guardián está protegiendo este equipo', enabled: false },
      { type: 'separator' },
      { label: 'Pedir más tiempo…', click: () => lastDecision && showOverlay({ ...lastDecision.desktop, blocked: true, message: 'Pide más tiempo al administrador' }, lastForeground?.label ?? 'la computadora') },
      { label: 'Sincronizar ahora', click: () => void service('/sync', 'POST').catch(() => undefined) },
    ]),
  );
}

// ------------------------------------------------------------ IPC con las ventanas

ipcMain.handle('guardian:pair', async (_e, server: string, code: string, name: string) => {
  const r = await service('/pair', 'POST', { server, code, name });
  pairWindow?.close();
  return r;
});
ipcMain.handle('guardian:request', async (_e, minutes: number, reason: string) => {
  const subject = lastDecision?.desktop.blocked || !lastForeground ? undefined : { type: 'app', platform, id: lastForeground.id, label: lastForeground.label };
  return service('/request', 'POST', { subject, minutes, reason });
});
ipcMain.handle('guardian:requestStatus', (_e, id: string) => service(`/request/${encodeURIComponent(id)}`));
ipcMain.handle('guardian:code', async (_e, code: string) => {
  const r = await service<{ ok: boolean }>('/code', 'POST', { code });
  if (r.ok) setTimeout(() => void loop(), 200);
  return r;
});
ipcMain.handle('guardian:close', () => hideOverlay());

// ------------------------------------------------------------ arranque

const watcher = new ForegroundWatcher(platform);

if (!app.requestSingleInstanceLock()) app.quit();
app.setLoginItemSettings({ openAtLogin: true });
app.on('window-all-closed', () => {
  /* sigue corriendo en la bandeja */
});
void app.whenReady().then(() => {
  watcher.start();
  createTray();
  void loop();
  setInterval(() => void loop(), 2000);
});
