import { cpSync } from 'node:fs';
cpSync(new URL('../src/session/ui', import.meta.url), new URL('../dist/session/ui', import.meta.url), { recursive: true });
