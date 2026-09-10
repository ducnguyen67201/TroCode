import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { AsyncOperation } from '../agent/async-operation-tracker';

import { desktopLessonFixture } from './classroom-desktop-teaching.fixture';
import { safeMaterialName, type NativeMaterialRecord } from './classroom-lesson-material-policy';
import { ClassroomLessonMaterialService } from './classroom-lesson-material-service';

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
    let operation: AsyncOperation | null = null;
    const openPath = vi.fn(async (_path: string) => { void _path; return ''; });
    const file = vi.fn(async () => descriptor);
    const fetcher = vi.fn<typeof fetch>(async () => new Response(bytes.toString()));
    const store = { readNativeMaterial: vi.fn(async () => saved), saveNativeMaterial: vi.fn(async (_owner: string, _lesson: string, _resource: string, value: NativeMaterialRecord) => { saved = value; }),
      readResourceOperation: vi.fn(async () => operation), saveResourceOperation: vi.fn(async (_owner: string, _lesson: string, _resource: string, value: AsyncOperation) => { operation = { ...value }; }) };
    const markEffect = vi.fn(async (effect: typeof f.state.effect) => { f.state.effect = effect; });
    const restoreFileTitle = vi.fn();
    const service = new ClassroomLessonMaterialService({ directory, client: { file }, store, surfaces: { selectFileTitle: vi.fn(), restoreFileTitle }, openPath, openUrl: vi.fn(), markEffect, authorize: vi.fn(), consume: vi.fn(), fetchImpl: fetcher });
    return { ...f, descriptor, directory, bytes, openPath, file, fetcher, store, service, markEffect, restoreFileTitle };
  }
  it('prepares verified bytes without UI work and opens only through the resource operation', async () => {
    const f = await fixture();
    try {
      await f.service.prepare(f.state, new AbortController().signal);
      const target = f.store.saveNativeMaterial.mock.calls[0]![3].path;
      expect(await readFile(target)).toEqual(f.bytes);
      expect(f.openPath).not.toHaveBeenCalled();
      expect(f.store.saveNativeMaterial.mock.calls[0]![3]).toMatchObject({ version: 2, legacyOutcomeUnknown: false });
      const result = await f.service.openResource(f.state, f.resource.id, new AbortController().signal);
      expect(result.status).toBe('confirmed');
      expect(result.observation).toBeUndefined();
      expect(f.store.saveNativeMaterial).toHaveBeenCalledOnce();
      expect(f.store.saveNativeMaterial.mock.invocationCallOrder[0]).toBeLessThan(f.openPath.mock.invocationCallOrder[0]!);
      await f.service.prepare(f.state, new AbortController().signal);
      await f.service.openResource(f.state, f.resource.id, new AbortController().signal);
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
  it('returns while the OS awaits input and never updates a stopped lesson on late completion', async () => {
    const f = await fixture();
    let finish!: (value: string) => void;
    f.openPath.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    try {
      await f.service.prepare(f.state, new AbortController().signal);
      const receipt = await f.service.openResource(f.state, f.resource.id, new AbortController().signal);
      expect(receipt).toMatchObject({ status: 'confirmed', data: { operation: { status: 'pending' } } });
      expect(await f.service.openResource(f.state, f.resource.id, new AbortController().signal)).toEqual(receipt);
      expect(f.openPath).toHaveBeenCalledOnce();
      f.state.status = 'stopped';
      finish('');
      await vi.waitFor(async () => expect((await f.service.resourceOperation(f.state))?.status).toBe('completed'));
      expect(f.state.status).toBe('stopped');
      expect(f.markEffect).not.toHaveBeenCalled();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it('does not open if cancellation arrives during the durable receipt write', async () => {
    const f = await fixture();
    const abort = new AbortController();
    const save = f.store.saveResourceOperation.getMockImplementation()!;
    f.store.saveResourceOperation.mockImplementationOnce(async (...args) => {
      await save(...args);
      abort.abort();
    });
    try {
      await f.service.prepare(f.state, abort.signal);
      await f.service.openResource(f.state, f.resource.id, abort.signal);
      await vi.waitFor(async () => expect((await f.service.resourceOperation(f.state))?.status).toBe('unknown'));
      expect(f.openPath).not.toHaveBeenCalled();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it('preserves a modified cached document rather than overwriting it', async () => {
    const f = await fixture();
    try {
      await f.service.prepare(f.state, new AbortController().signal);
      const target = f.store.saveNativeMaterial.mock.calls[0]![3].path;
      await writeFile(target, 'student edits');
      f.store.readNativeMaterial.mockResolvedValueOnce(null);
      await expect(f.service.prepare(f.state, new AbortController().signal)).rejects.toMatchObject({ reason: 'resource_unavailable' });
      expect(await readFile(target, 'utf8')).toBe('student edits');
      expect(f.openPath).not.toHaveBeenCalled();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it('never replays an uncertain native opening', async () => {
    const f = await fixture();
    try {
      f.store.readNativeMaterial.mockResolvedValueOnce({ version: 2, path: '/previous/python.md', sha256: f.descriptor.sha256, legacyOutcomeUnknown: true });
      await expect(f.service.prepare(f.state, new AbortController().signal)).rejects.toThrow('uncertain');
      expect(f.state.effect).toBe('unknown');
      expect(f.openPath).not.toHaveBeenCalled();
      expect(f.file).not.toHaveBeenCalled();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it('rejects a resource handle outside the current step without opening anything', async () => {
    const f = await fixture();
    try {
      await f.service.prepare(f.state, new AbortController().signal);
      const result = await f.service.openResource(f.state, 'untrusted-path', new AbortController().signal);
      expect(result.status).toBe('denied');
      expect(f.openPath).not.toHaveBeenCalled();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
  it('preserves an unknown OS opening so subsequent calls cannot replay it', async () => {
    const f = await fixture();
    try {
      await f.service.prepare(f.state, new AbortController().signal);
      f.openPath.mockRejectedValueOnce(new Error('Connection lost'));
      const result = await f.service.openResource(f.state, f.resource.id, new AbortController().signal);
      expect(result).toMatchObject({ status: 'confirmed', data: { operation: { status: 'pending' } } });
      await vi.waitFor(async () => expect((await f.service.resourceOperation(f.state))?.status).toBe('unknown'));
      expect((await f.service.openResource(f.state, f.resource.id, new AbortController().signal)).status).toBe('unknown');
      await f.service.prepare(f.state, new AbortController().signal);
      expect(f.state.effect).toBe('none');
      expect(f.openPath).toHaveBeenCalledOnce();
      expect(f.store.saveNativeMaterial).toHaveBeenCalledOnce();
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
});
