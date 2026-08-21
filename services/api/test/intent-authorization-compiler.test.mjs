import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  compileIntentAuthorization,
  intentAuthorizationDigest,
} from '../src/intent-authorization-compiler.mjs';

const fixtures = JSON.parse(await readFile(
  new URL('../../../test/fixtures/intent-authorization-cases.json', import.meta.url),
  'utf8',
));

test('backend intent compiler matches the shared parity fixtures', () => {
  for (const fixture of fixtures) {
    const contract = compileIntentAuthorization(fixture.request, fixture);
    assert.deepEqual(
      contract.grants.map(({ effectKind, permitsSafeDefaults, resourceKinds }) => ({
        effectKind,
        permitsSafeDefaults,
        resourceKinds,
      })),
      fixture.expected,
      fixture.name,
    );
    assert.equal(intentAuthorizationDigest(contract), fixture.expectedDigest);
  }
});

test('disabled intent authorization emits a deterministic fail-closed v8 contract', () => {
  const contract = compileIntentAuthorization('Create a calendar event.', {
    enabled: false,
    revision: 4,
  });
  assert.equal(contract.revision, 4);
  assert.deepEqual(contract.grants, []);
});
