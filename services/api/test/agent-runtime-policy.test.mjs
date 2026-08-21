import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentModelPolicy,
  ProviderCircuitBreaker,
} from '../src/agent-model-policy.mjs';
import { AgentRolloutPolicy } from '../src/agent-rollout-policy.mjs';

test('model routes are host-selected and recovery escalation is bounded', () => {
  const policy = new AgentModelPolicy();
  assert.deepEqual(policy.route({ lane: 'outcome_compiler' }), {
    model: 'gpt-5.6-luna', reasoningEffort: 'low', reasonCode: 'simple_structured_lane',
  });
  assert.equal(policy.route({ executionProfile: 'workspace' }).reasoningEffort, 'high');
  assert.equal(policy.route({ recoveryCount: 2 }).model, 'gpt-5.6-sol');
});

test('provider circuit breaker opens and recovers through half-open', () => {
  let now = 0;
  const breaker = new ProviderCircuitBreaker({ failureThreshold: 2, resetAfterMs: 100, now: () => now });
  breaker.failure();
  assert.equal(breaker.allow(), true);
  breaker.failure();
  assert.equal(breaker.allow(), false);
  now = 100;
  assert.equal(breaker.allow(), 'half_open');
  breaker.success();
  assert.equal(breaker.allow(), true);
});

test('canary assignment is deterministic and explicit users bypass percentage', () => {
  const first = new AgentRolloutPolicy({ enabled: true, hmacKey: 'k'.repeat(32), rolloutPercent: 5 });
  const second = new AgentRolloutPolicy({ enabled: true, hmacKey: 'k'.repeat(32), rolloutPercent: 5 });
  assert.equal(first.enabledFor('user-1'), second.enabledFor('user-1'));
  assert.equal(new AgentRolloutPolicy({
    enabled: true,
    hmacKey: 'k'.repeat(32),
    rolloutPercent: 0,
    canaryUsers: new Set(['internal']),
  }).enabledFor('internal'), true);
  assert.equal(new AgentRolloutPolicy({ enabled: false, hmacKey: 'k', rolloutPercent: 100 }).enabledFor('user'), false);
});
