import assert from 'node:assert/strict';
import test from 'node:test';

import { BudgetService } from '../src/budget-service.mjs';

class MemoryUsageRepository {
  reservations = new Map();

  committed = {
    dayMicroUsd: 0,
    monthMessages: 0,
    monthMicroUsd: 0,
    taskMicroUsd: 0,
  };

  async reserve(input) {
    const key = `${input.userId}:${input.requestId}`;
    if (this.reservations.has(key)) {
      return { kind: 'duplicate', reservation: this.reservations.get(key) };
    }
    const denial = input.authorize(this.committed);
    if (denial && input.enforce) return { denial, kind: 'denied' };
    const reservation = {
      actualMicroUsd: null,
      requestId: input.requestId,
      reservedMicroUsd: input.reservedMicroUsd,
      status: 'reserved',
    };
    this.reservations.set(key, reservation);
    this.committed = {
      dayMicroUsd: this.committed.dayMicroUsd + input.reservedMicroUsd,
      monthMessages: this.committed.monthMessages,
      monthMicroUsd: this.committed.monthMicroUsd + input.reservedMicroUsd,
      taskMicroUsd: this.committed.taskMicroUsd + input.reservedMicroUsd,
    };
    return { denial, kind: 'reserved', reservation };
  }

  async markDispatched() {}
  async settle(input) {
    return { actualMicroUsd: input.actualMicroUsd, status: 'settled' };
  }
  async release() {}
  async markUncertain() {}
  async snapshot() {
    return {
      dayEndsAt: '2026-08-18T00:00:00.000Z',
      dayReservedMicroUsd: this.committed.dayMicroUsd,
      daySettledMicroUsd: 0,
      monthEndsAt: '2026-09-01T00:00:00.000Z',
      monthMessages: this.committed.monthMessages,
      monthReservedMicroUsd: this.committed.monthMicroUsd,
      monthSettledMicroUsd: 0,
      taskReservedMicroUsd: this.committed.taskMicroUsd,
      taskSettledMicroUsd: 0,
    };
  }
}

function service(repository, mode = 'enforce') {
  return new BudgetService(repository, {
    dailyMicroUsd: 100,
    enabled: true,
    mode,
    monthlyMicroUsd: 100,
    realtimeCallMicroUsd: 5,
    reservationTtlMs: 60_000,
    speechMicroUsdPerThousandCharacters: 60_000,
    transcriptionMicroUsdPerMinute: 6_000,
    taskMicroUsd: 100,
    warningPercent: 80,
  });
}

test('concurrent reservations cannot cross an enforced cap', async () => {
  const budget = service(new MemoryUsageRepository());
  const request = (requestId) =>
    budget.reserve({
      catalogVersion: 'v1',
      agentTurnId: '22222222-2222-4222-8222-222222222222',
      lane: 'responses',
      model: 'test',
      requestId,
      reservedMicroUsd: 60,
      taskId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
      planId: 'basic',
    });
  const results = await Promise.allSettled([
    request('11111111-1111-4111-8111-111111111112'),
    request('11111111-1111-4111-8111-111111111113'),
  ]);
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ['fulfilled', 'rejected'],
  );
});

test('observe mode records would-deny reservations and snapshots remain sanitized', async () => {
  const budget = service(new MemoryUsageRepository(), 'observe');
  await budget.reserve({
    catalogVersion: 'v1',
    agentTurnId: '22222222-2222-4222-8222-222222222222',
    lane: 'responses',
    model: 'test',
    requestId: '11111111-1111-4111-8111-111111111112',
    reservedMicroUsd: 120,
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
    planId: 'basic',
  });
  const snapshot = await budget.snapshot('user-1');
  assert.equal(snapshot.enforcementMode, 'observe');
  assert.equal(snapshot.monthly.remainingMicroUsd, 0);
  assert.deepEqual(snapshot.messages, {
    limit: 1_200,
    remaining: 1_200,
    used: 0,
  });
  assert.equal(snapshot.plan, 'basic');
  assert.deepEqual(snapshot.pricing, { currency: 'usd', monthlyCents: 2_000 });
  assert.equal('prompt' in snapshot, false);
  assert.equal(budget.speechEstimateMicroUsd(240), 14_400);
});

test('multiple provider calls do not increment the user-turn message count', async () => {
  const repository = new MemoryUsageRepository();
  const budget = service(repository);
  const request = (requestId) =>
    budget.reserve({
      catalogVersion: 'v1',
      agentTurnId: '22222222-2222-4222-8222-222222222222',
      lane: 'responses',
      model: 'test',
      planId: 'basic',
      requestId,
      reservedMicroUsd: 0,
      taskId: '11111111-1111-4111-8111-111111111111',
      userId: 'user-1',
    });

  await request('11111111-1111-4111-8111-111111111112');
  await request('11111111-1111-4111-8111-111111111113');
  assert.equal(repository.committed.monthMessages, 0);
});

test('voice usage shares the cost cap without consuming an agent message', async () => {
  const repository = new MemoryUsageRepository();
  const budget = service(repository);
  await budget.reserve({
    catalogVersion: 'v1',
    lane: 'speech',
    model: 'test-voice',
    planId: 'basic',
    requestId: '11111111-1111-4111-8111-111111111112',
    reservedMicroUsd: 1,
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
  });

  assert.equal(repository.committed.monthMessages, 0);
});

test('transcription pricing uses integer micro-USD ceiling math', () => {
  const budget = service(new MemoryUsageRepository());
  assert.equal(budget.transcriptionEstimateMicroUsd(300), 30);
  assert.equal(budget.transcriptionEstimateMicroUsd(12_000), 1_200);
  assert.equal(budget.transcriptionEstimateMicroUsd(15_000), 1_500);
  assert.equal(budget.transcriptionActualMicroUsd(0.301), 31);
  assert.equal(budget.transcriptionActualMicroUsd(12), 1_200);
  assert.throws(() => budget.transcriptionEstimateMicroUsd(15_001), /limit/u);
  assert.throws(() => budget.transcriptionActualMicroUsd(Number.NaN), /bounded/u);
});
