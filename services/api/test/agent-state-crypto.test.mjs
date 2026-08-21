import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { AgentStateCrypto, parseAgentStateKeys } from '../src/agent-state-crypto.mjs';

test('agent state encryption binds ciphertext to metadata and key version', () => {
  const encoded = randomBytes(32).toString('base64');
  const crypto = new AgentStateCrypto({
    currentKeyVersion: 2,
    keys: parseAgentStateKeys(`1:${randomBytes(32).toString('base64')},2:${encoded}`, 2),
  });
  const metadata = { kind: 'test', runId: 'run', schemaVersion: 1 };
  const envelope = crypto.encryptJson({ private: 'value' }, metadata);
  assert.equal(envelope.keyVersion, 2);
  assert.deepEqual(crypto.decryptJson(envelope, metadata), { private: 'value' });
  assert.throws(() => crypto.decryptJson(envelope, { ...metadata, runId: 'other' }));
  const tampered = { ...envelope, ciphertext: Buffer.from(envelope.ciphertext) };
  tampered.ciphertext[0] ^= 1;
  assert.throws(() => crypto.decryptJson(tampered, metadata));
});
