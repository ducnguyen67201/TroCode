import {
  RespondToInteractionRequestSchema,
  SubmitTaskRequestSchema,
  type TaskSnapshot,
} from '../../shared/contracts';

import type {
  TaskIntentCompiler,
  TaskIntentCompilerResult,
} from './task-intent-compiler';
import type { TaskRuntime } from './task-runtime';

interface TaskSubmissionServiceOptions {
  compiler: TaskIntentCompiler;
  runtime: TaskRuntime;
}

export class TaskSubmissionService {
  private readonly compiler: TaskIntentCompiler;
  private readonly runtime: TaskRuntime;

  constructor({ compiler, runtime }: TaskSubmissionServiceOptions) {
    this.compiler = compiler;
    this.runtime = runtime;
  }

  async submit(input: unknown): Promise<TaskSnapshot> {
    const snapshot = this.runtime.create(SubmitTaskRequestSchema.parse(input));
    return this.compile(snapshot);
  }

  async respondToInteraction(input: unknown): Promise<TaskSnapshot> {
    const request = RespondToInteractionRequestSchema.parse(input);
    const current = this.runtime.getSnapshot(request.taskId);
    const snapshot =
      current.phase === 'clarifying'
        ? this.runtime.acceptIntentClarification(request)
        : this.runtime.respondToInteraction(request);
    return snapshot.phase === 'interpreting' ? this.compile(snapshot) : snapshot;
  }

  private async compile(snapshot: TaskSnapshot): Promise<TaskSnapshot> {
    let result: TaskIntentCompilerResult;
    try {
      result = await this.compiler.compile(snapshot.request);
    } catch (error) {
      return this.runtime.fail(
        snapshot.taskId,
        error instanceof Error
          ? `TroCode could not interpret this task: ${error.message}`
          : 'TroCode could not interpret this task.',
      );
    }

    if (result.kind === 'clarification') {
      return this.runtime.requestInitialClarification(
        snapshot.taskId,
        result.prompt,
        result.choices,
      );
    }
    return this.runtime.applyCompiledIntent(snapshot.taskId, result.intent);
  }
}
