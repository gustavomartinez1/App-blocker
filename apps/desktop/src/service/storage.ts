import type { AgentData, AgentStorage } from '@guardian/core';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Guarda el estado del agente en un archivo JSON con escritura atómica. */
export class FileStorage implements AgentStorage {
  constructor(private readonly path: string) {}

  async load(): Promise<AgentData | null> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as AgentData;
    } catch {
      return null;
    }
  }

  async save(data: AgentData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await rename(tmp, this.path);
  }
}
