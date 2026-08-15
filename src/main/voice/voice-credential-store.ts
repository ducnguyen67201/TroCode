import { app, safeStorage } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { VoiceCredentialStore } from './voice-service';

const CREDENTIAL_FILE_NAME = 'openai-voice-key.enc';

function credentialPath(): string {
  return path.join(app.getPath('userData'), CREDENTIAL_FILE_NAME);
}

export class EncryptedVoiceCredentialStore implements VoiceCredentialStore {
  async read(): Promise<string | null> {
    let encoded: string;
    try {
      encoded = await readFile(credentialPath(), 'utf8');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Operating-system credential encryption is unavailable.');
    }

    return safeStorage.decryptString(Buffer.from(encoded, 'base64')).trim();
  }

  async write(apiKey: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Operating-system credential encryption is unavailable.');
    }

    const destination = credentialPath();
    await mkdir(path.dirname(destination), { recursive: true });
    const encrypted = safeStorage.encryptString(apiKey).toString('base64');
    await writeFile(destination, encrypted, { encoding: 'utf8', mode: 0o600 });
  }
}
