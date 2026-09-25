import type { WebSocket } from 'ws';

export type HubMessage =
  | { type: 'policy'; profileId: string; version: number }
  | { type: 'request'; request: unknown }
  | { type: 'event'; event: unknown }
  | { type: 'device'; device: unknown }
  | { type: 'usage'; profileId: string }
  | { type: 'hello'; role: 'admin' | 'device' };

/** Conexiones WebSocket en vivo: panel de cada familia y agentes de cada dispositivo. */
export class Hub {
  private readonly families = new Map<string, Set<WebSocket>>();
  private readonly devices = new Map<string, Set<WebSocket>>();

  addAdmin(familyId: string, ws: WebSocket): void {
    this.add(this.families, familyId, ws);
  }

  addDevice(deviceId: string, ws: WebSocket): void {
    this.add(this.devices, deviceId, ws);
  }

  toFamily(familyId: string, msg: HubMessage): void {
    this.send(this.families.get(familyId), msg);
  }

  toDevice(deviceId: string, msg: HubMessage): void {
    this.send(this.devices.get(deviceId), msg);
  }

  isDeviceConnected(deviceId: string): boolean {
    return (this.devices.get(deviceId)?.size ?? 0) > 0;
  }

  disconnectDevice(deviceId: string): void {
    for (const ws of this.devices.get(deviceId) ?? []) ws.close(4001, 'unpaired');
    this.devices.delete(deviceId);
  }

  private add(map: Map<string, Set<WebSocket>>, key: string, ws: WebSocket): void {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(ws);
    ws.on('close', () => {
      set.delete(ws);
      if (set.size === 0) map.delete(key);
    });
  }

  private send(set: Set<WebSocket> | undefined, msg: HubMessage): void {
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }
}
