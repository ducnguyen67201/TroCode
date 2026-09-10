import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { assertStrictFunctionSchema } from '../../shared/agent-tool-contracts';
import type { ResolvedToolInvocation } from '../agent/agent-contracts';
import { normalizeLocalToolResult } from '../agent-runtime/local-tool-result';

import { ClassroomDesktopTeachingTools, desktopTeachingToolDefinitions } from './classroom-desktop-teaching-tools';
import { desktopLessonFixture } from './classroom-desktop-teaching.fixture';
import { LessonBlockedError } from './classroom-lesson-errors';
import type { ClassroomLessonSurfaceService } from './classroom-lesson-surface-service';
import { lessonToolAllowed } from './classroom-lesson-tool-policy';

function fixture() {
  const f = desktopLessonFixture();
  const taskId = randomUUID();
  const observe = vi.fn(async () => f.observation);
  const inspectMaterial = vi.fn<ClassroomLessonSurfaceService['inspectMaterial']>(async () => ({ ready: true, observation: await observe() }));
  const presentSequence = vi.fn(async () => ({ outcome: 'presented' as const }));
  const authorize = vi.fn(async () => undefined);
  const openResource = vi.fn(async () => ({ status: 'confirmed' as const, summary: 'OS accepted the file.' }));
  const readResource = vi.fn(async () => f.state.material!);
  const tools = new ClassroomDesktopTeachingTools({ surfaces: { observe, inspectMaterial } as unknown as ClassroomLessonSurfaceService, presenter: { presentSequence, cancelGuidance: vi.fn() }, authorize, consume: vi.fn(), markEffect: vi.fn(), openResource, readResource });
  tools.register(taskId, f.state);
  const call = (name: string, input: unknown) => tools.adapters().find((adapter) => adapter.id === `classroom.teaching-${name}`)!.execute({ toolId: `classroom.teaching-${name}`, operation: name, callId: randomUUID(), kind: 'direct', modelName: `lesson_${name}`, input }, { taskId, signal: new AbortController().signal });
  const control = (command: unknown): ResolvedToolInvocation => ({ toolId: 'computer.control', modelName: 'control_surface', operation: 'control', kind: 'surface', callId: randomUUID(), input: { observationId: f.observation.observationId, observationFingerprint: f.observation.fingerprint, command } });
  return { ...f, tools, call, control, taskId, observe, inspectMaterial, openResource, readResource, presentSequence, authorize, evidence: { observationId: f.observation.observationId, fingerprint: f.observation.fingerprint } };
}
describe('scoped desktop teaching tools', () => {
  it.each([
    { kind: 'press_key', ref: null, key: 'v', modifiers: ['Control'] },
    { kind: 'press_key', ref: null, key: 'Delete', modifiers: [] },
    { kind: 'press_key', ref: null, key: 'Enter', modifiers: [] },
  ])('does not let keyboard input bypass navigation-only consent: $key', async (command) => {
    const f = fixture();
    f.state.desktopControlConsent = true;
    f.state.envelope.plan.steps[0]!.surface!.navigation = 'tro';
    await f.call('observe', {});
    await expect(f.tools.guard(f.taskId).before(f.control(command), false)).rejects.toMatchObject({ reason: 'permission_required' });
    await expect(f.tools.guard(f.taskId).before(f.control({ kind: 'press_key', ref: null, key: 'PageDown', modifiers: [] }), false)).resolves.toBeUndefined();
  });
  it('finishes opening only after verification and without requiring a presentation', async () => {
    const f = fixture();
    f.tools.register(f.taskId, f.state, 'open');
    await f.call('open', { handle: f.resource.id });
    expect((await f.call('finish', { ...f.evidence, disposition: 'step_finished', recap: 'Opened.' })).status).toBe('denied');
    await f.call('observe', {});
    expect((await f.call('finish', { ...f.evidence, disposition: 'continue', recap: 'Opened.' })).status).toBe('denied');
    expect(f.tools.result(f.taskId)).toBeUndefined();
    expect((await f.call('finish', { ...f.evidence, disposition: 'step_finished', recap: 'Opened.' })).status).toBe('confirmed');
    expect(f.presentSequence).not.toHaveBeenCalled();
  });
  it('does not accept a presentation receipt after task authority is revoked', async () => {
    const f = fixture();
    await f.call('observe', {});
    f.presentSequence.mockImplementationOnce(async () => {
      f.tools.remove(f.taskId);
      return { outcome: 'presented' };
    });
    const result = await f.call('present', { ...f.evidence, ref: 'e1', x: null, y: null,
      copy: { hook: 'Look.', instruction: 'Read this.', reason: 'It shows output.', expectedOutcome: 'Understand output.' } });
    expect(result.status).toBe('denied');
    expect(f.tools.result(f.taskId)).toBeUndefined();
  });
  it('uses accepted lesson authority for a migrated legacy browser demonstration', async () => {
    const f = fixture();
    const resource = { id: f.resource.id, kind: 'web' as const, title: 'Exercise', url: 'https://example.com/editor', origin: 'https://example.com' };
    f.state.envelope.plan.schemaVersion = 2;
    f.state.envelope.plan.resources = [resource];
    f.state.material!.resource = resource;
    const step = f.state.envelope.plan.steps[0]!;
    step.mode = 'demonstrate';
    delete step.surface;
    step.demonstration = { exampleDescription: 'A greeting', expectedResult: 'Hello' };
    f.tools.register(f.taskId, f.state, 'demonstrate', { answerReveal: 'allowed', hintMode: 'socratic', maxHintLevel: 2 });
    await f.call('observe', {});
    const command = f.control({ kind: 'scroll', ref: null, direction: 'down', amount: 1 });
    f.state.desktopControlConsent = false;
    await expect(f.tools.guard(f.taskId).before(command, false)).resolves.toBeUndefined();
  });
  it('allows a consented example in a proven-empty editor but rejects unavailable field contents', async () => {
    const f = fixture();
    f.state.desktopControlConsent = true;
    const step = f.state.envelope.plan.steps[0]!;
    step.mode = 'demonstrate';
    step.surface!.navigation = 'tro';
    step.demonstration = { exampleDescription: 'Print a greeting', expectedResult: 'Hello' };
    f.tools.register(f.taskId, f.state, 'demonstrate', { answerReveal: 'allowed', hintMode: 'socratic', maxHintLevel: 2 });
    f.observation.elements![0]!.value = '';
    await f.call('observe', {});
    const input = f.control({ kind: 'type_text', ref: 'e1', text: 'print("Hello")', replace: true });
    await expect(f.tools.guard(f.taskId).before(input, false)).resolves.toBeUndefined();
    delete f.observation.elements![0]!.value;
    await f.call('observe', {});
    await expect(f.tools.guard(f.taskId).before(input, false)).rejects.toMatchObject({ reason: 'existing_work' });
  });
  it('returns unverified UI evidence to the loop without allowing it to complete the lesson', async () => {
    const f = fixture();
    const error = new LessonBlockedError('surface_unverified', 'Show the requested material.');
    f.inspectMaterial.mockResolvedValueOnce({ ready: false, observation: f.observation, error });
    const result = await f.call('observe', {});
    expect(result).toMatchObject({ status: 'not_executed', observation: f.observation, summary: error.message });
    f.observe.mockRejectedValueOnce(error);
    expect((await f.call('finish', { ...f.evidence, disposition: 'step_finished', recap: 'Opened.' })).status).toBe('denied');
    expect(f.tools.result(f.taskId)).toBeUndefined();
  });
  it('does not present when screenshot content changes under the same semantic fingerprint', async () => {
    const f = fixture();
    f.observation.screenshot = { mimeType: 'image/png', dataBase64: 'first-page' };
    await f.call('observe', {});
    f.observe.mockResolvedValueOnce({ ...f.observation, screenshot: { mimeType: 'image/png', dataBase64: 'different-page' } });
    const result = await f.call('present', { ...f.evidence, ref: 'e1', x: null, y: null,
      copy: { hook: 'Look.', instruction: 'Read the example.', reason: 'It shows output.', expectedOutcome: 'Understand output.' } });
    expect(result.status).toBe('not_executed');
    expect(result.observation?.fingerprint).toBe(f.observation.fingerprint);
    expect(f.presentSequence).not.toHaveBeenCalled();
  });
  it('reads beyond the initial excerpt without observing or changing material state', async () => {
    const f = fixture();
    f.state.material!.text = 'a'.repeat(16000) + 'remaining initial text';
    f.state.material!.chunks = [];
    f.state.material!.nextOrdinal = 5;
    const input = { handle: f.resource.id, ordinal: null, offset: 16000 };
    expect(await f.call('read', input)).toMatchObject({ status: 'confirmed', data: {
      content: 'remaining initial text', contentTrust: 'untrusted', nextOffset: null, nextOrdinal: 5,
    } });
    const initial = f.state.material;
    f.readResource.mockResolvedValueOnce({ ...initial!, text: 'next backend page', chunks: [], nextOrdinal: null });
    expect(await f.call('read', { ...input, ordinal: 5, offset: 0 })).toMatchObject({ status: 'confirmed', data: {
      content: 'next backend page', nextOrdinal: null,
    } });
    expect(f.readResource).toHaveBeenCalledWith(f.state, f.resource.id, 5);
    expect(f.state.material).toBe(initial);
    expect(f.observe).not.toHaveBeenCalled();
  });
  it('rejects unrelated handles and revocation during resource retrieval', async () => {
    const f = fixture();
    expect((await f.call('read', { handle: randomUUID(), ordinal: 0, offset: 0 })).status).toBe('denied');
    expect(f.readResource).not.toHaveBeenCalled();
    f.readResource.mockImplementationOnce(async () => {
      f.tools.remove(f.taskId);
      return f.state.material!;
    });
    expect((await f.call('read', { handle: f.resource.id, ordinal: 0, offset: 0 })).status).toBe('denied');
  });
  it('uses the same navigation authority before and after opening, until revoked', async () => {
    const f = fixture();
    const guard = f.tools.guard(f.taskId);
    f.observation.surface = { kind: 'native_app', application: 'Unknown viewer picker', title: 'Choose a viewer' };
    f.observation.elements = [{ ref: 'e1', role: 'button', name: 'An installed viewer' }];
    await guard.observeResult({ status: 'confirmed', summary: 'Observed', observation: f.observation });
    const click = f.control({ kind: 'click_element', ref: 'e1', button: 'left', count: 1 });
    await expect(guard.before(click, false)).resolves.toBeUndefined();
    await f.call('open', { handle: f.resource.id });
    await expect(guard.before(click, false)).rejects.toMatchObject({ reason: 'surface_unverified' });
    await guard.observeResult({ status: 'confirmed', summary: 'Observed', observation: f.observation });
    await expect(guard.before(click, false)).resolves.toBeUndefined();
    await expect(guard.before(f.control({ kind: 'scroll', ref: null, direction: 'down', amount: 1 }), false)).resolves.toBeUndefined();
    expect(f.state.desktopControlConsent).toBe(false);
    f.tools.remove(f.taskId);
    await expect(guard.before(click, false)).rejects.toThrow('authority');
  });
  it('returns context before observation even when the document is unavailable', async () => {
    const f = fixture();
    f.observe.mockRejectedValue(new Error('Document is not open'));
    const result = await f.call('context', {});
    expect(result.status).toBe('confirmed');
    expect(result.data).toMatchObject({ lesson: { version: 1, resource: { contentTrust: 'untrusted' } } });
    expect(f.observe).not.toHaveBeenCalled();
  });
  it('exposes shared computer tools and product tools without navigation recipes', () => {
    const scope = { kind: 'desktop' as const, lessonId: randomUUID(), stepId: randomUUID() };
    for (const definition of desktopTeachingToolDefinitions()) { assertStrictFunctionSchema(definition.parameters); expect(lessonToolAllowed(definition.id, scope)).toBe(true); }
    for (const id of ['computer.control', 'computer.observe']) expect(lessonToolAllowed(id, scope)).toBe(true);
    for (const id of ['classroom.teaching-navigate', 'classroom.teaching-demonstrate', 'terminal.run', 'browser.prepare', 'classroom.lesson-step']) expect(lessonToolAllowed(id, scope)).toBe(false);
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
  it.each(['student', 'tro'] as const)('navigates an accepted lesson with legacy navigation %s, without extra consent, and revokes tools on pause', async (navigationMode) => {
    const f = fixture();
    f.state.envelope.plan.steps[0]!.surface!.navigation = navigationMode;
    f.state.desktopControlConsent = false;
    await f.call('observe', {});
    const navigation = f.control({ kind: 'scroll', ref: null, direction: 'down', amount: 3 });
    const guard = f.tools.guard(f.taskId);
    await expect(guard.before(navigation, false)).resolves.toBeUndefined();
    f.state.desktopControlConsent = true;
    await guard.before(navigation, true);
    await guard.observeResult({ status: 'confirmed', summary: 'Scrolled' });
    await expect(guard.before(navigation, false)).rejects.toMatchObject({ reason: 'surface_unverified' });
    f.tools.remove(f.taskId);
    expect((await f.call('observe', {})).status).toBe('denied');
  });
  it('does not replay unknown effects or point at a changed screen', async () => {
    const f = fixture();
    await f.call('observe', {});
    const guard = f.tools.guard(f.taskId);
    const navigation = f.control({ kind: 'scroll', ref: null, direction: 'down', amount: 3 });
    await guard.before(navigation, true);
    await guard.observeResult({ status: 'unknown', summary: 'No receipt' });
    expect(guard.uncertain()).toBe(true);
    await expect(guard.before(navigation, false)).rejects.toThrow('revoked');
    const changed = fixture(); await changed.call('observe', {});
    changed.observe.mockResolvedValueOnce({ ...changed.observation, fingerprint: 'b'.repeat(64) });
    expect((await changed.call('present', { ...changed.evidence, ref: 'e1', x: null, y: null, copy: { hook: 'Look.', instruction: 'Read this.', reason: 'It is useful.', expectedOutcome: 'Read.' } })).status).toBe('not_executed');
    expect(changed.presentSequence).not.toHaveBeenCalled();
  });
  it('still checks active lesson authority immediately before a navigation action', async () => {
    const f = fixture();
    await f.call('observe', {});
    f.authorize.mockRejectedValueOnce(new Error('Lesson stopped.'));
    await expect(f.tools.guard(f.taskId).before(f.control({ kind: 'scroll', ref: null, direction: 'down', amount: 1 }), true)).rejects.toThrow('Lesson stopped.');
  });
  it('demonstrates in a verified empty scratch editor without a second permission checkbox', async () => {
    const f = fixture();
    f.state.desktopControlConsent = false;
    f.state.envelope.plan.steps[0]!.mode = 'demonstrate';
    f.state.envelope.plan.steps[0]!.demonstration = { exampleDescription: 'Print a greeting', expectedResult: 'Hello' };
    f.tools.register(f.taskId, f.state, 'demonstrate', { answerReveal: 'allowed', hintMode: 'socratic', maxHintLevel: 2 });
    f.observation.surface = { kind: 'code_editor', application: 'Visual Studio Code', title: 'Untitled-1' };
    f.observation.elements![0]!.value = '';
    await f.call('observe', {});
    await expect(f.tools.guard(f.taskId).before(f.control({ kind: 'type_text', ref: 'e1', text: 'print("Hello")', replace: false }), false)).resolves.toBeUndefined();
  });
  it('refuses to overwrite existing student work', async () => {
    const f = fixture();
    f.state.envelope.plan.steps[0]!.mode = 'demonstrate';
    f.state.envelope.plan.steps[0]!.demonstration = { exampleDescription: 'Print a greeting', expectedResult: 'Hello' };
    f.tools.register(f.taskId, f.state, 'demonstrate', { answerReveal: 'allowed', hintMode: 'socratic', maxHintLevel: 2 });
    f.observation.surface = { kind: 'code_editor', application: 'Visual Studio Code', title: 'Untitled-1' };
    await f.call('observe', {});
    await expect(f.tools.guard(f.taskId).before(f.control({ kind: 'type_text', ref: 'e1', text: 'print("Hello")', replace: true }), false)).rejects.toMatchObject({ reason: 'existing_work' });
  });
});

it('returns the reviewed step and guidance policy as tool context instead of inflating the SDK request', async () => {
  const f = fixture();
  f.state.envelope.plan.steps[0]!.instruction = 'i'.repeat(4000);
  f.state.envelope.plan.steps[0]!.objective = 'o'.repeat(4000);
  const policy = { answerReveal: 'never' as const, hintMode: 'socratic' as const, maxHintLevel: 2 };
  f.tools.register(f.taskId, f.state, 'help', policy);
  const result = await f.call('context', {});
  expect(f.observe).not.toHaveBeenCalled();
  expect(result.data).toMatchObject({ guidancePolicy: policy, lesson: { step: { instruction: 'i'.repeat(4000), objective: 'o'.repeat(4000) }, resource: { content: 'print("Hello")' } } });
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
