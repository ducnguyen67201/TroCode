import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { MembershipActivationStore } from './membership-service';

const MEMBERSHIP_FILE_NAME = 'membership-activation.enc';
const StoredActivationCodeSchema = z.string().min(40).max(4_096);

function membershipPath(): string {
  return path.join(app.getPath('userData'), MEMBERSHIP_FILE_NAME);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export class EncryptedMembershipActivationStore
  implements MembershipActivationStore
{
  async read(): Promise<string | null> {
    let encoded: string;
    try {
      encoded = await readFile(membershipPath(), 'utf8');
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
    const activationCode = StoredActivationCodeSchema.parse(decrypted.result);
    if (decrypted.shouldReEncrypt) await this.write(activationCode);
    return activationCode;
  }

  async write(activationCode: string): Promise<void> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) {
      throw new Error('Operating-system credential encryption is unavailable.');
    }

    const validated = StoredActivationCodeSchema.parse(activationCode);
    const destination = membershipPath();
    await mkdir(path.dirname(destination), { recursive: true });
    const encrypted = (
      await safeStorage.encryptStringAsync(validated)
    ).toString('base64');
    await writeFile(destination, encrypted, { encoding: 'utf8', mode: 0o600 });
  }
}
