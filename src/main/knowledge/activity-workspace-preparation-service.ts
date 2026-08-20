import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { WorkspaceSelection } from '../../shared/contracts';
import type { WorkspaceSelectionService } from '../workspace/workspace-selection-service';

import type { KnowledgeSpaceClient } from './knowledge-space-client';

function safeRelativePath(value: string): string {
  const portable = value.replaceAll('\\', '/');
  const normalized = path.posix.normalize(portable);
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('/') ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error('Starter material contains an invalid path.');
  }
  return normalized;
}

function folderName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
  return slug || 'trocode-activity';
}

export class ActivityWorkspacePreparationService {
  constructor(
    private readonly client: Pick<KnowledgeSpaceClient, 'getAttempt' | 'starterFiles'>,
    private readonly workspaces: Pick<
      WorkspaceSelectionService,
      'registerTrustedDirectory' | 'selectTrustedParent'
    >,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async prepare(attemptId: string): Promise<WorkspaceSelection | null> {
    const [attempt, starter] = await Promise.all([
      this.client.getAttempt(attemptId),
      this.client.starterFiles(attemptId),
    ]);
    if (attempt.definition.launchTarget !== 'workspace') {
      throw new Error('This Activity does not use a Workspace.');
    }
    if (starter.files.length === 0) {
      throw new Error('This Activity has no starter files.');
    }
    const parent = await this.workspaces.selectTrustedParent();
    if (!parent) return null;

    const staging = await mkdtemp(path.join(parent, '.trocode-starter-'));
    const finalPath = path.join(
      parent,
      `${folderName(attempt.definition.title)}-${randomUUID().slice(0, 8)}`,
    );
    const seen = new Set<string>();
    try {
      for (const file of starter.files) {
        const relativePath = safeRelativePath(file.relativePath);
        const key = relativePath.toLocaleLowerCase('en-US');
        if (seen.has(key)) throw new Error('Starter material contains conflicting paths.');
        seen.add(key);

        const downloadUrl = new URL(file.download.url);
        if (
          downloadUrl.protocol !== 'https:' &&
          !(
            downloadUrl.protocol === 'http:' &&
            ['127.0.0.1', '::1', 'localhost'].includes(downloadUrl.hostname)
          )
        ) {
          throw new Error('Starter downloads require HTTPS.');
        }

        const response = await this.fetchImpl(downloadUrl, {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) {
          throw new Error(`Starter download returned HTTP ${response.status}.`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength !== file.byteSize) {
          throw new Error('Starter download size did not match the published file.');
        }
        if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
          throw new Error('Starter download checksum did not match the published file.');
        }
        const destination = path.join(staging, ...relativePath.split('/'));
        const relativeToStage = path.relative(staging, destination);
        if (relativeToStage.startsWith('..') || path.isAbsolute(relativeToStage)) {
          throw new Error('Starter material escaped its destination.');
        }
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
      }

      await rename(staging, finalPath);
      return this.workspaces.registerTrustedDirectory(finalPath);
    } catch (error) {
      await rm(staging, { force: true, recursive: true }).catch(() => undefined);
      throw error;
    }
  }
}
