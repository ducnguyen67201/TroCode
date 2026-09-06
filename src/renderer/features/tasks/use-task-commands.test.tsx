// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskSnapshot } from '../../../shared/contracts';
import type { DesktopApi } from '../../../shared/desktop-api';
import { renderHook } from '../../../test-support/render-hook';
import { taskFixture } from '../../../test-support/task-fixture';

import { useTaskCommands } from './use-task-commands';

type Props = Parameters<typeof useTaskCommands>[0];
const ref = <T,>(current: T) => ({ current });

function commandProps(snapshot: TaskSnapshot | null = null): Props {
  return {
    input: 'Start a task',
    pendingClarification: null,
    isSteering: false,
    clearError: vi.fn(),
    teacherSelectionPendingRef: ref(false),
    teacherSelectionRef: ref(null),
    snapshot,
    teacherTaskBindingsRef: ref(new Map()),
    recordSnapshot: vi.fn(),
    activeTaskIdRef: ref(snapshot?.taskId ?? null),
    setEvents: vi.fn(),
    setAgentActivities: vi.fn(),
    setAgentActivity: vi.fn(),
    setStreamingDraft: vi.fn(),
    executionProfile: 'everyday',
    workspaceSelection: null,
    setInput: vi.fn(),
    reportError: vi.fn(),
    latestSnapshotRef: ref(snapshot),
    setActiveView: vi.fn(),
    setAutoStartFailedTaskId: vi.fn(),
    selectedTaskRuntimeReady: false,
    autoStartAttemptedTaskIdsRef: ref(new Set()),
    settingsOpen: false,
  };
}

describe('task command ownership', () => {
  let hook: Awaited<
    ReturnType<typeof renderHook<Props, ReturnType<typeof useTaskCommands>>>
  >;
  beforeEach(() => {
    window.tro = {
      submitTask: vi.fn().mockResolvedValue(taskFixture()),
      steerTask: vi.fn().mockResolvedValue(taskFixture()),
      respondToInteraction: vi.fn().mockResolvedValue(taskFixture()),
      startTask: vi.fn().mockResolvedValue(taskFixture()),
      cancelTask: vi
        .fn()
        .mockResolvedValue(taskFixture({ phase: 'cancelled' })),
    } as unknown as DesktopApi;
  });
  afterEach(async () => {
    await hook?.unmount();
    vi.restoreAllMocks();
  });

  it('submits once when two sends overlap and binds the resulting task', async () => {
    let resolve!: (task: TaskSnapshot) => void;
    vi.mocked(window.tro.submitTask).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const props = commandProps();
    hook = await renderHook(useTaskCommands, props);
    let first!: Promise<boolean>;
    await act(async () => {
      first = hook.current.sendInput();
      expect(await hook.current.sendInput()).toBe(false);
    });
    expect(window.tro.submitTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(taskFixture());
      await first;
    });
    expect(props.activeTaskIdRef.current).toBe(taskFixture().taskId);
    expect(props.teacherTaskBindingsRef.current.get(taskFixture().taskId)).toBe(
      null,
    );
    expect(props.setInput).toHaveBeenCalledWith('');
  });

  it('steers an active task without creating a second task', async () => {
    const props = { ...commandProps(taskFixture()), isSteering: true };
    hook = await renderHook(useTaskCommands, props);
    await act(async () => {
      expect(await hook.current.sendInput('Change direction')).toBe(true);
    });
    expect(window.tro.steerTask).toHaveBeenCalledWith({
      taskId: props.snapshot!.taskId,
      instruction: 'Change direction',
    });
    expect(window.tro.submitTask).not.toHaveBeenCalled();
  });

  it('does not retry an uncertain auto-start after rerender or overwrite a newer terminal state', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(window.tro.startTask).mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    const props = {
      ...commandProps(taskFixture({ phase: 'ready' })),
      selectedTaskRuntimeReady: true,
    };
    hook = await renderHook(useTaskCommands, props);
    expect(window.tro.startTask).toHaveBeenCalledTimes(1);
    props.latestSnapshotRef.current = taskFixture({ phase: 'cancelled' });
    await act(async () => {
      reject(new Error('Connection lost'));
    });
    await hook.rerender(props);
    expect(window.tro.startTask).toHaveBeenCalledTimes(1);
    expect(props.reportError).not.toHaveBeenCalled();
    expect(props.recordSnapshot).not.toHaveBeenCalled();
  });

  it('ignores cancellation completion after another task becomes active', async () => {
    let resolve!: (task: TaskSnapshot) => void;
    vi.mocked(window.tro.cancelTask).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const props = commandProps(taskFixture());
    hook = await renderHook(useTaskCommands, props);
    let stopping!: Promise<void>;
    await act(async () => {
      stopping = hook.current.stopTask();
    });
    props.activeTaskIdRef.current = 'new-task';
    await act(async () => {
      resolve(taskFixture({ phase: 'cancelled' }));
      await stopping;
    });
    expect(props.recordSnapshot).not.toHaveBeenCalled();
  });

  it('respects modal and text-editing ownership of Escape', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const props = commandProps(taskFixture());
    const modalProps: Props = { ...props, settingsOpen: true };
    hook = await renderHook(useTaskCommands, modalProps);
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(window.tro.cancelTask).not.toHaveBeenCalled();
    await hook.rerender(props);
    const editor = document.createElement('textarea');
    document.body.append(editor);
    try {
      await act(async () => {
        editor.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      });
      expect(window.tro.cancelTask).not.toHaveBeenCalled();
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
      });
      expect(window.tro.cancelTask).toHaveBeenCalledWith(
        props.snapshot!.taskId,
        'focused_escape',
      );
    } finally {
      editor.remove();
    }
  });
});
