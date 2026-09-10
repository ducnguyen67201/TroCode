import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LESSON_CHANNELS } from '../../shared/classroom-lesson-desktop-api';

import { registerClassroomLessonIpc, type ClassroomLessonFeatures } from './register-classroom-lesson-ipc';

const handlers = vi.hoisted(() => new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>());
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, value?: unknown) => Promise<unknown>) => handlers.set(channel, fn),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
}));
describe('lesson IPC authority', () => {
  beforeEach(() => handlers.clear());
  it('surfaces a failed preference save instead of reporting it persisted', async () => {
    const view = vi.fn();
    const setConsent = vi.fn(async () => { throw new Error('Could not save preference'); });
    const cleanup = registerClassroomLessonIpc({} as BrowserWindow, {
      controller: { setConsent, view, onChange: () => vi.fn() },
    } as unknown as ClassroomLessonFeatures, async () => undefined);
    await expect(handlers.get(LESSON_CHANNELS.consent)!({}, { enabled: false })).rejects.toThrow('Could not save preference');
    expect(setConsent).toHaveBeenCalledWith(false);
    expect(handlers.has('classroom-lesson:desktop-consent')).toBe(false);
    expect(view).not.toHaveBeenCalled();
    cleanup();
  });
  it('authorizes the sender before interpreting any lesson command and cleans up', async () => {
    const prepare = vi.fn();
    const stop = vi.fn();
    const authorize = vi.fn(async () => {
      throw new Error('Untrusted sender');
    });
    const cleanup = registerClassroomLessonIpc(
      {} as BrowserWindow,
      { drafts: { prepare }, controller: { onChange: () => stop } } as unknown as ClassroomLessonFeatures,
      authorize,
    );
    await expect(
      handlers.get(LESSON_CHANNELS.prepare)!({} as IpcMainInvokeEvent, { rawTool: 'click' }),
    ).rejects.toThrow('Untrusted sender');
    expect(prepare).not.toHaveBeenCalled();
    cleanup();
    expect(stop).toHaveBeenCalledOnce();
    expect(handlers.size).toBe(0);
  });
  it('refuses raw or stale control payloads without invoking the runner', async () => {
    const resume = vi.fn();
    const cleanup = registerClassroomLessonIpc(
      {} as BrowserWindow,
      { controller: { continue: resume, onChange: () => vi.fn() } } as unknown as ClassroomLessonFeatures,
      async () => undefined,
    );
    await expect(
      handlers.get(LESSON_CHANNELS.continue)!({}, { action: 'execute', command: 'click' }),
    ).rejects.toThrow();
    expect(resume).not.toHaveBeenCalled();
    cleanup();
  });
});

it('accepts opaque window choices and rejects injected native paths or window identities', async () => {
  const selectWindow = vi.fn();
  const chooseFile = vi.fn();
  const cleanup = registerClassroomLessonIpc({} as BrowserWindow, { selectWindow, chooseFile, controller: { onChange: () => vi.fn() } } as unknown as ClassroomLessonFeatures, async () => undefined);
  const lessonId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const token = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  try {
    await expect(handlers.get(LESSON_CHANNELS.selectWindow)!({}, { lessonId, revision: 1, token, pid: 1 })).rejects.toThrow();
    await expect(handlers.get(LESSON_CHANNELS.chooseFile)!({}, { lessonId, revision: 1, path: '/private/file' })).rejects.toThrow();
    expect(selectWindow).not.toHaveBeenCalled(); expect(chooseFile).not.toHaveBeenCalled();
    await handlers.get(LESSON_CHANNELS.selectWindow)!({}, { lessonId, revision: 1, token });
    expect(selectWindow).toHaveBeenCalledWith(lessonId, 1, token);
  } finally { cleanup(); }
});
