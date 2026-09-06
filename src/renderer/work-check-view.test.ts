import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import { workCheckFixture } from '../main/knowledge/work-check.fixture';
import type { TaskSnapshot } from '../shared/contracts';

import { latestCheckForAttempt } from './work-check-view';

it('selects the latest attempt/version check even when its feedback is still pending', () => {
  const f = workCheckFixture();
  const old = {
    taskId: randomUUID(),
    createdAt: '2026-09-01T00:00:00.000Z',
    goal: { activity: f.activity },
    workCheck: { phase: 'checked', report: f.report },
  } as TaskSnapshot;
  const current = {
    ...old,
    taskId: randomUUID(),
    createdAt: '2026-09-05T00:00:00.000Z',
    workCheck: null,
  };
  const other = {
    ...current,
    createdAt: '2026-09-06T00:00:00.000Z',
    goal: { activity: { ...f.activity, activityVersionId: randomUUID() } },
  } as TaskSnapshot;
  expect(
    latestCheckForAttempt(
      [current, other, old],
      f.activity.attemptId,
      f.activity.activityVersionId,
    ),
  ).toBe(current);
  expect(
    latestCheckForAttempt([old], randomUUID(), f.activity.activityVersionId),
  ).toBeNull();
});
