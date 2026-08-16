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

import { EncryptedMembershipActivationStore } from './membership-activation-store';

describe('encrypted membership activation store', () => {
  beforeEach(async () => {
    electronMock.userDataPath = await mkdtemp(
      path.join(os.tmpdir(), 'trocode-membership-store-'),
    );
    electronMock.isAsyncEncryptionAvailable.mockResolvedValue(true);
  });

  afterEach(async () => {
    await rm(electronMock.userDataPath, { force: true, recursive: true });
    vi.clearAllMocks();
  });

  it('returns null before a membership code is saved', async () => {
    const store = new EncryptedMembershipActivationStore();

    await expect(store.read()).resolves.toBeNull();
  });

  it('persists the activation code with operating-system encryption', async () => {
    const store = new EncryptedMembershipActivationStore();
    const activationCode = `${'a'.repeat(80)}.${'b'.repeat(86)}`;

    await store.write(activationCode);

    await expect(store.read()).resolves.toBe(activationCode);
  });

  it('refuses to persist an activation code without OS encryption', async () => {
    electronMock.isAsyncEncryptionAvailable.mockResolvedValue(false);
    const store = new EncryptedMembershipActivationStore();

    await expect(store.write('activation-code')).rejects.toThrow(
      'credential encryption is unavailable',
    );
  });

  it('refuses to read a saved code when OS encryption becomes unavailable', async () => {
    const store = new EncryptedMembershipActivationStore();
    const activationCode = `${'a'.repeat(80)}.${'b'.repeat(86)}`;
    await store.write(activationCode);
    electronMock.isAsyncEncryptionAvailable.mockResolvedValue(false);

    await expect(store.read()).rejects.toThrow(
      'credential encryption is unavailable',
    );
  });
});
