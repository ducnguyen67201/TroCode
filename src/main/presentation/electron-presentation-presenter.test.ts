import { describe, expect, it, vi } from 'vitest';

import type { TaskSnapshot } from '../../shared/contracts';

import { ElectronPresentationPresenter } from './electron-presentation-presenter';

describe('ElectronPresentationPresenter', () => {
  function createPresenter(background = false) {
    const setState = vi.fn();
    const reveal = vi.fn();
    const reset = vi.fn();
    const showInteraction = vi.fn();
    const clearInteraction = vi.fn();
    const presentBackgroundCompletion = vi.fn();
    const presenter = new ElectronPresentationPresenter(
      setState,
      reveal,
      reset,
      showInteraction,
      clearInteraction,
      () => background,
      presentBackgroundCompletion,
    );
    return {
      clearInteraction,
      presentBackgroundCompletion,
      presenter,
      reset,
      reveal,
      setState,
      showInteraction,
    };
  }

  it('reveals the main window for foreground attention states', () => {
    const { clearInteraction, presenter, reset, reveal, setState } =
      createPresenter();
    presenter.apply('working', null);
    expect(reveal).not.toHaveBeenCalled();
    expect(clearInteraction).toHaveBeenCalledWith(undefined);
    presenter.apply('needs_attention', null);
    expect(setState).toHaveBeenLastCalledWith('idle');
    expect(reset).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledOnce();
  });

  it('keeps a background interaction in the companion without revealing the app', () => {
    const { presenter, reveal, showInteraction } = createPresenter(true);
    const task = createTask({
      pendingInteraction: {
        choices: [{ id: 'latest', label: 'The latest email' }],
        createdAt: '2026-08-18T00:00:00.000Z',
        id: 'c2adcf07-8386-4a35-ac22-046d70a532ac',
        kind: 'clarification',
        prompt: 'Which email should I read?',
        taskId: '63ee32fb-1819-4b0a-a990-d1b111e92d85',
      },
      phase: 'awaiting_input',
    });

    presenter.apply('needs_attention', task);

    expect(showInteraction).toHaveBeenCalledWith(task.pendingInteraction);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('narrates a background completion without revealing the app', () => {
    const { presentBackgroundCompletion, presenter, reveal } =
      createPresenter(true);
    const task = createTask({ phase: 'completed' });

    presenter.apply('done', task);

    expect(presentBackgroundCompletion).toHaveBeenCalledWith(task);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('keeps foreground completions silent and visible in the main app', () => {
    const { presentBackgroundCompletion, presenter, reveal } =
      createPresenter(false);

    presenter.apply('done', createTask({ phase: 'completed' }));

    expect(presentBackgroundCompletion).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalledOnce();
  });

  it('reveals non-interactive attention even for a background task', () => {
    const { presenter, reveal } = createPresenter(true);

    presenter.apply('needs_attention', createTask({ phase: 'blocked' }));

    expect(reveal).toHaveBeenCalledOnce();
  });
});

function createTask(
  overrides: Partial<TaskSnapshot> = {},
): TaskSnapshot {
  const timestamp = '2026-08-18T00:00:00.000Z';
  return {
    approvalGrant: null,
    createdAt: timestamp,
    goal: null,
    lastEvent: null,
    messages: [],
    pendingInteraction: null,
    phase: 'planning',
    progress: null,
    queuedSteering: [],
    request: 'Read my latest email.',
    runtimeResume: null,
    taskId: '63ee32fb-1819-4b0a-a990-d1b111e92d85',
    updatedAt: timestamp,
    ...overrides,
  };
}
