import { app, safeStorage } from 'electron';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { AuthUserSchema } from '../../shared/contracts';
import type { AuthSession, AuthSessionStore } from './google-auth-service';

const SESSION_FILE_NAME = 'google-auth-session.enc';
const StoredAuthSessionSchema = z.object({
  refreshToken: z.string().min(1).optional(),
  signedInAt: z.string().datetime(),
  user: AuthUserSchema,
});

function sessionPath(): string {
  return path.join(app.getPath('userData'), SESSION_FILE_NAME);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class EncryptedAuthSessionStore implements AuthSessionStore {
  async read(): Promise<AuthSession | null> {
    let encoded: string;
    try {
      encoded = await readFile(sessionPath(), 'utf8');
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Operating-system credential encryption is unavailable.');
    }

    const decrypted = safeStorage.decryptString(
      Buffer.from(encoded, 'base64'),
    );
    return StoredAuthSessionSchema.parse(JSON.parse(decrypted));
  }

  async write(session: AuthSession): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Operating-system credential encryption is unavailable.');
    }

    const validated = StoredAuthSessionSchema.parse(session);
    const destination = sessionPath();
    await mkdir(path.dirname(destination), { recursive: true });
    const encrypted = safeStorage
      .encryptString(JSON.stringify(validated))
      .toString('base64');
    await writeFile(destination, encrypted, { encoding: 'utf8', mode: 0o600 });
  }

  async clear(): Promise<void> {
    try {
      await unlink(sessionPath());
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
}
