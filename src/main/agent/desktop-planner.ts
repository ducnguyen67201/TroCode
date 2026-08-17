import type {
  GoalSpec,
  SteeringInstruction,
  TaskMessage,
} from '../../shared/contracts';

import type {
  DesktopActionOutcome,
  DesktopObservation,
  DesktopStepDecision,
} from './execution-contracts';

export interface PlannerStepInput {
  goal: GoalSpec;
  guidancePoints: readonly PlannerGuidancePoint[];
  observation: DesktopObservation;
  previousOutcome?: DesktopActionOutcome;
  recentMessages: TaskMessage[];
  remainingSteps: number;
  steering: SteeringInstruction[];
}

export interface PlannerGuidancePoint {
  description: string;
  sequenceIndex: number;
  sequenceTotal: number;
  target?: string;
}

export interface DesktopPlanner {
  start(taskId: string, goal: GoalSpec, signal?: AbortSignal): Promise<void>;
  decide(
    taskId: string,
    input: PlannerStepInput,
    signal?: AbortSignal,
  ): Promise<DesktopStepDecision>;
  end(taskId: string): Promise<void>;
}
