import assert from 'node:assert/strict';
import test from 'node:test';

import {
  openAccessCode,
  sealAccessCode,
} from '../src/access-code-cipher.mjs';

const TEST_KEY = 'test-access-code-cipher-key-that-is-at-least-32-characters';
const TEST_DIGEST = Buffer.alloc(32, 7);

test('encrypts access codes for later admin retrieval without storing plaintext', () => {
  const first = sealAccessCode('TRO-SECRET-CODE', TEST_KEY, TEST_DIGEST);
  const second = sealAccessCode('TRO-SECRET-CODE', TEST_KEY, TEST_DIGEST);

  assert.ok(Buffer.isBuffer(first));
  assert.equal(first.includes(Buffer.from('TRO-SECRET-CODE')), false);
  assert.notDeepEqual(first, second);
  assert.equal(
    openAccessCode(first, TEST_KEY, TEST_DIGEST),
    'TRO-SECRET-CODE',
  );
});

test('refuses to decrypt an access code with a different digest', () => {
  const sealed = sealAccessCode('TRO-SECRET-CODE', TEST_KEY, TEST_DIGEST);

  assert.throws(
    () => openAccessCode(sealed, TEST_KEY, Buffer.alloc(32, 8)),
    /authenticate access code/u,
  );
});
