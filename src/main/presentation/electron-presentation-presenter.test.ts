import { describe, expect, it, vi } from 'vitest';

import type { CompanionSpeech, TaskSnapshot } from '../../shared/contracts';
import { CompanionNarrationService } from '../voice/companion-narration-service';

import {
  ElectronPresentationPresenter,
  startCompletionNarration,
} from './electron-presentation-presenter';

describe('completion narration', () => {
  it('starts CompanionNarrationService when the foreground result callout is unavailable', async () => {
    const publish = vi.fn<(speech: CompanionSpeech | null) => void>();
    const narrationService = new CompanionNarrationService({
      logger: { info: vi.fn(), warn: vi.fn() },
      publish,
      ttsService: { isConfigured: () => false, stream: vi.fn() },
    });

    const started = startCompletionNarration({
      mode: 'foreground',
      narration: 'The latest email is ready.',
      narrationService,
      showCallout: () => false,
      taskId: '63ee32fb-1819-4b0a-a990-d1b111e92d85',
    });

    expect(started).not.toBeNull();
    const speech = publish.mock.calls[0]?.[0];
    expect(speech).toMatchObject({
      source: 'system',
      text: 'The latest email is ready.',
    });
    if (!speech) throw new Error('Expected narration to publish speech.');
    narrationService.report({
      id: speech.id,
      phase: 'ended',
      source: speech.source,
    });
    await started?.completion;
    expect(publish).toHaveBeenLastCalledWith(null);
  });

  it('keeps background narration dependent on a visible result callout', () => {
    const begin = vi.fn();

    const started = startCompletionNarration({
      mode: 'background',
      narration: 'The latest email is ready.',
      narrationService: { begin },
      showCallout: () => false,
      taskId: '63ee32fb-1819-4b0a-a990-d1b111e92d85',
    });

    expect(started).toBeNull();
    expect(begin).not.toHaveBeenCalled();
  });

  it('keeps the complete visible answer stable while narrating speech chunks', async () => {
    const begin = vi.fn(() => ({
      completion: Promise.resolve({ phase: 'ended' as const }),
    }));
    const showCallout = vi.fn(() => true);
    const narration = `${'A complete sentence. '.repeat(40)}Final detail.`;

    const started = startCompletionNarration({
      mode: 'foreground',
      narration,
      narrationService: { begin },
      showCallout,
      taskId: '63ee32fb-1819-4b0a-a990-d1b111e92d85',
    });

    await started?.completion;

    expect(showCallout).toHaveBeenCalledWith(narration);
    expect(showCallout).toHaveBeenCalledOnce();
    expect(begin.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('ElectronPresentationPresenter', () => {
  function createPresenter(background = false) {
    const setState = vi.fn();
    const reveal = vi.fn();
    const reset = vi.fn();
    const showInteraction = vi.fn();
    const clearInteraction = vi.fn();
    const presentCompanionResponse = vi.fn<
      (
        task: TaskSnapshot,
        options: {
          mode: 'background' | 'foreground';
          narrate: boolean;
          onFailure?: () => void;
          surface: 'response' | 'walkthrough_recap';
        },
      ) => boolean
    >();
    presentCompanionResponse.mockReturnValue(true);
    const presenter = new ElectronPresentationPresenter(
      setState,
      reveal,
      reset,
      showInteraction,
      clearInteraction,
      () => background,
      presentCompanionResponse,
    );
    return {
      clearInteraction,
      presentCompanionResponse,
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
    const { presentCompanionResponse, presenter, reveal } =
      createPresenter(true);
    const task = createTask({ phase: 'completed' });

    presenter.apply('done', task);

    expect(presentCompanionResponse).toHaveBeenCalledWith(task, {
      mode: 'background',
      narrate: true,
      surface: 'response',
    });
    expect(reveal).not.toHaveBeenCalled();
  });

  it('shows an ordinary foreground completion in the companion without narrating', () => {
    const { presentCompanionResponse, presenter, reveal } =
      createPresenter(false);
    const task = createTask({
      phase: 'completed',
      request: 'Summarize my latest email.',
    });

    presenter.apply('done', task);

    expect(presentCompanionResponse).toHaveBeenCalledWith(task, {
      mode: 'foreground',
      narrate: false,
      surface: 'response',
    });
    expect(reveal).not.toHaveBeenCalled();
  });

  it('reads an explicit foreground completion aloud while leaving the target app visible', () => {
    const { presentCompanionResponse, presenter, reveal } =
      createPresenter(false);
    const task = createTask({ phase: 'completed' });

    presenter.apply('done', task);

    expect(presentCompanionResponse).toHaveBeenCalledWith(task, {
      mode: 'foreground',
      narrate: true,
      onFailure: expect.any(Function),
      surface: 'response',
    });
    expect(reveal).not.toHaveBeenCalled();
  });

  it('reveals Tro if foreground read-aloud narration fails', () => {
    const { presentCompanionResponse, presenter, reveal } =
      createPresenter(false);
    const task = createTask({ phase: 'completed' });

    presenter.apply('done', task);
    const onFailure = presentCompanionResponse.mock.calls[0]?.[1].onFailure;
    expect(onFailure).toBeTypeOf('function');
    onFailure?.();

    expect(reveal).toHaveBeenCalledOnce();
  });

  it('does not reveal Tro if background narration later fails', () => {
    const { presentCompanionResponse, presenter, reveal } =
      createPresenter(true);
    const task = createTask({ phase: 'completed' });

    presenter.apply('done', task);

    expect(presentCompanionResponse.mock.calls[0]?.[1].onFailure).toBeUndefined();
    expect(reveal).not.toHaveBeenCalled();
  });

  it('uses a compact recap surface after a guided walkthrough', () => {
    const { presentCompanionResponse, presenter, reveal } = createPresenter();
    const task = createTask({
      phase: 'completed',
      request: 'Circle each question, explain it, then continue.',
    });

    presenter.apply('done', task);

    expect(presentCompanionResponse).toHaveBeenCalledWith(task, {
      mode: 'foreground',
      narrate: false,
      surface: 'walkthrough_recap',
    });
    expect(reveal).not.toHaveBeenCalled();
  });

  it('reveals Tro when the visual response card is unavailable', () => {
    const { presentCompanionResponse, presenter, reveal } = createPresenter();
    presentCompanionResponse.mockReturnValue(false);

    presenter.apply(
      'done',
      createTask({ phase: 'completed', request: 'Summarize my latest email.' }),
    );

    expect(reveal).toHaveBeenCalledOnce();
  });

  it('reveals Tro when visual response presentation throws', () => {
    const { presentCompanionResponse, presenter, reveal } = createPresenter();
    presentCompanionResponse.mockImplementation(() => {
      throw new Error('Response overlay unavailable.');
    });

    presenter.apply('done', createTask({ phase: 'completed' }));

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
