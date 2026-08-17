import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => ({
  isAsyncEncryptionAvailable: vi.fn(async () => true),
  userDataPath: '',
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.userDataPath,
  },
  safeStorage: {
    decryptStringAsync: vi.fn(async (encrypted: Buffer) => ({
      result: encrypted.toString('utf8').replace(/^encrypted:/, ''),
      shouldReEncrypt: false,
    })),
    encryptStringAsync: vi.fn(async (plainText: string) =>
      Buffer.from(`encrypted:${plainText}`, 'utf8'),
    ),
    isAsyncEncryptionAvailable: electronMock.isAsyncEncryptionAvailable,
  },
}));

import { EncryptedAuthSessionStore } from './auth-session-store';

describe('encrypted auth session store', () => {
  beforeEach(async () => {
    electronMock.userDataPath = await mkdtemp(
      path.join(os.tmpdir(), 'trocode-auth-store-'),
    );
    electronMock.isAsyncEncryptionAvailable.mockResolvedValue(true);
  });

  afterEach(async () => {
    await rm(electronMock.userDataPath, { force: true, recursive: true });
    vi.clearAllMocks();
  });

  it('persists the Google session with asynchronous OS encryption', async () => {
    const store = new EncryptedAuthSessionStore();
    const session = {
      accessToken: `tro_live_${'a'.repeat(43)}`,
      accessTokenExpiresAt: '2026-09-15T07:00:00.000Z',
      signedInAt: '2026-08-15T07:00:00.000Z',
      user: {
        email: 'user@example.com',
        id: 'google-user-id',
        name: 'Example User',
      },
    };

    await store.write(session);

    await expect(store.read()).resolves.toEqual(session);
  });

  it('refuses to write an unencrypted session', async () => {
    electronMock.isAsyncEncryptionAvailable.mockResolvedValue(false);
    const store = new EncryptedAuthSessionStore();

    await expect(
      store.write({
        signedInAt: '2026-08-15T07:00:00.000Z',
        user: {
          email: 'user@example.com',
          id: 'google-user-id',
          name: 'Example User',
        },
      }),
    ).rejects.toThrow('credential encryption is unavailable');
  });
});
