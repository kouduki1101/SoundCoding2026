import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
await mkdir('dist/tools', { recursive: true });
for (const name of ['groove-core', 'repo-indexer', 'structure']) {
  await build({
    entryPoints: [
      resolve(
        name === 'structure' ? 'packages/repo-indexer/src/structure-cli.ts' : `packages/${name}/src/cli.ts`,
      ),
    ],
    outfile: `dist/tools/${name}.mjs`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    banner: {
      js: "import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url'; import { dirname } from 'node:path'; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);",
    },
  });
}
