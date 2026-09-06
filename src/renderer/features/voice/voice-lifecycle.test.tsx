// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { VoiceShortcutEvent } from '../../../shared/contracts';
import type { DesktopApi } from '../../../shared/desktop-api';
import { usePushToTalk } from '../../use-push-to-talk';

import type { VoiceAttemptDecision } from './voice-input-types';

const capture = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../../voice-capture', () => ({ openVoiceCapture: capture.open }));

describe('voice with real React lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let shortcut: (event: VoiceShortcutEvent) => void;
  const active = new Set<symbol>();
  let finishPreflight: (decision: VoiceAttemptDecision) => void;
  let pendingPreflight: Promise<VoiceAttemptDecision>;
  const onEnd = vi.fn();
  const onReady = vi.fn();
  const onError = vi.fn();
  const onChange = vi.fn();
  const onAttempt = vi.fn(() => pendingPreflight);

  function Harness({ enabled = true }: { enabled?: boolean }) {
    const state = usePushToTalk({
      enabled,
      onAttemptStart: onAttempt,
      onError,
      onTranscriptChange: onChange,
      onTranscriptReady: onReady,
      onTurnEnd: onEnd,
      selectedMode: 'dictation',
    });
    return <output>{state.status}</output>;
  }

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    active.clear();
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    pendingPreflight = new Promise((resolve) => {
      finishPreflight = resolve;
    });
    window.tro = {
      onVoiceShortcut: vi.fn(
        (listener: (event: VoiceShortcutEvent) => void) => {
          shortcut = listener;
          const token = Symbol('shortcut');
          active.add(token);
          return () => active.delete(token);
        },
      ),
      reportVoiceDiagnostic: vi.fn().mockResolvedValue(undefined),
      transcribeVoiceSegment: vi.fn(),
    } as unknown as DesktopApi;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('subscribes once after StrictMode replay and does no microphone work while idle', async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
    expect(active.size).toBe(1);
    expect(capture.open).not.toHaveBeenCalled();
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness enabled={false} />
        </StrictMode>,
      ),
    );
    expect(active.size).toBe(1);
    expect(container.textContent).toBe('unavailable');
    await act(async () => root.render(null));
    expect(active.size).toBe(0);
  });

  it('does not open capture or commit when preflight resolves after unmount', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => shortcut({ action: 'pressed', source: 'global' }));
    expect(onAttempt).toHaveBeenCalledTimes(1);
    await act(async () => root.render(null));
    await act(async () =>
      finishPreflight({
        accepted: true,
        destination: { kind: 'application', label: 'Editor' },
      }),
    );
    expect(capture.open).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd.mock.calls[0]?.[1]).toBe('cancelled');
    expect(active.size).toBe(0);
  });
});
