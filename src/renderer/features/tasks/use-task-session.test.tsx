// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  TaskHistory,
  TaskSnapshot,
  TaskUpdate,
} from '../../../shared/contracts';
import type { DesktopApi } from '../../../shared/desktop-api';

import { useTaskSession } from './use-task-session';

const task: TaskSnapshot = {
  createdAt: '2026-09-06T01:00:00.000Z',
  goal: null,
  lastEvent: null,
  messages: [],
  pendingInteraction: null,
  phase: 'acting',
  progress: null,
  queuedSteering: [],
  request: 'Keep the latest task',
  runtimeResume: null,
  taskId: '11111111-1111-4111-8111-111111111111',
  updatedAt: '2026-09-06T01:01:00.000Z',
};
const update: TaskUpdate = {
  snapshot: task,
  event: {
    artifacts: [],
    eventId: '22222222-2222-4222-8222-222222222222',
    nextActions: [],
    phase: 'acting',
    status: 'success',
    summary: 'Working',
    taskId: task.taskId,
    timestamp: task.updatedAt,
  },
};

describe('task session lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useTaskSession>;
  let resolveHistory: (history: TaskHistory) => void;
  let updateListener: (update: TaskUpdate) => void;
  const active = new Set<symbol>();
  const navigate = vi.fn();

  function Harness() {
    current = useTaskSession({ setActiveView: navigate });
    return null;
  }

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    active.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const subscribe = () => {
      const token = Symbol('subscription');
      active.add(token);
      return () => active.delete(token);
    };
    const history = new Promise<TaskHistory>((resolve) => {
      resolveHistory = resolve;
    });
    window.tro = {
      getTaskHistory: vi.fn(() => history),
      getUsageBudget: vi.fn().mockResolvedValue(null),
      onAgentActivity: vi.fn(subscribe),
      onTaskComposerFocusRequested: vi.fn(subscribe),
      onTaskUpdate: vi.fn((listener: (value: TaskUpdate) => void) => {
        updateListener = listener;
        return subscribe();
      }),
    } as unknown as DesktopApi;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('keeps one listener per channel across StrictMode remount and rerender', async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
    expect(active.size).toBe(3);
    const subscriptions = vi.mocked(window.tro.onTaskUpdate).mock.calls.length;
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
    expect(active.size).toBe(3);
    expect(window.tro.onTaskUpdate).toHaveBeenCalledTimes(subscriptions);
    await act(async () => root.render(null));
    expect(active.size).toBe(0);
  });

  it('merges delayed history without replacing newer live snapshots or duplicate events', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {
      updateListener(update);
      updateListener(update);
    });
    await act(async () =>
      resolveHistory({
        events: [update.event],
        persistence: { mode: 'session_only', summary: 'Session' },
        snapshots: [{ ...task, updatedAt: task.createdAt, phase: 'ready' }],
      }),
    );
    expect(current.snapshot?.phase).toBe('acting');
    expect(current.sessionSnapshots[task.taskId]?.phase).toBe('acting');
    expect(current.events).toEqual([update.event]);
    expect(current.sessionEvents).toEqual([update.event]);
  });
});
