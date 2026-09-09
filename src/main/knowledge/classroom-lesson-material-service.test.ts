import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { desktopLessonFixture } from './classroom-desktop-teaching.fixture';
import { LessonBlockedError } from './classroom-lesson-errors';
import { safeMaterialName, type NativeMaterialRecord } from './classroom-lesson-material-policy';
import { ClassroomLessonMaterialService } from './classroom-lesson-material-service';

const absent = () => new LessonBlockedError('surface_unverified', 'Open the file.');
describe('authorized original material opening', () => {
  it.each(['program.exe', 'script.py', 'macro.docm', 'archive.zip'])('does not automatically open %s', (name) => {
    expect(() => safeMaterialName(name, 'application/octet-stream')).toThrow();
  });
  it('keeps cache names local and requires the matching MIME type', () => {
    expect(safeMaterialName('../../lesson.pdf', 'application/pdf')).toBe('lesson.pdf');
    expect(safeMaterialName('folder\\lesson.md', 'text/markdown')).toBe('lesson.md');
    expect(() => safeMaterialName('lesson.pdf', 'text/plain')).toThrow();
  });
  async function fixture() {
    const f = desktopLessonFixture();
    const directory = await mkdtemp(path.join(os.tmpdir(), 'tro-material-test-'));
    const bytes = Buffer.from('print("Hello")');
    const descriptor = { sourceVersionId: f.resource.sourceVersionId, name: 'python.md', mediaType: 'text/markdown', byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), download: { url: 'https://storage.example/material', expiresInSeconds: 120 } };
    let saved: NativeMaterialRecord | null = null;
    const observe = vi.fn(async () => { if (saved?.status !== 'opened') throw absent(); return f.observation; });
    const openPath = vi.fn(async (_path: string) => { void _path; return ''; });
    const file = vi.fn(async () => descriptor);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(bytes.toString()));
    const store = { readNativeMaterial: vi.fn(async () => saved), saveNativeMaterial: vi.fn(async (_owner: string, _lesson: string, _resource: string, value: NativeMaterialRecord) => { saved = value; }) };
    const markEffect = vi.fn(async (effect: typeof f.state.effect) => { f.state.effect = effect; });
    const opening = { complete: vi.fn(async (_state: typeof f.state, _name: string | undefined, _signal: AbortSignal, _recordEffect: (effect: typeof f.state.effect) => Promise<void>) => { void [_state, _name, _signal, _recordEffect]; await observe(); }) };
    const restoreFileTitle = vi.fn();
    const service = new ClassroomLessonMaterialService({ directory, client: { file }, store, surfaces: { observe, selectFileTitle: vi.fn(), restoreFileTitle }, opening, openPath, openUrl: vi.fn(), markEffect, authorize: vi.fn(), consume: vi.fn(), fetchImpl: fetcher });
    return { ...f, descriptor, directory, bytes, observe, openPath, file, fetcher, store, service, markEffect, opening, restoreFileTitle };
  }
  it('downloads verified bytes, persists before opening, and reuses a visible material without reopening', async () => {
    const f = await fixture();
    try {
      await f.service.prepare(f.state, new AbortController().signal);
      const target = f.openPath.mock.calls[0]![0];
      expect(await readFile(target)).toEqual(f.bytes);
      expect(f.store.saveNativeMaterial.mock.calls.map((c) => c[3].status)).toEqual(['dispatching', 'opened']);
      expect(f.store.saveNativeMaterial.mock.invocationCallOrder[0]).toBeLessThan(f.openPath.mock.invocationCallOrder[0]!);
      await f.service.prepare(f.state, new AbortController().signal);
      expect(f.openPath).toHaveBeenCalledOnce();
      expect(f.fetcher).toHaveBeenCalledOnce();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it('rejects corrupted downloads before any native opening', async () => {
    const f = await fixture();
    try {
      f.fetcher.mockResolvedValueOnce(new Response('corrupted'));
      await expect(f.service.prepare(f.state, new AbortController().signal)).rejects.toMatchObject({ reason: 'resource_unavailable' });
      expect(f.openPath).not.toHaveBeenCalled();
      expect(f.store.saveNativeMaterial).not.toHaveBeenCalled();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it('preserves a modified cached document rather than overwriting it', async () => {
    const f = await fixture();
    try {
      await f.service.prepare(f.state, new AbortController().signal);
      const target = f.openPath.mock.calls[0]![0];
      await writeFile(target, 'student edits');
      f.store.readNativeMaterial.mockResolvedValueOnce(null);
      f.observe.mockRejectedValueOnce(absent());
      await expect(f.service.prepare(f.state, new AbortController().signal)).rejects.toMatchObject({ reason: 'resource_unavailable' });
      expect(await readFile(target, 'utf8')).toBe('student edits');
      expect(f.openPath).toHaveBeenCalledOnce();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it('never replays an uncertain native opening', async () => {
    const f = await fixture();
    try {
      f.store.readNativeMaterial.mockResolvedValueOnce({ path: '/previous/python.md', sha256: f.descriptor.sha256, status: 'dispatching' });
      await expect(f.service.prepare(f.state, new AbortController().signal)).rejects.toThrow('uncertain');
      expect(f.state.effect).toBe('unknown');
      expect(f.openPath).not.toHaveBeenCalled();
      expect(f.file).not.toHaveBeenCalled();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it('resumes the chooser for an opened file without downloading or launching again', async () => {
    const f = await fixture();
    try {
      await f.service.prepare(f.state, new AbortController().signal);
      f.observe.mockRejectedValueOnce(absent());
      await f.service.prepare(f.state, new AbortController().signal);
      expect(f.opening.complete).toHaveBeenCalledTimes(2);
      expect(f.restoreFileTitle).toHaveBeenCalledWith(f.state, 'python.md');
      expect(f.openPath).toHaveBeenCalledOnce();
      expect(f.fetcher).toHaveBeenCalledOnce();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it('persists an uncertain chooser action so resuming cannot replay it after restart', async () => {
    const f = await fixture();
    try {
      f.opening.complete.mockImplementationOnce(async (_state, _name, _signal, recordEffect) => {
        void [_state, _name, _signal];
        await recordEffect('dispatching');
        await recordEffect('unknown');
        throw new Error('Chooser outcome uncertain.');
      });
      await expect(f.service.prepare(f.state, new AbortController().signal)).rejects.toThrow('uncertain');
      await expect(f.service.prepare(f.state, new AbortController().signal)).rejects.toThrow('uncertain');
      expect(f.openPath).toHaveBeenCalledOnce();
      expect(f.opening.complete).toHaveBeenCalledOnce();
      expect(f.store.saveNativeMaterial.mock.calls.at(-1)?.[3].status).toBe('dispatching');
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
});
