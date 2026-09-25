export async function send<T>(msg: Record<string, unknown>): Promise<T> {
  const r = (await chrome.runtime.sendMessage(msg)) as { ok: boolean; data?: T; error?: string };
  if (!r?.ok) throw new Error(r?.error ?? 'Error');
  return r.data as T;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
