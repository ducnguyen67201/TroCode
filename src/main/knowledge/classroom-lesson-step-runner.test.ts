import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { LessonLocalStateSchema } from '../../shared/classroom-lesson-contracts';
import type { TaskApplicationService } from '../application/task-application-service';
import type { CuaService } from '../cua/cua-service';

import { ClassroomLessonStepRunner } from './classroom-lesson-step-runner';
import { ClassroomLessonToolPolicy } from './classroom-lesson-tool-policy';
import { lessonFixture } from './classroom-lesson.fixture';
import type { KnowledgeSpaceClient } from './knowledge-space-client';

function setup() {
  const f = lessonFixture('demonstrate');
  const state = LessonLocalStateSchema.parse({
    schemaVersion: 1,
    ownerId: 'student',
    anchorAttemptId: randomUUID(),
    envelope: f.envelope,
    revision: 3,
    status: 'preparing',
    reasonCode: null,
    claim: null,
    clientStartId: randomUUID(),
    clientInstanceId: randomUUID(),
    stepIndex: 0,
    attempts: {},
    child: null,
    pendingChild: null,
    phase: 'Opening material',
    text: '',
    feedback: [],
    actionCount: 0,
    modelRequestCount: 0,
    observationCount: 0,
    effect: 'dispatching',
    material: null,
    pendingReports: [],
  });
  const observation = {
    observationId: randomUUID(),
    taskId: f.envelope.lessonId,
    capturedAt: new Date().toISOString(),
    fingerprint: 'a'.repeat(64),
    text: 'Editor',
    route: 'browser_semantic',
    degraded: false,
    surface: { kind: 'browser', application: 'Google Chrome', url: f.resource.url },
  };
  const cua = {
    getStatus: vi.fn(async () => ({
      platform: 'darwin',
      state: 'ready',
      permissions: { accessibility: true, screenRecording: true },
    })),
    startTaskSession: vi.fn(),
    endTaskSession: vi.fn(),
    observeCurrentSurface: vi.fn(async () => observation),
  };
  const openUrl = vi.fn(async () => undefined),
    showMaterial = vi.fn(),
    authorize = vi.fn(async () => undefined);
  const runner = new ClassroomLessonStepRunner({
    tasks: {} as TaskApplicationService,
    client: {} as KnowledgeSpaceClient,
    cua: cua as unknown as CuaService,
    policy: new ClassroomLessonToolPolicy(),
    openUrl,
    showMaterial,
    authorize,
    consume: vi.fn(),
  });
  return { ...f, state, cua, openUrl, showMaterial, authorize, runner };
}
describe('lesson material execution boundary', () => {
  it('blocks unreadable material before opening a window or starting computer use', async () => {
    const f = setup();
    await expect(f.runner.prepare(f.state, {
      resource: { id: f.resource.id, kind: 'assignment', title: 'Missing content' },
      text: '  ', chunks: [], nextOrdinal: null,
    }, new AbortController().signal)).rejects.toMatchObject({ reason: 'resource_unavailable' });
    expect(f.showMaterial).not.toHaveBeenCalled();
    expect(f.openUrl).not.toHaveBeenCalled();
    expect(f.cua.startTaskSession).not.toHaveBeenCalled();
  });
  it('accepts an already verified Chrome exercise without navigating again', async () => {
    const f = setup();
    await f.runner.prepare(
      f.state,
      { resource: f.resource, text: '', chunks: [], nextOrdinal: null },
      new AbortController().signal,
    );
    expect(f.openUrl).not.toHaveBeenCalled();
    expect(f.cua.endTaskSession).toHaveBeenCalledOnce();
  });
  it('blocks missing OS permissions before navigation', async () => {
    const f = setup();
    f.cua.getStatus.mockResolvedValueOnce({
      platform: 'darwin',
      state: 'permission_required',
      permissions: { accessibility: false, screenRecording: false },
    });
    await expect(
      f.runner.prepare(
        f.state,
        { resource: f.resource, text: '', chunks: [], nextOrdinal: null },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ reason: 'permission_required' });
    expect(f.openUrl).not.toHaveBeenCalled();
    expect(f.cua.startTaskSession).not.toHaveBeenCalled();
  });
  it('requires a matching material acknowledgement from the student renderer', async () => {
    const f = setup();
    const resource = { id: f.resource.id, kind: 'assignment' as const, title: 'Instructions' };
    const opening = f.runner.prepare(
      f.state,
      { resource, text: 'Read the example', chunks: [], nextOrdinal: null },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(f.showMaterial).toHaveBeenCalledOnce());
    expect(() => f.runner.acknowledge(f.envelope.lessonId, 2, resource.id)).toThrow('changed');
    f.runner.acknowledge(f.envelope.lessonId, 3, resource.id);
    await opening;
    expect(f.cua.startTaskSession).not.toHaveBeenCalled();
  });
});
