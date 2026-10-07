import { execFileSync } from 'node:child_process';

if (process.env.E2E_LIVE_HEALTH !== '1') {
  throw new Error(
    'Set E2E_LIVE_HEALTH=1 to authorize paid investigation and optional Gemini proposal/re-analysis. This records explicit test approval if a concern remains.',
  );
}
execFileSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'playwright', 'test', 'tests/e2e/live-health.spec.ts', '--workers=1'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      E2E_BASE_URL: process.env.E2E_BASE_URL ?? 'https://code-groove-web-a5ygiois2a-an.a.run.app',
    },
  },
);
console.log('Recorded actual deployed health workflow. Run scripts/assemble-demo.py without another model call.');
