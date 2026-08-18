import { describe, expect, it } from 'vitest';

import { adaptCodexEvent } from './codex-event-adapter';

const scope = { threadId: 'thread-1', turnId: 'turn-1' };

describe('adaptCodexEvent', () => {
  it('normalizes plans and assistant deltas without provider payloads', () => {
    expect(
      adaptCodexEvent(
        {
          method: 'turn/plan/updated',
          params: {
            explanation: 'Working through the repository.',
            plan: [
              { status: 'inProgress', step: 'Inspect tests' },
              { status: 'pending', step: 'Apply fix' },
            ],
            threadId: 'thread-1',
            turnId: 'turn-1',
          },
        },
        scope,
      ),
    ).toEqual({
      kind: 'activity',
      activity: {
        kind: 'plan_updated',
        summary: 'Working through the repository.',
        plan: [
          { status: 'in_progress', step: 'Inspect tests' },
          { status: 'pending', step: 'Apply fix' },
        ],
      },
    });
  });

  it('drops raw reasoning items and rejects cross-turn events', () => {
    expect(
      adaptCodexEvent(
        {
          method: 'item/started',
          params: {
            item: { id: 'reasoning-1', type: 'reasoning', raw: 'secret' },
            threadId: 'thread-1',
            turnId: 'turn-1',
          },
        },
        scope,
      ),
    ).toEqual({ kind: 'ignored' });
    expect(
      adaptCodexEvent(
        {
          method: 'item/started',
          params: {
            item: { id: 'message-1', type: 'agentMessage' },
            threadId: 'thread-1',
            turnId: 'turn-1',
          },
        },
        scope,
      ),
    ).toEqual({ kind: 'ignored' });
    expect(() =>
      adaptCodexEvent(
        {
          method: 'item/agentMessage/delta',
          params: {
            delta: 'Wrong turn',
            itemId: 'item-1',
            threadId: 'thread-1',
            turnId: 'turn-other',
          },
        },
        scope,
      ),
    ).toThrow('did not match');
  });
});
