import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentTurnService } from '../src/agent-turn-service.mjs';

class MemoryAgentTurnRepository {
  constructor(monthMessages = 0) {
    this.monthMessages = monthMessages;
    this.turns = new Map();
  }

  async create(input) {
    const key = `${input.userId}:${input.clientTurnId}`;
    const existing = this.turns.get(key);
    if (existing) return { kind: 'duplicate', turn: existing };
    const denial = input.authorize({ monthMessages: this.monthMessages });
    if (denial && input.enforce) return { denial, kind: 'denied' };
    const turn = {
      clientTurnId: input.clientTurnId,
      createdAt: '2026-08-18T10:00:00.000Z',
      id: `server-${input.clientTurnId}`,
      plan: input.planId,
      taskId: input.taskId,
    };
    this.turns.set(key, turn);
    this.monthMessages += 1;
    return { denial, kind: 'created', turn };
  }
}

function request(clientTurnId) {
  return {
    clientTurnId,
    planId: 'basic',
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
  };
}

test('Basic reserves exactly one monthly message per user turn', async () => {
  const repository = new MemoryAgentTurnRepository(1_199);
  const service = new AgentTurnService(repository, { mode: 'enforce' });

  const accepted = await service.create(
    request('22222222-2222-4222-8222-222222222222'),
  );
  assert.equal(accepted.newlyCreated, true);
  assert.equal(repository.monthMessages, 1_200);

  await assert.rejects(
    service.create(request('33333333-3333-4333-8333-333333333333')),
    (error) => error.code === 'monthly_message_limit_reached',
  );
});

test('repeating a client turn ID is idempotent and does not consume another message', async () => {
  const repository = new MemoryAgentTurnRepository();
  const service = new AgentTurnService(repository, { mode: 'enforce' });
  const input = request('22222222-2222-4222-8222-222222222222');

  const first = await service.create(input);
  const duplicate = await service.create(input);

  assert.equal(first.id, duplicate.id);
  assert.equal(duplicate.newlyCreated, false);
  assert.equal(repository.monthMessages, 1);
});
