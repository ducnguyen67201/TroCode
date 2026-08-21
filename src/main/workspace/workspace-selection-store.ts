import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { WorkspaceIdentitySchema, type WorkspaceIdentity } from '../../shared/contracts';

const FILE_NAME = 'trusted-workspace-selections.enc';
const StoredSelectionsSchema = z.array(WorkspaceIdentitySchema).max(50);

function destination(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export interface WorkspaceSelectionStore {
  read(): Promise<WorkspaceIdentity[]>;
  write(selections: readonly WorkspaceIdentity[]): Promise<void>;
}

export class EncryptedWorkspaceSelectionStore implements WorkspaceSelectionStore {
  async read(): Promise<WorkspaceIdentity[]> {
    let encoded: string;
    try {
      encoded = await readFile(destination(), 'utf8');
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Operating-system credential encryption is unavailable.');
    }
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(encoded, 'base64'));
    const selections = StoredSelectionsSchema.parse(JSON.parse(decrypted.result));
    if (decrypted.shouldReEncrypt) await this.write(selections);
    return selections;
  }

  async write(selections: readonly WorkspaceIdentity[]): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Operating-system credential encryption is unavailable.');
    }
    const validated = StoredSelectionsSchema.parse(selections);
    const target = destination();
    await mkdir(path.dirname(target), { recursive: true });
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(validated));
    await writeFile(target, encrypted.toString('base64'), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}
