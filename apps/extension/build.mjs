import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const core = fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url));
rmSync('dist', { recursive: true, force: true });

for (const target of ['chrome', 'firefox']) {
  const out = `dist/${target}`;
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: { background: 'src/background.ts', blocked: 'src/blocked.ts', popup: 'src/popup.ts' },
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outdir: out,
    alias: { '@guardian/core': core },
    minify: true,
    define: { __TARGET__: JSON.stringify(target) },
  });
  cpSync('static', out, { recursive: true });
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  if (target === 'firefox') {
    // Firefox usa background.scripts y requiere un id propio.
    manifest.background = { scripts: ['background.js'], type: 'module' };
    manifest.browser_specific_settings = { gecko: { id: 'guardian@guardian.app', strict_min_version: '121.0' } };
    manifest.permissions = manifest.permissions.filter((p) => p !== 'management');
  }
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
}
console.log('Extensión lista en dist/chrome y dist/firefox');
