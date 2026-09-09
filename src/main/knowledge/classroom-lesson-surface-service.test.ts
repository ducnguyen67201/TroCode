import { describe, expect, it, vi } from 'vitest';

import { desktopLessonFixture } from './classroom-desktop-teaching.fixture';
import { ClassroomLessonSurfaceService } from './classroom-lesson-surface-service';

describe('lesson material window binding', () => {
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
  });
  it('does not explain unrelated or unreadable windows', async () => {
    const f = fixture();
    f.observation.surface!.title = 'Inbox';
    await expect(f.service.observe(f.state, f.state.clientStartId, new AbortController().signal)).rejects.toMatchObject({ reason: 'surface_unverified' });
    f.observation.surface!.title = 'python.md'; f.observation.text = '';
    await expect(f.service.observe(f.state, f.state.clientStartId, new AbortController().signal)).rejects.toMatchObject({ reason: 'resource_unavailable' });
  });
});

it('changes visual evidence when screenshot-only content changes under the same title', async () => {
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
  expect(first.fingerprint).not.toBe(second.fingerprint);
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
