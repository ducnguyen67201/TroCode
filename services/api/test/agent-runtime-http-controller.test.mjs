import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { AgentRuntimeHttpController } from '../src/agent-runtime-http-controller.mjs';

test('task SSE remains open until the response closes', async () => {
  const controller = new AgentRuntimeHttpController({
    desktopWorkerController: {},
    eventStream: {
      runEvents: async function* runEvents() {
        yield new TextEncoder().encode('data: {}\n\n');
      },
    },
    rolloutPolicy: { enabledFor: () => true },
    runService: {
      get: async () => ({ id: '11111111-1111-4111-8111-111111111111' }),
    },
  });
  const request = Object.assign(new EventEmitter(), {
    headers: {},
    method: 'GET',
  });
  const response = new EventEmitter();
  const chunks = [];
  const handled = await controller.handle({
    access: { plan: 'free' },
    helpers: {
      sendStream: async (_response, _status, stream) => {
        for await (const chunk of stream) chunks.push(chunk);
      },
    },
    request,
    response,
    session: { user: { id: 'user-1' } },
    url: new URL('https://api.example/v1/tasks/11111111-1111-4111-8111-111111111111/events'),
  });

  assert.equal(handled, true);
  assert.equal(request.listenerCount('close'), 0);
  assert.equal(response.listenerCount('close'), 1);
  assert.equal(chunks.length, 1);
});
