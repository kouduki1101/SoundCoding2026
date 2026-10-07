import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'pnpm',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
const all = process.argv.includes('--all');
const base = process.argv[process.argv.indexOf('--base') + 1];
const diff = spawnSync(
  'git',
  ['diff', '--name-only', ...(process.argv.includes('--base') ? [`${base}...HEAD`] : ['HEAD'])],
  { encoding: 'utf8' },
);
const files = diff.status === 0 ? diff.stdout.split('\n').filter(Boolean) : [];
let dependenciesChanged = false;
let sampleScriptsChanged = false;
if (files.includes('package.json')) {
  const previous = spawnSync(
    'git',
    ['show', `${process.argv.includes('--base') ? base : 'HEAD'}:package.json`],
    { encoding: 'utf8' },
  );
  try {
    const before = JSON.parse(previous.stdout),
      after = JSON.parse(readFileSync('package.json', 'utf8'));
    const dependencyKeys = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
      'pnpm',
      'packageManager',
      'engines',
    ];
    const sampleScripts = ['sample:checkout', 'test:sample'];
    dependenciesChanged =
      dependencyKeys.some((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])) ||
      [...new Set([...Object.keys(before.scripts ?? {}), ...Object.keys(after.scripts ?? {})])].some(
        (key) => !sampleScripts.includes(key) && before.scripts?.[key] !== after.scripts?.[key],
      );
    sampleScriptsChanged = sampleScripts.some((key) => before.scripts?.[key] !== after.scripts?.[key]);
  } catch {
    dependenciesChanged = true;
  }
}
const contracts =
  all ||
  dependenciesChanged ||
  files.some((path) =>
    /^(contracts\/|packages\/contracts\/|pnpm-lock|uv.lock|pyproject|scripts\/(generate|build-tools))/.test(
      path,
    ),
  );
const backend =
  contracts ||
  files.some(
    (path) =>
      path !== 'tests/test_repository_preflight.py' &&
      /^(apps\/backend\/|tests\/test_|prompts\/)/.test(path),
  );
const preflight =
  all ||
  files.some((path) => /^(scripts\/repository-preflight\.py|tests\/test_repository_preflight\.py)$/.test(path));
const music =
  contracts ||
  files.some((path) =>
    /^(packages\/(groove-core|repo-indexer)\/|fixtures\/|apps\/web\/public\/audio\/|assets\/audio-source\/|tests\/.*\.test\.ts|scripts\/(build-clean-kit|audio_render))/.test(
      path,
    ),
  );
const web =
  contracts || music || files.some((path) => /^(apps\/web\/|tests\/e2e\/|playwright.config)/.test(path));
const tooling = files.some((path) => /^(infra\/|scripts\/|\.github\/)/.test(path));
const sample =
  all ||
  sampleScriptsChanged ||
  files.some((path) =>
    /^(examples\/checkout-lab\/|fixtures\/repos\/checkout-flow\/|apps\/web\/public\/samples\/|scripts\/build-sample)/.test(
      path,
    ),
  );
console.log(JSON.stringify({ backend, music, web, sample, preflight, files: files.length }));
if (process.argv.includes('--list')) process.exit(0);
if (tooling && !backend) run('uv', ['run', 'ruff', 'check', 'infra', 'scripts']);
if (tooling && !web) run('pnpm', ['exec', 'eslint', 'scripts/*.mjs']);
if (backend || music || web || preflight) run('pnpm', ['build:tools']);
if (backend) {
  run('uv', ['run', 'ruff', 'check', 'apps/backend', 'scripts', 'tests', 'infra']);
  run('uv', ['run', 'mypy', 'apps/backend']);
  run('uv', ['run', 'pytest', '-m', 'not live', '-q']);
  run('uv', ['run', 'python', 'scripts/generate-contracts.py', '--check']);
}
if (music) {
  run('pnpm', ['test']);
  run('uv', ['run', 'python', 'scripts/build-kit.py', '--verify']);
  run('uv', ['run', 'python', 'scripts/build-jazz-kit.py', '--verify']);
  run('uv', ['run', 'python', 'scripts/build-clean-kit.py', '--verify']);
}
if (web) {
  run('pnpm', ['typecheck']);
  run('pnpm', ['lint']);
  run('pnpm', ['build']);
  run('pnpm', ['test:e2e']);
}
if (sample) {
  run('uv', ['run', 'python', 'scripts/build-sample.py', '--check']);
  run('pnpm', ['exec', 'tsc', '--noEmit', '-p', 'examples/checkout-lab']);
  run('pnpm', ['exec', 'eslint', 'examples/checkout-lab/*.ts']);
  run('pnpm', ['test:sample']);
  run('node', ['--test', 'examples/checkout-lab/tests/store.test.mjs']);
}
if (preflight && !backend) run('uv', ['run', 'pytest', 'tests/test_repository_preflight.py', '-q']);
if (!(backend || music || web || sample || preflight))
  console.log('Documentation/infrastructure-only change: application suites skipped.');
