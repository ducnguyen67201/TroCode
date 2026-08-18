import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  AgentActivityUpdateSchema,
  type AgentActivityUpdate,
} from '../../shared/contracts';

import type { AgentRuntimeActivity } from './agent-runtime';

export class AgentActivityService extends EventEmitter {
  private readonly sequences = new Map<string, number>();

  private readonly pendingText = new Map<
    string,
    { text: string; timer: ReturnType<typeof setTimeout> }
  >();

  private readonly textTotals = new Map<string, number>();

  publish(
    taskId: string,
    activity: AgentRuntimeActivity,
  ): AgentActivityUpdate | null {
    if (activity.kind === 'run_started') {
      const pending = this.pendingText.get(taskId);
      if (pending) clearTimeout(pending.timer);
      this.pendingText.delete(taskId);
      this.sequences.delete(taskId);
      this.textTotals.set(taskId, 0);
    }
    if (activity.kind === 'text_delta') {
      const remaining = Math.max(0, 8_000 - (this.textTotals.get(taskId) ?? 0));
      const text = (activity.textDelta ?? '').slice(0, remaining);
      if (!text) return null;
      this.textTotals.set(taskId, (this.textTotals.get(taskId) ?? 0) + text.length);
      const pending = this.pendingText.get(taskId);
      if (pending) {
        pending.text += text;
      } else {
        this.pendingText.set(taskId, {
          text,
          timer: setTimeout(() => this.flushText(taskId), 75),
        });
      }
      return null;
    }
    this.flushText(taskId);
    const update = this.emitUpdate(taskId, activity);
    if (activity.kind === 'run_completed' || activity.kind === 'run_failed') {
      this.sequences.delete(taskId);
      this.textTotals.delete(taskId);
    }
    return update;
  }

  private emitUpdate(
    taskId: string,
    activity: AgentRuntimeActivity,
  ): AgentActivityUpdate {
    const sequence = this.sequences.get(taskId) ?? 0;
    const update = AgentActivityUpdateSchema.parse({
      ...activity,
      activityId: randomUUID(),
      sequence,
      taskId,
      timestamp: new Date().toISOString(),
    });
    this.sequences.set(taskId, sequence + 1);
    this.emit('activity', update);
    return update;
  }

  private flushText(taskId: string): void {
    const pending = this.pendingText.get(taskId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingText.delete(taskId);
    for (let offset = 0; offset < pending.text.length; offset += 2_000) {
      this.emitUpdate(taskId, {
        kind: 'text_delta',
        textDelta: pending.text.slice(offset, offset + 2_000),
      });
    }
  }
}
