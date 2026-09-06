import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { AgentTaskContractV10 } from '../../shared/contracts';
import { workCheckFixture } from '../knowledge/work-check.fixture';

import { TaskRuntime } from './task-runtime';

function authority(request: string): AgentTaskContractV10 {
  return {
    schemaVersion: 10,
    id: randomUUID(),
    originalRequest: request,
    runtimeKind: 'openai_agents_sdk',
    executionProfile: 'everyday',
    workspace: null,
    activity: null,
    limits: {
      maxImages: 20,
      maxMicroUsd: 5_000_000,
      maxMinutes: 30,
      maxModelSamples: 40,
      maxToolCalls: 30,
    },
  };
}

function submit(runtime: TaskRuntime, request = 'Send the message.') {
  return runtime.submit(
    { text: request },
    { authority: authority(request), taskId: randomUUID() },
  );
}

describe('TaskRuntime local projection', () => {
  it('keeps Coach in the same lifecycle without an Agents SDK resume token', () => {
    const runtime = new TaskRuntime();
    const request = 'Show me how to use Variables.';
    const task = runtime.submit({ text: request }, {
      taskId: randomUUID(),
      authority: {
        schemaVersion: 11,
        id: randomUUID(),
        originalRequest: request,
        runtimeKind: 'coach',
        route: 'coach',
        executionProfile: 'everyday',
        workspace: null,
        activity: null,
        coachProgress: null,
        limits: authority(request).limits,
      },
    });
    expect(task.runtimeResume).toBeNull();
    runtime.start({ taskId: task.taskId });
    const updated = runtime.updateCoachProgress(task.taskId, {
      attemptId: null,
      activityVersionId: null,
      stepNumber: 1,
      expectedOutcome: 'Variables is visible.',
      recap: null,
    });
    expect(updated.goal).toMatchObject({ coachProgress: { stepNumber: 1 } });
    const explained = runtime.appendCoachExplanation(task.taskId, 'A loop repeats the instructions inside it.');
    expect(explained.messages.at(-1)).toMatchObject({ role: 'assistant', kind: 'response', text: 'A loop repeats the instructions inside it.' });
    expect(runtime.applyCoachStatus(task.taskId, 'waiting', 'Choose Next.').phase).toBe('awaiting_input');
  });

  it('requires the local authority contract to match the request', () => {
    const runtime = new TaskRuntime();

    expect(() => runtime.submit(
      { text: 'Different request.' },
      { authority: authority('Canonical request.'), taskId: randomUUID() },
    )).toThrow('does not match the task request');
  });

  it('owns clarification as a local lifecycle transition', () => {
    const runtime = new TaskRuntime();
    const task = submit(runtime);
    const waiting = runtime.requestInput({
      prompt: 'Which account should Tro use?',
      taskId: task.taskId,
      choices: [{ id: 'work', label: 'Work' }],
    });
    const interaction = waiting.pendingInteraction;
    expect(interaction?.kind).toBe('clarification');
    if (!interaction) throw new Error('missing clarification');

    const answered = runtime.respondToInteraction({
      taskId: task.taskId,
      interactionId: interaction.id,
      kind: 'answer',
      text: 'Use my work account.',
    });

    expect(answered).toMatchObject({ pendingInteraction: null, phase: 'planning' });
    expect(answered.messages.at(-1)).toMatchObject({ role: 'user', kind: 'answer' });
  });

  it('streams assistant deltas and publishes normalized updates', () => {
    const runtime = new TaskRuntime();
    const task = submit(runtime);
    runtime.start({ taskId: task.taskId });
    const listener = vi.fn();
    runtime.on('task-update', listener);

    runtime.applyRuntimeEvent(task.taskId, 'assistant_delta', 'Hello', null);
    runtime.applyRuntimeEvent(task.taskId, 'assistant_delta', ' world', null);
    const completed = runtime.complete(task.taskId, {
      status: 'completed',
      finalOutput: null,
      message: 'Done.',
    });

    expect(completed.phase).toBe('completed');
    expect(completed.messages.at(-1)).toMatchObject({
      kind: 'response',
      role: 'assistant',
      text: 'Hello world',
    });
    expect(listener).toHaveBeenCalled();
  });

  it('records a rejected model request as warning progress before terminal failure', () => {
    const runtime = new TaskRuntime();
    const task = submit(runtime);
    runtime.start({ taskId: task.taskId });

    const rejected = runtime.applyRuntimeEvent(
      task.taskId,
      'model_request_rejected',
      'Model request rejected (400; request server-1).',
      { status: 400 },
    );

    expect(rejected.lastEvent).toMatchObject({
      status: 'warning',
      summary: 'Model request rejected (400; request server-1).',
    });
    expect(rejected.phase).toBe('planning');
  });

  it('projects unknown external effects as blocked', () => {
    const runtime = new TaskRuntime();
    const task = submit(runtime);

    const blocked = runtime.complete(task.taskId, {
      status: 'unknown',
      finalOutput: null,
      message: 'The external action may have completed.',
    });

    expect(blocked.phase).toBe('blocked');
    expect(blocked.lastEvent?.summary).toContain('may have completed');
  });
});

it('persists bounded feedback with immutable identity and rejects stale results',()=>{
 const f=workCheckFixture(); const runtime=new TaskRuntime();
 const task=runtime.submit({text:'Check my work.'},{taskId:f.packet.taskId,authority:{...authority('Check my work.'),activity:f.activity}});
 expect(task.workCheck).toBeUndefined();
 const projection={phase:'checked',report:f.report,message:null};
 expect(()=>runtime.updateWorkCheck(task.taskId,{...projection,report:{...f.report,attemptId:randomUUID()}})).toThrow('mismatch');
 const updated=runtime.updateWorkCheck(task.taskId,projection);
 expect(task.workCheck).toBeUndefined(); expect(updated.workCheck?.report).toEqual(f.report);
 const restored=new TaskRuntime().restore(JSON.parse(JSON.stringify(updated))); expect(restored.workCheck?.report).toEqual(f.report);
 expect(()=>new TaskRuntime().restore({...updated,workCheck:{...projection,report:{...f.report,taskId:randomUUID()}}})).toThrow();
 runtime.complete(task.taskId,{status:'completed',finalOutput:null,message:'Checked.'});
 expect(()=>runtime.updateWorkCheck(task.taskId,projection)).toThrow('active task');
});
