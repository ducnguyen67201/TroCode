import { describe, expect, it, vi } from 'vitest';

import type { TaskSnapshot } from '../../shared/contracts';

import { ElectronPresentationPresenter } from './electron-presentation-presenter';

describe('ElectronPresentationPresenter', () => {
  it('reveals the main window only for attention and terminal states', () => {
    const setState = vi.fn();
    const reveal = vi.fn();
    const reset = vi.fn();
    const showInteraction = vi.fn();
    const clearInteraction = vi.fn();
    const presenter = new ElectronPresentationPresenter(
      setState,
      reveal,
      reset,
      showInteraction,
      clearInteraction,
    );
    presenter.apply('working', null);
    expect(reveal).not.toHaveBeenCalled();
    expect(clearInteraction).toHaveBeenCalledWith(undefined);
    presenter.apply('needs_attention', null);
    expect(setState).toHaveBeenLastCalledWith('idle');
    expect(reset).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledOnce();
  });

  it('keeps a pending interaction in the cursor callout without revealing the main window', () => {
    const setState = vi.fn();
    const reveal = vi.fn();
    const reset = vi.fn();
    const showInteraction = vi.fn();
    const clearInteraction = vi.fn();
    const presenter = new ElectronPresentationPresenter(
      setState,
      reveal,
      reset,
      showInteraction,
      clearInteraction,
    );
    const interaction = {
      action: {
        action: 'click_element',
        description: 'Open the newest Gmail message.',
        parameters: {},
        target: 'The first message in the inbox',
      },
      actionDigest: 'a'.repeat(64),
      consequence: 'This will open the newest Gmail message.',
      expiresAt: '2026-08-18T00:10:00.000Z',
      id: 'e23cf176-0f8a-4e98-917d-d8118328c74c',
      kind: 'approval',
      prompt: 'Open the newest Gmail message?',
      taskId: '5ce80307-0058-453f-83b8-4a14e657ea6e',
    } as const;
    const task = {
      pendingInteraction: interaction,
      phase: 'awaiting_approval',
    } as unknown as TaskSnapshot;

    presenter.apply('needs_attention', task);

    expect(showInteraction).toHaveBeenCalledWith(interaction);
    expect(clearInteraction).not.toHaveBeenCalled();
    expect(setState).toHaveBeenCalledWith('idle');
    expect(reset).toHaveBeenCalledOnce();
    expect(reveal).not.toHaveBeenCalled();
  });
});
