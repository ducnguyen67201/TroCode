import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WORK_CHECK_LIMITS } from '../../shared/contracts';

import { WorkCheckContextService } from './work-check-context-service';
import { workCheckFixture } from './work-check.fixture';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function setup() {
  const f = workCheckFixture();
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'tro-check-')),
  );
  roots.push(root);
  const client = {
    getAttempt: vi.fn(async () => f.attempt),
    searchKnowledge: vi.fn(async () => ({ results: [], truncated: false })),
  };
  const service = new WorkCheckContextService(
    client as never,
    () => new Date(f.report.checkedAt),
    { ...WORK_CHECK_LIMITS, files: 2, fileCharacters: 30 },
  );
  return { ...f, root, client, service, signal: new AbortController().signal };
}
describe('bounded assignment context', () => {
  it('reads saved text in stable order, excludes hidden files and symlinks, and discloses omissions', async () => {
    const f = await setup();
    f.activity.activity.launchTarget = 'workspace';
    await writeFile(path.join(f.root, 'z.py'), 'print(2)');
    await writeFile(path.join(f.root, 'a.py'), 'print(1)');
    await writeFile(path.join(f.root, '.secret'), 'private');
    await mkdir(path.join(f.root, 'node_modules'));
    await symlink('/etc/passwd', path.join(f.root, 'link.py'));
    f.service.bind(f.packet.taskId, f.activity, {
      selectionId: randomUUID(),
      canonicalPath: f.root,
      displayName: 'project',
      selectedAt: f.report.checkedAt,
    });
    const packet = await f.service.prepare(f.packet.taskId, null, f.signal);
    expect(packet.evidence.map((e) => e.label)).toEqual(['a.py', 'z.py']);
    expect(packet.coverage.partial).toBe(true);
    expect(packet.coverage.notes[0]!).toContain('Unsaved');
    expect(JSON.stringify(packet)).not.toContain('private');
    expect(packet.evidence[0]!.fingerprint).toHaveLength(64);
  });
  it('marks truncation and unsupported PDFs/Scratch projects partial', async () => {
    const f = await setup();
    f.activity.activity.launchTarget = 'workspace';
    await writeFile(path.join(f.root, 'a.py'), 'x'.repeat(100));
    await writeFile(path.join(f.root, 'b.pdf'), 'not text');
    await writeFile(path.join(f.root, 'c.sb3'), 'not text');
    f.service.bind(f.packet.taskId, f.activity, {
      selectionId: randomUUID(),
      canonicalPath: f.root,
      displayName: 'project',
      selectedAt: f.report.checkedAt,
    });
    const packet = await f.service.prepare(f.packet.taskId, null, f.signal);
    expect(packet.sources[0]!.text).toHaveLength(30);
    expect(packet.evidence).toHaveLength(1);
    expect(packet.coverage.partial).toBe(true);
  });
  it('handles missing screen evidence without searching or inventing content', async () => {
    const f = await setup();
    f.service.bind(f.packet.taskId, f.activity, null);
    const packet = await f.service.prepare(f.packet.taskId, null, f.signal);
    expect(packet.evidence).toEqual([]);
    expect(packet.coverage.partial).toBe(true);
    expect(f.client.searchKnowledge).not.toHaveBeenCalled();
  });
  it('rejects replaced versions, released bindings and cancellation', async () => {
    const f = await setup();
    f.service.bind(f.packet.taskId, f.activity, null);
    f.attempt.activityVersionId = randomUUID();
    await expect(f.service.verify(f.packet.taskId)).rejects.toThrow('changed');
    f.attempt.activityVersionId = f.activity.activityVersionId;
    await expect(
      f.service.prepare(f.packet.taskId, null, AbortSignal.abort()),
    ).rejects.toThrow();
    f.service.release(f.packet.taskId);
    await expect(
      f.service.prepare(f.packet.taskId, null, f.signal),
    ).rejects.toThrow('unavailable');
  });
});
