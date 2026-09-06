// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { workCheckFixture } from '../main/knowledge/work-check.fixture';
import type { TaskSnapshot } from '../shared/contracts';

import { AttemptLaunchPage } from './AttemptLaunchPage';

it('shows the matching private check without automatically starting work or requesting review', async () => {
  const f = workCheckFixture();
  const onLaunch = vi.fn();
  const original = window.tro;
  window.tro = {
    getHostedAttempt: vi.fn(async () => f.attempt),
    getClassroomSession: vi.fn(async () => null),
    onClassroomSessionChanged: vi.fn(() => () => undefined),
  } as never;
  const snapshot = {
    taskId: f.packet.taskId,
    createdAt: f.report.checkedAt,
    goal: { activity: f.activity },
    workCheck: { phase: 'checked', report: f.report, message: null },
  } as TaskSnapshot;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <AttemptLaunchPage
          appLanguage="en"
          attemptId={f.attempt.attemptId}
          onBack={vi.fn()}
          onLaunch={onLaunch}
          checkSnapshots={[snapshot]}
        />,
      );
    });
    expect(container.textContent).toContain('Repeat ten times');
    expect(container.textContent).toContain('Send for teacher review');
    expect(onLaunch).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.tro = original;
  }
});
