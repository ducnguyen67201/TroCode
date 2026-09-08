import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { lessonStateFixture } from '../knowledge/classroom-lesson.fixture';

import { createCoachObserver } from './observe-coach-screen';

describe('Coach lesson observation', () => {
  it.each(['source', 'web', 'other-task', 'no-material'] as const)(
    'retains Tro only for the matching child with material inside Tro (%s)', async (kind) => {
      const state = lessonStateFixture();
      const taskId = randomUUID();
      state.child = { taskId, stepId: state.envelope.plan.steps[0]!.id, executionId: randomUUID(),
        attemptNumber: 1, workSessionId: randomUUID(), purpose: 'work', ownedByThisRequest: true };
      if (kind === 'web') state.material!.resource = state.envelope.plan.resources[0]!;
      if (kind === 'no-material') state.material = null;
      const cleanup = vi.fn(async () => undefined);
      const prepare = vi.fn(async () => cleanup);
      const observe = vi.fn(async () => 'fresh screen');
      const run = createCoachObserver({ lesson: () => state, prepare, observe });
      expect(await run(kind === 'other-task' ? randomUUID() : taskId, new AbortController().signal)).toBe('fresh screen');
      expect(prepare).toHaveBeenCalledWith(kind === 'source');
      expect(cleanup).toHaveBeenCalledOnce();
    },
  );

  it('restores overlays even when capture fails', async () => {
    const cleanup = vi.fn(async () => undefined);
    const run = createCoachObserver({ lesson: () => null, prepare: async () => cleanup,
      observe: async () => { throw new Error('Capture unavailable'); } });
    await expect(run(randomUUID(), new AbortController().signal)).rejects.toThrow('Capture unavailable');
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
