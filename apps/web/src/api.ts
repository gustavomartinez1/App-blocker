import type { Override, Policy, RuleStatus, Target } from '@guardian/core';
import { useCallback, useEffect, useRef, useState } from 'react';

const API = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const TOKEN_KEY = 'guardian.token';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event('guardian:auth'));
}

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    if (res.status === 401 && token) setToken(null);
    const issues = (data as { issues?: { path: string; message: string }[] })?.issues;
    const detail = issues?.length ? `: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}` : '';
    throw new ApiError(res.status, ((data as { error?: string })?.error ?? `Error ${res.status}`) + detail);
  }
  return data as T;
}

// ------------------------------------------------------------------ tipos

export interface Device {
  id: string;
  profileId: string;
  name: string;
  platform: string;
  agentVersion: string | null;
  status: Record<string, unknown>;
  policyVersion: number;
  lastSeen: number | null;
  online: boolean;
  createdAt: number;
}

export interface ProfileSummary {
  id: string;
  name: string;
  avatar: string | null;
  mode: 'supervised' | 'self';
  timezone: string;
  policyVersion: number;
  overrides: Override[];
  devices: Device[];
  pendingRequests: number;
  unreadAlerts: number;
}

export interface RequestItem {
  id: string;
  profileId: string;
  deviceId: string | null;
  kind: 'unlock' | 'more_time' | 'new_app';
  ruleId: string | null;
  target: Target | null;
  label: string;
  reason: string | null;
  minutesRequested: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  minutesGranted: number | null;
  createdAt: number;
  decidedAt: number | null;
}

export interface EventItem {
  id: string;
  profileId: string;
  deviceId: string | null;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: number;
}

export interface UsageSummary {
  day: string;
  totalMs: number;
  rules: RuleStatus[];
  items: { key: string; label: string; usedMs: number; opens: number; blockedAttempts: number }[];
  devices: { deviceId: string; usedMs: number }[];
}

export interface PendingChange {
  id: string;
  kind: 'policy' | 'override';
  payload: unknown;
  applyAt: number;
  createdAt: number;
}

export interface PolicyResponse {
  policy: Policy;
  pending: PendingChange[];
}

// ------------------------------------------------------------------ en vivo

type LiveMessage = { type: string; [k: string]: unknown };
const liveTarget = new EventTarget();
let socket: WebSocket | null = null;
let retry = 0;

function connectLive(): void {
  const token = getToken();
  if (!token || socket) return;
  const base = API || window.location.origin;
  const url = `${base.replace(/^http/, 'ws')}/api/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => (retry = 0);
  ws.onmessage = (e) => {
    try {
      liveTarget.dispatchEvent(new CustomEvent<LiveMessage>('msg', { detail: JSON.parse(e.data as string) }));
    } catch {
      /* mensaje inválido */
    }
  };
  ws.onclose = () => {
    socket = null;
    if (getToken()) setTimeout(connectLive, Math.min(30_000, 1000 * 2 ** retry++));
  };
}

window.addEventListener('guardian:auth', () => {
  if (!getToken()) socket?.close();
  else connectLive();
});

/** Recibe mensajes en vivo del servidor (políticas, solicitudes, alertas, uso). */
export function useLive(handler: (msg: LiveMessage) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    connectLive();
    const listener = (e: Event) => ref.current((e as CustomEvent<LiveMessage>).detail);
    liveTarget.addEventListener('msg', listener);
    return () => liveTarget.removeEventListener('msg', listener);
  }, []);
}

/** Carga datos y los recarga cuando llegan mensajes en vivo de ciertos tipos. */
export function useData<T>(path: string | null, liveTypes: string[] = []): { data: T | undefined; error: string | undefined; reload: () => void; loading: boolean } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    api<T>(path)
      .then((d) => alive && (setData(d), setError(undefined)))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, n]);
  useLive((msg) => {
    if (liveTypes.includes(msg.type)) reload();
  });
  return { data, error, reload, loading };
}
