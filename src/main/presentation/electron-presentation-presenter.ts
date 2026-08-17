import type {
  CompanionState,
  PendingInteraction,
  PresentationState,
  TaskSnapshot,
} from '../../shared/contracts';

import type { PresentationPresenter } from './presentation-coordinator';

const COMPANION_STATES: Readonly<Record<PresentationState, CompanionState>> = {
  done: 'completed',
  error: 'error',
  listening: 'listening',
  needs_attention: 'idle',
  ready: 'idle',
  thinking: 'processing',
  working: 'working',
};

export class ElectronPresentationPresenter implements PresentationPresenter {
  constructor(
    private readonly setCompanionState: (state: CompanionState) => void,
    private readonly revealMainWindow: () => void,
    private readonly resetGuidance: () => void,
    private readonly showInteraction: (interaction: PendingInteraction) => void,
    private readonly clearInteraction: (taskId?: string) => void,
  ) {}

  apply(state: PresentationState, task: TaskSnapshot | null): void {
    if (task?.pendingInteraction) this.showInteraction(task.pendingInteraction);
    else this.clearInteraction(task?.taskId);
    this.setCompanionState(COMPANION_STATES[state]);
    if (
      state === 'needs_attention' ||
      state === 'done' ||
      state === 'error' ||
      task?.phase === 'cancelled'
    ) {
      this.resetGuidance();
      this.revealMainWindow();
    }
  }
}
