// @vitest-environment happy-dom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopApi } from '../../../shared/desktop-api';
import { renderHook } from '../../../test-support/render-hook';
import { taskFixture } from '../../../test-support/task-fixture';

import { useVoiceTurnRouting } from './use-voice-turn-routing';
import type { VoiceTurnContext } from './voice-input-types';

type Props = Parameters<typeof useVoiceTurnRouting>[0];
function routeProps(): Props {
  return {
    setInput: vi.fn(),
    clearError: vi.fn(),
    setVoiceTranscript: vi.fn(),
    teacherSelectionPendingRef: { current: false },
    reportError: vi.fn(),
    t: (text) => text,
    latestSnapshotRef: { current: null },
    teacherVoiceBindingsRef: { current: new Map() },
    teacherSelectionRef: { current: null },
    taskRequestRef: { current: null },
    input: 'Original draft',
    appLanguageDraft: 'en',
    sendInput: vi.fn().mockResolvedValue(true),
  };
}
function useRoutingHarness(props: Props) {
  const [input, setInput] = useState(props.input);
  const [transcript, setVoiceTranscript] = useState('');
  return {
    ...useVoiceTurnRouting({ ...props, input, setInput, setVoiceTranscript }),
    input,
    transcript,
  };
}
const local: VoiceTurnContext = {
  activation: 'local_hold',
  mode: 'dictation',
  turnId: 'local-1',
};
const globalTurn: VoiceTurnContext = {
  activation: 'global_hold',
  mode: 'dictation',
  turnId: 'global-1',
};
const taskTurn: VoiceTurnContext = {
  activation: 'local_hold',
  mode: 'task',
  turnId: 'task-1',
};

describe('voice destination ownership', () => {
  let hook: Awaited<
    ReturnType<typeof renderHook<Props, ReturnType<typeof useRoutingHarness>>>
  >;
  beforeEach(() => {
    window.tro = {
      beginDictation: vi
        .fn()
        .mockResolvedValue({ status: 'ready', targetApplication: 'Editor' }),
      commitDictation: vi
        .fn()
        .mockResolvedValue({ disposition: 'inserted', summary: 'Inserted' }),
      cancelDictation: vi.fn().mockResolvedValue(undefined),
      recordVoiceTranscript: vi.fn().mockResolvedValue(undefined),
      setCompanionVoiceActivity: vi.fn().mockResolvedValue(undefined),
    } as unknown as DesktopApi;
  });
  afterEach(async () => {
    await hook?.unmount();
    vi.restoreAllMocks();
  });

  it('restores the captured local draft when a partial transcript fails', async () => {
    hook = await renderHook(useRoutingHarness, routeProps());
    await act(async () => {
      expect((await hook.current.handleVoiceAttemptStart(local)).accepted).toBe(
        true,
      );
    });
    await act(async () =>
      hook.current.handleVoiceTranscriptChange(local, 'spoken words'),
    );
    expect(hook.current.input).toContain('spoken words');
    await act(async () =>
      hook.current.handleVoiceTurnEnd(local, 'partial_failure'),
    );
    expect(hook.current.input).toBe('Original draft');
    expect(window.tro.commitDictation).not.toHaveBeenCalled();
  });

  it('retains a local transcript on completion and records the composer destination', async () => {
    hook = await renderHook(useRoutingHarness, routeProps());
    await act(async () => {
      await hook.current.handleVoiceAttemptStart(local);
    });
    await act(async () => {
      await hook.current.handleVoiceTranscriptReady(local, 'spoken words');
    });
    await act(async () => hook.current.handleVoiceTurnEnd(local, 'completed'));
    expect(hook.current.input).toContain('spoken words');
    expect(window.tro.recordVoiceTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: 'tro_composer',
        disposition: 'draft_updated',
      }),
    );
  });

  it('keeps an uncertain global insertion as a draft without retrying delivery', async () => {
    vi.mocked(window.tro.commitDictation).mockRejectedValue(
      new Error('Connection lost'),
    );
    const props = routeProps();
    hook = await renderHook(useRoutingHarness, props);
    await act(async () => {
      await hook.current.handleVoiceAttemptStart(globalTurn);
    });
    await act(async () => {
      await hook.current.handleVoiceTranscriptReady(globalTurn, 'recover this');
    });
    expect(window.tro.commitDictation).toHaveBeenCalledTimes(1);
    expect(window.tro.cancelDictation).toHaveBeenCalledWith({
      turnId: globalTurn.turnId,
    });
    expect(hook.current.input).toContain('recover this');
    expect(props.reportError).toHaveBeenCalledWith(
      expect.stringContaining('could not be verified'),
    );
    expect(window.tro.recordVoiceTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: 'delivery_unverified' }),
    );
  });

  it('rejects task submission if the task changes during a voice turn', async () => {
    const props = routeProps();
    hook = await renderHook(useRoutingHarness, props);
    await act(async () => {
      await hook.current.handleVoiceAttemptStart(taskTurn);
    });
    props.latestSnapshotRef.current = taskFixture();
    await act(async () => {
      await expect(
        hook.current.handleVoiceTranscriptReady(taskTurn, 'Keep this'),
      ).rejects.toThrow('task or class changed');
    });
    expect(props.sendInput).not.toHaveBeenCalled();
    expect(hook.current.input).toBe('Keep this');
  });

  it('submits to the destination frozen at turn start and clears the binding on end', async () => {
    const props = routeProps();
    hook = await renderHook(useRoutingHarness, props);
    await act(async () => {
      await hook.current.handleVoiceAttemptStart(taskTurn);
    });
    await act(async () => {
      expect(
        await hook.current.handleVoiceTranscriptReady(taskTurn, 'Work on this'),
      ).toBe('task_submitted');
    });
    expect(props.sendInput).toHaveBeenCalledWith('Work on this', {
      teacherClassroomSelectionId: null,
      screenContext: 'required',
    });
    await act(async () =>
      hook.current.handleVoiceTurnEnd(taskTurn, 'completed'),
    );
    expect(props.teacherVoiceBindingsRef.current.size).toBe(0);
  });
});
