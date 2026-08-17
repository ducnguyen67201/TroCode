import type {
  CompanionState,
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
  ) {}

  apply(state: PresentationState, task: TaskSnapshot | null): void {
    void task;
    this.setCompanionState(COMPANION_STATES[state]);
    if (state === 'needs_attention' || state === 'done' || state === 'error') {
      this.resetGuidance();
      this.revealMainWindow();
    }
  }
}
