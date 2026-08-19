import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { FileSelectionService } from './file-selection-service';

describe('FileSelectionService', () => {
  it('returns an opaque reviewed folder snapshot and excludes hidden/vendor/symlink content', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-knowledge-'));
    try {
      await mkdir(path.join(root, 'lesson'));
      await mkdir(path.join(root, 'node_modules'));
      await writeFile(path.join(root, 'lesson', 'main.py'), 'print("hello")');
      await writeFile(path.join(root, 'lesson', 'notes.md'), '# Notes');
      await writeFile(path.join(root, 'node_modules', 'ignored.js'), 'ignored');
      await symlink(path.join(root, 'lesson', 'notes.md'), path.join(root, 'linked.md'));
      const service = new FileSelectionService({ pick: vi.fn(async () => [root]) });
      const preview = await service.select({ role: 'starter', selectionKind: 'folder' });
      expect(preview?.files.map((file) => file.relativePath)).toEqual([
        'lesson/main.py',
        'lesson/notes.md',
      ]);
      expect(preview).not.toHaveProperty('canonicalPath');
      expect(JSON.stringify(preview)).not.toContain(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('invalidates a preview when a selected file changes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'trocode-knowledge-'));
    const file = path.join(root, 'source.txt');
    try {
      await writeFile(file, 'first');
      const service = new FileSelectionService({ pick: vi.fn(async () => [file]) });
      const preview = await service.select({ role: 'reference', selectionKind: 'files' });
      if (!preview) throw new Error('Expected a preview.');
      await writeFile(file, 'changed content');
      await expect(service.resolve(preview.selectionId)).rejects.toThrow('changed');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
