import {
  CompanionVoiceActivitySchema,
  TaskUpdateSchema,
  UsageBudgetSnapshotSchema,
  type CompanionVoiceActivity,
  type PresentationState,
  type TaskSnapshot,
  type UsageBudgetSnapshot,
} from '../../shared/contracts';

import { derivePresentationState } from './presentation-policy';

export interface PresentationPresenter {
  apply(state: PresentationState, task: TaskSnapshot | null): void;
}

export class PresentationCoordinator {
  private budget: UsageBudgetSnapshot | null = null;

  private state: PresentationState = 'ready';

  private task: TaskSnapshot | null = null;

  private voice: CompanionVoiceActivity | null = null;

  constructor(private readonly presenter: PresentationPresenter) {}

  handleTaskUpdate(value: unknown): void {
    this.task = TaskUpdateSchema.parse(value).snapshot;
    this.render();
  }

  handleVoiceActivity(value: unknown): void {
    this.voice = CompanionVoiceActivitySchema.nullable().parse(value);
    this.render();
  }

  handleBudgetSnapshot(value: unknown): void {
    this.budget = UsageBudgetSnapshotSchema.parse(value);
    this.render();
  }

  private render(): void {
    const next = derivePresentationState({
      budget: this.budget,
      task: this.task,
      voice: this.voice,
    });
    if (next === this.state && next !== 'needs_attention') return;
    this.state = next;
    this.presenter.apply(next, this.task);
  }
}
