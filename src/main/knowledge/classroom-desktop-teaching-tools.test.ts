import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { assertStrictFunctionSchema } from '../../shared/agent-tool-contracts';
import type { SurfaceActionOutcome } from '../agent/execution-contracts';
import { normalizeLocalToolResult } from '../agent-runtime/local-tool-result';

import { ClassroomDesktopTeachingTools, desktopTeachingToolDefinitions } from './classroom-desktop-teaching-tools';
import { desktopLessonFixture } from './classroom-desktop-teaching.fixture';
import type { ClassroomLessonSurfaceService } from './classroom-lesson-surface-service';
import { lessonToolAllowed } from './classroom-lesson-tool-policy';

function fixture() {
  const f = desktopLessonFixture();
  const taskId = randomUUID();
  const observe = vi.fn(async () => f.observation);
  const presentSequence = vi.fn(async () => ({ outcome: 'presented' as const }));
  const executeSurfaceCommand = vi.fn(async (): Promise<SurfaceActionOutcome> => ({ status: 'confirmed', summary: 'scrolled', observation: f.observation }));
  const authorize = vi.fn(async () => undefined);
  const tools = new ClassroomDesktopTeachingTools({ surfaces: { observe } as unknown as ClassroomLessonSurfaceService, cua: { executeSurfaceCommand }, presenter: { presentSequence, cancelGuidance: vi.fn() }, authorize, consume: vi.fn(), markEffect: vi.fn() });
  tools.register(taskId, f.state);
  const call = (name: string, input: unknown) => tools.adapters().find((adapter) => adapter.id === `classroom.teaching-${name}`)!.execute({ toolId: `classroom.teaching-${name}`, operation: name, callId: randomUUID(), kind: 'direct', modelName: `lesson_${name}`, input }, { taskId, signal: new AbortController().signal });
  return { ...f, tools, call, taskId, observe, executeSurfaceCommand, presentSequence, authorize, evidence: { observationId: f.observation.observationId, fingerprint: f.observation.fingerprint } };
}
describe('scoped desktop teaching tools', () => {
  it('exposes strict lesson tools and excludes every general execution tool', () => {
    const scope = { kind: 'desktop' as const, lessonId: randomUUID(), stepId: randomUUID() };
    for (const definition of desktopTeachingToolDefinitions()) { assertStrictFunctionSchema(definition.parameters); expect(lessonToolAllowed(definition.id, scope)).toBe(true); }
    for (const id of ['computer.control', 'computer.observe', 'terminal.run', 'browser.prepare', 'classroom.lesson-step']) expect(lessonToolAllowed(id, scope)).toBe(false);
  });
  it('requires observed presentation and an explicit disposition before returning success', async () => {
    const f = fixture();
    await f.call('observe', {});
    expect((await f.call('finish', { ...f.evidence, disposition: 'continue', recap: 'Next we explain print.' })).status).toBe('denied');
    await f.call('present', { ...f.evidence, ref: 'e1', x: null, y: null, copy: { hook: 'Look here.', instruction: 'Print displays the greeting.', reason: 'This is the program output.', expectedOutcome: 'Understand print.' } });
    expect(f.presentSequence).toHaveBeenCalledOnce();
    await f.call('finish', { ...f.evidence, disposition: 'continue', recap: 'Next we explain print.' });
    expect(f.tools.result(f.taskId)).toEqual({ disposition: 'continue', recap: 'Next we explain print.' });
  });
  it('requires local consent, re-observes mutations and revokes tools on pause', async () => {
    const f = fixture();
    f.state.envelope.plan.steps[0]!.surface!.navigation = 'tro';
    await f.call('observe', {});
    const navigation = { ...f.evidence, action: 'scroll_down', ref: null, text: null };
    expect((await f.call('navigate', navigation)).status).toBe('denied');
    expect(f.executeSurfaceCommand).not.toHaveBeenCalled();
    f.state.desktopControlConsent = true;
    expect((await f.call('navigate', navigation)).status).toBe('confirmed');
    expect((await f.call('navigate', navigation)).status).toBe('denied');
    expect(f.executeSurfaceCommand).toHaveBeenCalledOnce();
    f.tools.remove(f.taskId);
    expect((await f.call('observe', {})).status).toBe('denied');
  });
  it('does not replay unknown effects or point at a changed screen', async () => {
    const f = fixture();
    f.state.desktopControlConsent = true; f.state.envelope.plan.steps[0]!.surface!.navigation = 'tro';
    await f.call('observe', {});
    f.executeSurfaceCommand.mockResolvedValueOnce({ status: 'unknown', summary: 'No receipt' });
    const navigation = { ...f.evidence, action: 'scroll_down', ref: null, text: null };
    expect((await f.call('navigate', navigation)).status).toBe('unknown');
    expect((await f.call('navigate', navigation)).status).toBe('unknown');
    expect(f.executeSurfaceCommand).toHaveBeenCalledOnce();
    const changed = fixture(); await changed.call('observe', {});
    changed.observe.mockResolvedValueOnce({ ...changed.observation, fingerprint: 'b'.repeat(64) });
    expect((await changed.call('present', { ...changed.evidence, ref: 'e1', x: null, y: null, copy: { hook: 'Look.', instruction: 'Read this.', reason: 'It is useful.', expectedOutcome: 'Read.' } })).status).toBe('not_executed');
    expect(changed.presentSequence).not.toHaveBeenCalled();
  });
  it('refuses to overwrite existing student work', async () => {
    const f = fixture();
    f.state.desktopControlConsent = true;
    f.state.envelope.plan.steps[0]!.surface!.navigation = 'tro';
    f.state.envelope.plan.steps[0]!.mode = 'demonstrate';
    f.state.envelope.plan.steps[0]!.demonstration = { exampleDescription: 'Print a greeting', expectedResult: 'Hello' };
    f.tools.register(f.taskId, f.state, 'demonstrate');
    f.observation.surface = { kind: 'code_editor', application: 'Visual Studio Code', title: 'Untitled-1' };
    await f.call('observe', {});
    expect((await f.call('demonstrate', { ...f.evidence, ref: 'e1', example: 'print("Hello")' })).status).toBe('denied');
    expect(f.executeSurfaceCommand).not.toHaveBeenCalled();
  });
});

it('returns the reviewed step and guidance policy as tool context instead of inflating the SDK request', async () => {
  const f = fixture();
  f.state.envelope.plan.steps[0]!.instruction = 'i'.repeat(4000);
  f.state.envelope.plan.steps[0]!.objective = 'o'.repeat(4000);
  const policy = { answerReveal: 'never' as const, hintMode: 'socratic' as const, maxHintLevel: 2 };
  f.tools.register(f.taskId, f.state, 'help', policy);
  const result = await f.call('observe', {});
  expect(normalizeLocalToolResult(result).data).toMatchObject({ observation: { observationId: f.observation.observationId, fingerprint: f.observation.fingerprint } });
  expect(result.data).toMatchObject({ lesson: { step: { instruction: 'i'.repeat(4000), objective: 'o'.repeat(4000) }, guidancePolicy: policy, sourceText: 'print("Hello")' } });
});

it('returns refreshed evidence after presentation so the SDK can finish without guessing a fingerprint', async () => {
  const f = fixture();
  await f.call('observe', {});
  const fresh = { ...f.observation, observationId: randomUUID() };
  f.observe.mockResolvedValueOnce(fresh);
  const presented = await f.call('present', { ...f.evidence, ref: 'e1', x: null, y: null, copy: { hook: 'Look.', instruction: 'Read this.', reason: 'It prints a greeting.', expectedOutcome: 'Understand print.' } });
  const normalized = normalizeLocalToolResult(presented);
  expect(normalized.data).toMatchObject({ observation: { observationId: fresh.observationId, fingerprint: fresh.fingerprint } });
  expect((await f.call('finish', { observationId: fresh.observationId, fingerprint: fresh.fingerprint, disposition: 'step_finished', recap: 'Covered print.' })).status).toBe('confirmed');
});
