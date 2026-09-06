import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSource, isTest, lineCount, sizeViolations } from './source-size.mts';

const file = (path: string, lines: number, test = false) => ({
  path,
  lines,
  test,
});

test('physical lines count final newlines consistently', () => {
  assert.equal(lineCount(''), 0);
  assert.equal(lineCount('one'), 1);
  assert.equal(lineCount('one\n'), 1);
  assert.equal(lineCount('one\r\ntwo\r\n'), 2);
});

test('inventory distinguishes source, tests and generated dependencies', () => {
  assert.ok(isSource('apps/admin/src/styles.css'));
  assert.ok(isSource('services/api/src/http.rs'));
  assert.ok(!isSource('services/agent-runtime/dist/index.js'));
  assert.ok(!isSource('services/api/admin-dist/assets/admin.js'));
  assert.ok(!isSource('apps/admin/node_modules/package/index.js'));
  assert.ok(isTest('src/renderer/App.test.tsx'));
  assert.ok(isTest('services/api/tests/http.rs'));
  assert.ok(isTest('src/test-support/fixture.ts'));
});

test('new oversized files and renamed exceptions fail', () => {
  assert.deepEqual(sizeViolations([file('src/small.ts', 500)], {}), []);
  assert.match(
    sizeViolations([file('src/new.ts', 501)], {})[0]!,
    /exceeds 500/,
  );
  assert.match(
    sizeViolations(
      [file('src/renamed.ts', 800)],
      { 'src/renamed.ts': 800 },
      { 'src/old.ts': 800 },
    ).join('\n'),
    /cannot increase/,
  );
});

test('existing exceptions cannot grow or be manually enlarged', () => {
  assert.deepEqual(
    sizeViolations([file('src/old.ts', 800)], { 'src/old.ts': 800 }),
    [],
  );
  assert.match(
    sizeViolations([file('src/old.ts', 801)], { 'src/old.ts': 800 })[0]!,
    /exceeds 800/,
  );
  assert.match(
    sizeViolations(
      [file('src/old.ts', 900)],
      { 'src/old.ts': 900 },
      { 'src/old.ts': 800 },
    ).join('\n'),
    /cannot increase/,
  );
});

test('exemptions must shrink with files and disappear with deleted files', () => {
  assert.match(
    sizeViolations([file('src/old.ts', 650)], { 'src/old.ts': 800 })[0]!,
    /lower baseline to 650/,
  );
  assert.match(sizeViolations([], { 'src/old.ts': 800 })[0]!, /stale baseline/);
  assert.deepEqual(
    sizeViolations([file('src/big.test.ts', 2000, true)], {}),
    [],
  );
});
