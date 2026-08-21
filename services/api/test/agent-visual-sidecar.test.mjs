import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentVisualSidecar } from '../src/agent-visual-sidecar.mjs';

test('visual sidecar is memory-only, bounded, and consume-once', () => {
  const sidecar = new AgentVisualSidecar({ maxBytes: 10 });
  sidecar.put('invocation', {
    dataBase64: Buffer.from('image').toString('base64'),
    detail: 'original',
    mimeType: 'image/jpeg',
    observationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  assert.match(sidecar.take('invocation').imageUrl, /^data:image\/jpeg;base64,/u);
  assert.equal(sidecar.take('invocation'), null);
  assert.throws(() => sidecar.put('large', {
    dataBase64: Buffer.alloc(11).toString('base64'), detail: 'original', mimeType: 'image/jpeg', observationId: 'id',
  }), /exceeds/u);
});
