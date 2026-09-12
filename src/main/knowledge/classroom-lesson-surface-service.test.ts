import { describe, expect, it, vi } from 'vitest';

import { desktopLessonFixture } from './classroom-desktop-teaching.fixture';
import { ClassroomLessonSurfaceService } from './classroom-lesson-surface-service';

describe('lesson material window binding', () => {
  it('uses chunk content as resource evidence and rejects a filename-only picker', async () => {
    const f = fixture();
    f.state.material!.text = '';
    f.state.material!.chunks = [{ ordinal: 0, body: 'print("Hello")', locator: null }];
    f.observation.text = 'Choose a viewer for python.md';
    f.observation.elements = [];
    const signal = new AbortController().signal;
    await expect(f.service.observe(f.state, f.state.clientStartId, signal)).rejects.toMatchObject({ reason: 'surface_unverified' });
    f.observation.text = 'print("Hello")';
    await expect(f.service.observe(f.state, f.state.clientStartId, signal)).resolves.toBe(f.observation);
  });
  it('does not verify a different source revision with the same resource id and filename', async () => {
    const f = fixture();
    f.state.material!.resource = { ...f.resource, sourceVersionId: f.state.clientStartId };
    await expect(f.service.observe(f.state, f.state.clientStartId, new AbortController().signal)).rejects.toMatchObject({ reason: 'resource_unavailable' });
  });
  function fixture() {
    const f = desktopLessonFixture();
    const identity = { processId: 123, windowId: 45 };
    const observeLessonWindow = vi.fn(async () => ({ observation: f.observation, identity }));
    const cleanup = vi.fn(async () => undefined);
    const service = new ClassroomLessonSurfaceService({ cua: { observeLessonWindow, externalLessonWindows: vi.fn(async () => []) }, prepareObservation: async () => cleanup });
    return { ...f, identity, observeLessonWindow, cleanup, service };
  }
  it('retains native identity across child tasks and rejects document changes', async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    await f.service.observe(f.state, f.state.envelope.lessonId, signal);
    await f.service.observe(f.state, f.state.clientStartId, signal);
    expect(f.observeLessonWindow).toHaveBeenLastCalledWith(f.state.clientStartId, f.identity, signal);
    f.observation.surface!.title = 'another.md';
    await expect(f.service.observe(f.state, f.state.clientStartId, signal)).rejects.toMatchObject({ reason: 'surface_unverified' });
    expect(f.cleanup).toHaveBeenCalledTimes(3);
    f.observation.surface!.title = 'python.md';
    await f.service.observe(f.state, f.state.clientStartId, signal);
    expect(f.observeLessonWindow).toHaveBeenLastCalledWith(f.state.clientStartId, undefined, signal);
  });
  it('discards a closed binding and verifies the resource in a new window', async () => {
    const f = desktopLessonFixture();
    const first = { processId: 123, windowId: 45 };
    const next = { processId: 123, windowId: 46 };
    const observeLessonWindow = vi.fn<() => Promise<{ observation: typeof f.observation; identity: typeof first | undefined }>>()
      .mockResolvedValueOnce({ observation: f.observation, identity: first })
      .mockResolvedValueOnce({ observation: f.observation, identity: undefined })
      .mockResolvedValueOnce({ observation: f.observation, identity: next })
      .mockResolvedValueOnce({ observation: f.observation, identity: next });
    const service = new ClassroomLessonSurfaceService({ cua: { observeLessonWindow, externalLessonWindows: vi.fn(async () => []) }, prepareObservation: async () => async () => undefined });
    const signal = new AbortController().signal;
    await service.observe(f.state, f.state.clientStartId, signal);
    await expect(service.observe(f.state, f.state.clientStartId, signal)).rejects.toMatchObject({ reason: 'surface_unverified' });
    expect(observeLessonWindow).toHaveBeenLastCalledWith(f.state.clientStartId, first, signal);
    await service.observe(f.state, f.state.clientStartId, signal);
    expect(observeLessonWindow).toHaveBeenLastCalledWith(f.state.clientStartId, undefined, signal);
    await service.observe(f.state, f.state.clientStartId, signal);
    expect(observeLessonWindow).toHaveBeenLastCalledWith(f.state.clientStartId, next, signal);
  });
  it('does not explain unrelated or unreadable windows', async () => {
    const f = fixture();
    f.observation.surface!.title = 'Inbox';
    await expect(f.service.observe(f.state, f.state.clientStartId, new AbortController().signal)).rejects.toMatchObject({ reason: 'surface_unverified' });
    f.observation.surface!.title = 'python.md'; f.observation.text = '';
    await expect(f.service.observe(f.state, f.state.clientStartId, new AbortController().signal)).rejects.toMatchObject({ reason: 'resource_unavailable' });
  });
  it('exposes a chooser to opening while refusing to bind it as material even when its title names the file', async () => {
    const f = fixture();
    f.observation.surface = { kind: 'native_app', application: 'An unfamiliar OS picker', title: 'Open with — python.md' };
    f.observation.text = 'Choose an application';
    f.observation.elements = [{ ref: 'e1', role: 'button', name: 'Notepad' }];
    const signal = new AbortController().signal;
    expect(await f.service.inspectMaterial(f.state, f.state.envelope.lessonId, signal)).toMatchObject({ ready: false, observation: f.observation });
    await expect(f.service.observe(f.state, f.state.envelope.lessonId, signal)).rejects.toMatchObject({ reason: 'surface_unverified' });
    f.observation.surface = { kind: 'native_app', application: 'Notepad', title: 'python.md' };
    f.observation.text = 'print("Hello")';
    await f.service.observe(f.state, f.state.envelope.lessonId, signal);
    expect(f.observeLessonWindow).toHaveBeenLastCalledWith(f.state.envelope.lessonId, undefined, signal);
  });
  it('restores the cached filename without clearing a student-selected window binding', async () => {
    const f = fixture();
    const signal = new AbortController().signal;
    await f.service.observe(f.state, f.state.envelope.lessonId, signal);
    f.service.restoreFileTitle(f.state, 'python.md');
    await f.service.observe(f.state, f.state.envelope.lessonId, signal);
    expect(f.observeLessonWindow).toHaveBeenLastCalledWith(f.state.envelope.lessonId, f.identity, signal);
  });
});

it('preserves shared observation identity and screenshot evidence without rewriting fingerprints', async () => {
  const f = desktopLessonFixture();
  f.observation.route = 'window_vision';
  f.observation.text = '';
  f.observation.elements = [];
  f.observation.screenshot = { mimeType: 'image/png', dataBase64: 'page-one' };
  const observeLessonWindow = vi.fn(async () => ({ observation: { ...f.observation }, identity: { processId: 1, windowId: 2 } }));
  const service = new ClassroomLessonSurfaceService({ cua: { observeLessonWindow, externalLessonWindows: vi.fn(async () => []) }, prepareObservation: async () => async () => undefined });
  const first = await service.observe(f.state, f.state.envelope.lessonId, new AbortController().signal);
  f.observation.screenshot = { mimeType: 'image/png', dataBase64: 'page-two' };
  const second = await service.observe(f.state, f.state.envelope.lessonId, new AbortController().signal);
  expect(first.fingerprint).toBe(f.observation.fingerprint);
  expect(second.fingerprint).toBe(f.observation.fingerprint);
  expect(first.screenshot?.dataBase64).not.toBe(second.screenshot?.dataBase64);
});

it('exposes one-use opaque choices tied to owner, revision and expiry', async () => {
  const f = desktopLessonFixture();
  let now = 1000;
  const service = new ClassroomLessonSurfaceService({
    cua: { observeLessonWindow: vi.fn(), externalLessonWindows: vi.fn(async () => [{ pid: 123, window_id: 456, app_name: 'Preview', title: 'Python', bounds: { x: 0, y: 0, width: 800, height: 600 }, is_on_screen: true, on_current_space: true, z_index: 1 }]) },
    prepareObservation: async () => async () => undefined, now: () => now,
  });
  const first = (await service.list(f.state))[0]!;
  expect(Object.keys(first).sort()).toEqual(['label', 'token']);
  f.state.revision++;
  expect(() => service.select(f.state, first.token)).toThrow('expired');
  const fresh = (await service.list(f.state))[0]!;
  service.select(f.state, fresh.token);
  expect(() => service.select(f.state, fresh.token)).toThrow('expired');
  const expired = (await service.list(f.state))[0]!;
  now += 60_001;
  expect(() => service.select(f.state, expired.token)).toThrow('expired');
});

it('returns desktop evidence without inventing a verified window binding', async () => {
  const f = desktopLessonFixture();
  const cleanup = vi.fn(async () => undefined);
  const observation = { ...f.observation, route: 'desktop_vision' as const };
  const service = new ClassroomLessonSurfaceService({ cua: { externalLessonWindows: vi.fn(async () => []), observeLessonWindow: vi.fn(async () => ({ observation, identity: undefined })) }, prepareObservation: async () => cleanup });
  await expect(service.inspectMaterial(f.state, f.state.clientStartId, new AbortController().signal)).resolves.toMatchObject({ ready: false, observation });
  expect(cleanup).toHaveBeenCalledOnce();
});
