import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readlink } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { Platform } from '@guardian/core';

const run = promisify(execFile);

export interface ForegroundApp {
  id: string;
  label: string;
}

/** PowerShell residente que imprime el proceso en primer plano cada 2 s ("nombre|pid"). */
const WINDOWS_SCRIPT = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class GuardianFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
while ($true) {
  $h = [GuardianFg]::GetForegroundWindow(); $p = 0
  [void][GuardianFg]::GetWindowThreadProcessId($h, [ref]$p)
  $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
  if ($proc) { [Console]::Out.WriteLine("$($proc.ProcessName)|$p") } else { [Console]::Out.WriteLine("|") }
  [Console]::Out.Flush()
  Start-Sleep -Seconds 2
}`;

export function parseWindowsLine(line: string): ForegroundApp | null {
  const [name] = line.trim().split('|');
  if (!name) return null;
  return { id: `${name}.exe`, label: name };
}

export function parseLsappinfo(out: string): string | null {
  return /"CFBundleIdentifier"="([^"]+)"/.exec(out)?.[1] ?? null;
}

/** Detecta la app en primer plano del usuario actual. */
export class ForegroundWatcher {
  private latest: ForegroundApp | null = null;
  private ps: ChildProcess | null = null;

  constructor(private readonly platform: Platform) {}

  start(): void {
    if (this.platform !== 'windows') return;
    this.ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', WINDOWS_SCRIPT], { windowsHide: true });
    let buf = '';
    this.ps.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      const last = lines.filter(Boolean).pop();
      if (last !== undefined) this.latest = parseWindowsLine(last);
    });
    this.ps.on('exit', () => {
      this.ps = null;
      setTimeout(() => this.start(), 5000);
    });
  }

  stop(): void {
    this.ps?.kill();
  }

  async current(): Promise<ForegroundApp | null> {
    try {
      if (this.platform === 'windows') return this.latest;
      if (this.platform === 'macos') {
        const front = (await run('lsappinfo', ['front'])).stdout.trim();
        const info = (await run('lsappinfo', ['info', '-only', 'bundleid', front])).stdout;
        const name = /"LSDisplayName"="([^"]+)"/.exec((await run('lsappinfo', ['info', '-only', 'name', front])).stdout)?.[1];
        const id = parseLsappinfo(info);
        return id ? { id, label: name ?? id } : null;
      }
      // Linux (X11). En Wayland no hay forma estándar: se usa sólo el cierre de procesos.
      const pid = (await run('xdotool', ['getactivewindow', 'getwindowpid'])).stdout.trim();
      const exe = await readlink(`/proc/${pid}/exe`);
      const id = exe.split('/').pop() ?? exe;
      return { id, label: id };
    } catch {
      return null;
    }
  }
}
