import { spawnSync } from 'node:child_process';

import { TEST_API_BASE_URL, testAppEnvironment } from './test-app-config.mts';

const command = process.argv[2];
if (command !== 'start' && command !== 'package') {
  throw new Error('Use npm run start:test or npm run package:test.');
}
const env = testAppEnvironment(process.env, command);
const revision = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' });
if (revision.status === 0 && /^[a-f0-9]{12}$/u.test(revision.stdout.trim())) {
  env.TROCODE_BUILD_COMMIT = revision.stdout.trim();
}
console.log(`Tro Test → ${TEST_API_BASE_URL} (Doppler tro-app/stg)`);
if (command === 'start') {
  const response = await fetch(`${env.TROCODE_API_BASE_URL}/readyz`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Test API is not ready (HTTP ${response.status}).`);
}

function npm(args: string[]): void {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Launch through npm run start:test or npm run package:test.');
  const child = spawnSync(process.execPath, [cli, ...args], { env, stdio: 'inherit' });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}

npm(['run', 'agent-sdk:build']);
if (command === 'package') npm(['run', 'admin:build']);
npm(['exec', '--', 'electron-forge', command]);
