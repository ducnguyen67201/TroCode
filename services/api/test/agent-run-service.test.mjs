import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AgentRunService,
  reviseIntentAuthorization,
} from '../src/agent-run-service.mjs';
import { deterministicOutcomeContract } from '../src/outcome-compiler.mjs';

function harness(intentEnabled) {
  const submissions = [];
  const crypto = {
    encryptJson(value, aad) {
      return {
        ciphertext: Buffer.from(JSON.stringify(value)),
        iv: Buffer.alloc(12),
        tag: Buffer.alloc(16),
        keyVersion: 1,
        value,
        aad,
      };
    },
  };
  const repository = {
    async submit(input) {
      submissions.push(input);
      return {
        kind: 'created',
        run: {
          id: input.runId,
          taskId: input.taskId,
          clientTaskId: input.clientTaskId,
          executionProfile: input.executionProfile,
          workspaceSelectionId: input.workspaceSelectionId,
          state: 'queued',
          protocolVersion: input.protocolVersion,
          runVersion: 1,
          outcomeRevision: 1,
          publicSummary: input.publicSummary,
          createdAt: '2026-08-21T00:00:00.000Z',
          updatedAt: '2026-08-21T00:00:00.000Z',
        },
      };
    },
  };
  return {
    submissions,
    service: new AgentRunService({
      agentTurnService: {
        create: async () => ({ id: 'agent-turn-1' }),
      },
      crypto,
      intentAuthorizationPolicy: { enabledFor: () => intentEnabled },
      outcomeCompiler: {
        compile: async ({ request, executionProfile }) =>
          deterministicOutcomeContract(request, executionProfile),
      },
      repository,
    }),
  };
}

const submission = {
  clientTaskId: '11111111-1111-4111-8111-111111111111',
  taskId: '22222222-2222-4222-8222-222222222222',
  request: 'Create a calendar event.',
  executionProfile: 'everyday',
  workspaceSelectionId: null,
  autonomyMode: 'balanced',
};

test('AgentRunService owns and projects an encrypted v8 intent contract', async () => {
  const { service, submissions } = harness(true);
  const result = await service.submit({ id: 'user-1', plan: 'free' }, submission);

  assert.equal(result.contractSchemaVersion, 8);
  assert.equal(result.protocolVersion, 2);
  assert.ok(result.intentAuthorization.grants.some(
    (grant) => grant.effectKind === 'create_resource' &&
      grant.resourceKinds.includes('calendar_event'),
  ));
  assert.equal(submissions[0].contractEnvelope.aad.schemaVersion, 8);
  assert.equal(submissions[0].contractEnvelope.value.schemaVersion, 8);
});

test('disabled rollout produces a fail-closed v8 projection', async () => {
  const { service } = harness(false);
  const result = await service.submit({ id: 'user-2', plan: 'free' }, {
    ...submission,
    clientTaskId: '33333333-3333-4333-8333-333333333333',
    taskId: '44444444-4444-4444-8444-444444444444',
  });
  assert.equal(result.contractSchemaVersion, 8);
  assert.deepEqual(result.intentAuthorization.grants, []);
});

test('kill switch preserves existing grants while advancing the steering revision', () => {
  const existing = {
    schemaVersion: 8,
    executionProfile: 'everyday',
    intentAuthorization: {
      schemaVersion: 1,
      revision: 3,
      source: 'user_instruction',
      grants: [{
        id: 'create-resource-123456789abc',
        effectKind: 'create_resource',
        resourceKinds: ['calendar_event'],
        permitsSafeDefaults: false,
      }],
    },
  };
  const revised = reviseIntentAuthorization({
    authorityText: 'Also create a public document.',
    contract: existing,
    enabled: false,
  });
  assert.equal(revised.revision, 4);
  assert.deepEqual(revised.grants, existing.intentAuthorization.grants);
});
