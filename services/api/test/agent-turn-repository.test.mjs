import assert from 'node:assert/strict';
import test from 'node:test';

import { PostgresAgentTurnRepository } from '../src/agent-turn-repository.mjs';

test('agent turn creation serializes a user monthly quota check', async () => {
  const statements = [];
  const client = {
    query: async (sql, parameters = []) => {
      statements.push({ parameters, sql });
      if (sql.includes('FROM agent_turns') && sql.includes('client_turn_id')) {
        return { rows: [] };
      }
      if (sql.includes('COUNT(*) AS month_messages')) {
        return { rows: [{ month_messages: 1199 }] };
      }
      if (sql.includes('INSERT INTO agent_turns')) {
        return {
          rows: [
            {
              client_turn_id: '22222222-2222-4222-8222-222222222222',
              created_at: new Date('2026-08-18T10:00:00.000Z'),
              id: '33333333-3333-4333-8333-333333333333',
              plan: 'basic',
              status: 'reserved',
              task_id: '11111111-1111-4111-8111-111111111111',
            },
          ],
        };
      }
      return { rows: [] };
    },
    release() {},
  };
  const repository = new PostgresAgentTurnRepository({
    connect: async () => client,
  });

  const result = await repository.create({
    authorize: ({ monthMessages }) =>
      monthMessages >= 1_200 ? { code: 'full' } : null,
    clientTurnId: '22222222-2222-4222-8222-222222222222',
    enforce: true,
    planId: 'basic',
    taskId: '11111111-1111-4111-8111-111111111111',
    userId: 'user-1',
  });

  assert.equal(result.kind, 'created');
  assert.equal(result.committed.monthMessages, 1_199);
  assert.ok(
    statements.some(({ sql }) => sql.includes('pg_advisory_xact_lock')),
  );
  assert.ok(statements.some(({ sql }) => sql === 'COMMIT'));
  assert.equal(
    statements.some(({ sql }) => sql.includes('INSERT INTO agent_turns')),
    true,
  );
});
