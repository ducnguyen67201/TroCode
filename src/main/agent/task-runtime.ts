import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  CancelTaskRequestSchema,
  SubmitTaskRequestSchema,
  type TaskEvent,
  type TaskSnapshot,
} from '../../shared/contracts';

import { isTerminalPhase, transitionTask } from './goal-machine';
import { compileGoal, requestNeedsClarification } from './goal-router';

export class TaskRuntime extends EventEmitter {
  private readonly tasks = new Map<string, TaskSnapshot>();

  submit(input: unknown): TaskSnapshot {
    const request = SubmitTaskRequestSchema.parse(input);
    const timestamp = new Date().toISOString();
    let snapshot: TaskSnapshot = {
      taskId: randomUUID(),
      request: request.text,
      phase: 'idle',
      goal: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastEvent: null,
    };

    snapshot = this.move(snapshot, 'interpreting', {
      summary: 'Interpreting the request and compiling a bounded goal.',
      nextActions: ['Classify domain, interaction mode, and capabilities.'],
    });

    if (requestNeedsClarification(request.text)) {
      snapshot = this.move(snapshot, 'clarifying', {
        status: 'warning',
        summary: 'The request needs more detail before a safe goal can be created.',
        nextActions: ['Ask what outcome the user wants and whether to guide or act.'],
      });
      return snapshot;
    }

    snapshot = {
      ...snapshot,
      goal: compileGoal(request.text),
    };
    snapshot = this.move(snapshot, 'ready', {
      summary: 'Goal compiled and ready for review.',
      nextActions: [
        'Review the capability and resource scope.',
        'Connect a model provider before starting execution.',
      ],
    });

    return snapshot;
  }

  cancel(input: unknown): TaskSnapshot {
    const request = CancelTaskRequestSchema.parse(input);
    const snapshot = this.tasks.get(request.taskId);

    if (!snapshot) throw new Error(`Task ${request.taskId} was not found.`);
    if (isTerminalPhase(snapshot.phase)) return snapshot;

    return this.move(snapshot, 'cancelled', {
      status: 'warning',
      summary: 'Task cancelled by the user.',
      nextActions: [],
    });
  }

  private move(
    snapshot: TaskSnapshot,
    phase: Parameters<typeof transitionTask>[1],
    details: Parameters<typeof transitionTask>[2],
  ): TaskSnapshot {
    const updatedSnapshot = transitionTask(snapshot, phase, details);
    this.tasks.set(updatedSnapshot.taskId, updatedSnapshot);
    this.emit('task-event', updatedSnapshot.lastEvent satisfies TaskEvent | null);
    return updatedSnapshot;
  }
}
