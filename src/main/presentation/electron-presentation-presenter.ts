import type {
  CompanionState,
  PendingInteraction,
  PresentationState,
  TaskSnapshot,
} from '../../shared/contracts';
import { requestsGuidedWalkthrough } from '../agent/walkthrough-policy';
import { splitSpeechText } from '../voice/speech-chunks';

import type { PresentationPresenter } from './presentation-coordinator';
import { shouldReadTaskCompletionAloud } from './presentation-policy';

interface CompletionNarrationService {
  begin(
    text: string,
    signal?: AbortSignal,
    taskId?: string,
  ): { completion: Promise<{ phase: 'ended' | 'failed' }> };
}

interface CompletionNarrationOptions {
  mode: 'background' | 'foreground';
  narration: string;
  narrationService: CompletionNarrationService;
  onError?: (error: unknown) => void;
  onFailure?: () => void;
  showCallout(message: string): boolean;
  taskId: string;
}

export interface CompletionNarrationStart {
  completion: Promise<void>;
  controller: AbortController;
}

export function startCompletionNarration(
  options: CompletionNarrationOptions,
): CompletionNarrationStart | null {
  const chunks = splitSpeechText(options.narration);
  if (chunks.length === 0) return null;

  const calloutVisible = options.showCallout(options.narration);
  if (options.mode === 'background' && !calloutVisible) return null;

  const controller = new AbortController();
  return {
    completion: narrateCompletionChunks(chunks, controller, options),
    controller,
  };
}

async function narrateCompletionChunks(
  chunks: string[],
  controller: AbortController,
  options: CompletionNarrationOptions,
): Promise<void> {
  try {
    for (const chunk of chunks) {
      if (controller.signal.aborted) return;
      const handle = options.narrationService.begin(
        chunk,
        controller.signal,
        options.taskId,
      );
      const outcome = await handle.completion;
      if (controller.signal.aborted) return;
      if (outcome.phase !== 'ended') {
        options.onFailure?.();
        return;
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      options.onError?.(error);
      options.onFailure?.();
    }
  }
}

const COMPANION_STATES: Readonly<Record<PresentationState, CompanionState>> = {
  done: 'completed',
  error: 'error',
  listening: 'listening',
  needs_attention: 'idle',
  ready: 'idle',
  thinking: 'processing',
  working: 'working',
};

export interface CompanionResponsePresentationOptions {
  mode: 'background' | 'foreground';
  narrate: boolean;
  onFailure?: () => void;
  surface: 'response' | 'walkthrough_recap';
}

export class ElectronPresentationPresenter implements PresentationPresenter {
  constructor(
    private readonly setCompanionState: (state: CompanionState) => void,
    private readonly revealMainWindow: () => void,
    private readonly resetGuidance: () => void,
    private readonly showInteraction: (interaction: PendingInteraction) => void,
    private readonly clearInteraction: (taskId?: string) => void,
    private readonly shouldUseBackgroundCompanion: (
      task: TaskSnapshot,
    ) => boolean,
    private readonly presentCompanionResponse: (
      task: TaskSnapshot,
      options: CompanionResponsePresentationOptions,
    ) => boolean,
  ) {}

  apply(state: PresentationState, task: TaskSnapshot | null): void {
    if (task?.pendingInteraction) this.showInteraction(task.pendingInteraction);
    else this.clearInteraction(task?.taskId);
    this.setCompanionState(COMPANION_STATES[state]);
    const useBackgroundCompanion = Boolean(
      task && this.shouldUseBackgroundCompanion(task),
    );

    if (state === 'needs_attention') {
      this.resetGuidance();
      if (!task?.pendingInteraction || !useBackgroundCompanion) {
        this.revealMainWindow();
      }
      return;
    }

    if (state === 'done') {
      this.resetGuidance();
      if (!task) {
        this.revealMainWindow();
        return;
      }

      let failureHandled = false;
      const revealOnFailure = (): void => {
        if (failureHandled) return;
        failureHandled = true;
        this.revealMainWindow();
      };
      const mode = useBackgroundCompanion ? 'background' : 'foreground';
      const narrate =
        useBackgroundCompanion || shouldReadTaskCompletionAloud(task);
      const options: CompanionResponsePresentationOptions = {
        mode,
        narrate,
        surface: requestsGuidedWalkthrough(task.request)
          ? 'walkthrough_recap'
          : 'response',
        ...(!useBackgroundCompanion && narrate
          ? { onFailure: revealOnFailure }
          : {}),
      };
      try {
        if (!this.presentCompanionResponse(task, options)) revealOnFailure();
      } catch {
        revealOnFailure();
      }
      return;
    }

    if (state === 'error' || task?.phase === 'cancelled') {
      this.resetGuidance();
      this.revealMainWindow();
    }
  }
}
