import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import path from 'node:path';

test('validates the committed protocol manifest when Codex is unavailable', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/generate-codex-app-server-types.mjs', '--check'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        TROCODE_CODEX_PATH: path.join(process.cwd(), 'missing-codex-executable'),
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /validated the committed 0\.146\.0 protocol manifest/u);
});
