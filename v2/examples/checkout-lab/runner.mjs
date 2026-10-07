import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const directory = dirname(fileURLToPath(import.meta.url));
const core = existsSync(resolve(directory, 'src'))
  ? resolve(directory, 'src')
  : resolve(directory, '../../fixtures/repos/checkout-flow/src');
for (const [name, platform] of [
  ['server', 'node'],
  ['app', 'browser'],
]) {
  await build({
    entryPoints: [resolve(directory, `${name}.ts`)],
    outfile: resolve(directory, `dist/${name}.mjs`),
    bundle: true,
    alias: { '@checkout': core },
    platform,
    format: 'esm',
    target: platform === 'node' ? 'node22' : 'es2023',
  });
}
const { startServer } = await import('./dist/server.mjs');
await startServer(directory, core);
