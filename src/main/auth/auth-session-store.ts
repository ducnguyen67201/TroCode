import { app, safeStorage } from 'electron';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { AuthUserSchema } from '../../shared/contracts';

import type { AuthSession, AuthSessionStore } from './google-auth-service';

const SESSION_FILE_NAME = 'google-auth-session.enc';
const StoredAuthSessionSchema = z.object({
  accessToken: z.string().regex(/^tro_live_[A-Za-z0-9_-]{43}$/).optional(),
  accessTokenExpiresAt: z.string().datetime().optional(),
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

    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Operating-system credential encryption is unavailable.');
    }

    const decrypted = await safeStorage.decryptStringAsync(
      Buffer.from(encoded, 'base64'),
    );
    const session = StoredAuthSessionSchema.parse(JSON.parse(decrypted.result));
    if (decrypted.shouldReEncrypt) await this.write(session);
    return session;
  }

  async write(session: AuthSession): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Operating-system credential encryption is unavailable.');
    }

    const validated = StoredAuthSessionSchema.parse(session);
    const destination = sessionPath();
    await mkdir(path.dirname(destination), { recursive: true });
    const encrypted = (
      await safeStorage.encryptStringAsync(JSON.stringify(validated))
    ).toString('base64');
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
