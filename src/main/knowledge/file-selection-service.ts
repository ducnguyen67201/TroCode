import { randomUUID } from 'node:crypto';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  KnowledgeFileSelectionSchema,
  type KnowledgeFileSelection,
  type SelectKnowledgeFilesRequest,
} from '../../shared/contracts';

const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.next', '.turbo', 'build', 'dist', 'node_modules',
  '__pycache__', '.venv', 'venv',
]);
const FILE_LIMIT = 100;
const FILE_BYTES = 25 * 1024 * 1024;
const TOTAL_BYTES = 250 * 1024 * 1024;

export interface KnowledgeFilePicker {
  pick(selectionKind: 'files' | 'folder'): Promise<string[]>;
}

export interface TrustedKnowledgeFile {
  absolutePath: string;
  byteSize: number;
  clientId: string;
  displayName: string;
  mediaType: 'text/plain' | 'text/markdown' | 'application/pdf';
  modifiedAtMs: number;
  relativePath: string;
}

interface TrustedSelection {
  files: TrustedKnowledgeFile[];
  preview: KnowledgeFileSelection;
}

function mediaType(filePath: string): TrustedKnowledgeFile['mediaType'] | null {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.txt': return 'text/plain';
    case '.md': case '.markdown': return 'text/markdown';
    case '.pdf': return 'application/pdf';
    default:
      return new Set([
        '.c', '.cc', '.cpp', '.cs', '.css', '.csv', '.go', '.h', '.hpp',
        '.html', '.ini', '.java', '.js', '.json', '.jsx', '.kt', '.mjs',
        '.py', '.rb', '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx', '.xml',
        '.yaml', '.yml',
      ]).has(extension)
        ? 'text/plain'
        : null;
  }
}

function portableRelative(value: string): string {
  const portable = value.split(path.sep).join('/');
  if (!portable || portable.startsWith('/') || portable.split('/').includes('..')) {
    throw new Error('Selected file has an invalid relative path.');
  }
  return portable;
}

export class FileSelectionService {
  private readonly selections = new Map<string, TrustedSelection>();

  constructor(private readonly picker: KnowledgeFilePicker) {}

  async select(request: SelectKnowledgeFilesRequest): Promise<KnowledgeFileSelection | null> {
    const selected = await this.picker.pick(request.selectionKind);
    if (selected.length === 0) return null;
    const files: TrustedKnowledgeFile[] = [];
    if (request.selectionKind === 'folder') {
      if (selected.length !== 1) throw new Error('Select one folder at a time.');
      const first = selected[0];
      if (!first) return null;
      const root = await realpath(first);
      if (!(await stat(root)).isDirectory()) throw new Error('The selected item is not a folder.');
      await this.walk(root, root, files, 0);
    } else {
      const first = selected[0];
      if (!first) return null;
      const commonRoot = path.dirname(await realpath(first));
      for (const candidate of selected) await this.addFile(candidate, commonRoot, files);
    }
    if (files.length === 0) throw new Error('No supported text, Markdown, or PDF files were found.');
    if (files.length > FILE_LIMIT) throw new Error(`Select at most ${FILE_LIMIT} files.`);
    const totalBytes = files.reduce((sum, file) => sum + file.byteSize, 0);
    if (totalBytes > TOTAL_BYTES) throw new Error('The selected files exceed the 250 MiB batch limit.');
    const selectionId = randomUUID();
    const preview = KnowledgeFileSelectionSchema.parse({
      selectionId,
      role: request.role,
      totalBytes,
      files: files.map(({ byteSize, displayName, mediaType: type, relativePath }) => ({ byteSize, displayName, mediaType: type, relativePath })),
    });
    this.selections.set(selectionId, { files, preview });
    return preview;
  }

  async resolve(selectionId: string): Promise<TrustedSelection> {
    const selection = this.selections.get(selectionId);
    if (!selection) throw new Error('That file selection expired. Select the files again.');
    for (const file of selection.files) {
      const canonicalPath = await realpath(file.absolutePath);
      const info = await lstat(file.absolutePath);
      if (canonicalPath !== file.absolutePath || info.isSymbolicLink() || !info.isFile() || info.size !== file.byteSize || info.mtimeMs !== file.modifiedAtMs) {
        this.selections.delete(selectionId);
        throw new Error('A selected file changed. Review the selection again.');
      }
    }
    return selection;
  }

  consume(selectionId: string): void { this.selections.delete(selectionId); }
  clear(): void { this.selections.clear(); }

  private async walk(root: string, directory: string, files: TrustedKnowledgeFile[], depth: number): Promise<void> {
    if (depth > 25) throw new Error('The selected folder is nested too deeply.');
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const candidate = path.join(directory, entry.name);
      const info = await lstat(candidate);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) await this.walk(root, candidate, files, depth + 1);
      else if (info.isFile()) await this.addFile(candidate, root, files);
      if (files.length > FILE_LIMIT) throw new Error(`Select at most ${FILE_LIMIT} files.`);
    }
  }

  private async addFile(candidate: string, root: string, files: TrustedKnowledgeFile[]): Promise<void> {
    const type = mediaType(candidate);
    if (!type) return;
    const absolutePath = await realpath(candidate);
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Symbolic links cannot be uploaded.');
    if (info.size <= 0 || info.size > FILE_BYTES) throw new Error('Each file must be between 1 byte and 25 MiB.');
    const relativePath = portableRelative(path.relative(root, absolutePath) || path.basename(absolutePath));
    files.push({
      absolutePath, byteSize: info.size, clientId: randomUUID(), displayName: path.basename(absolutePath),
      mediaType: type, modifiedAtMs: info.mtimeMs, relativePath,
    });
  }
}
