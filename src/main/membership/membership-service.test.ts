import { execFile } from 'node:child_process';
import {
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '../../shared/contracts';

import {
  MembershipService,
  membershipReferenceCode,
  type MembershipActivationStore,
} from './membership-service';

const TEST_USER: AuthUser = {
  email: 'person@example.com',
  id: 'google-user-123',
  name: 'Test Person',
};
const NOW = new Date('2026-08-16T08:00:00.000Z');
const execFileAsync = promisify(execFile);

function memoryStore(initial: string | null = null): {
  read: ReturnType<typeof vi.fn>;
  store: MembershipActivationStore;
  write: ReturnType<typeof vi.fn>;
} {
  let activationCode = initial;
  const read = vi.fn(async () => activationCode);
  const write = vi.fn(async (nextCode: string) => {
    activationCode = nextCode;
  });
  return { read, store: { read, write }, write };
}

function publicKeyConfiguration(publicKey: KeyObject): string {
  return publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64');
}

function issueCode(
  privateKey: KeyObject,
  input: {
    expiresAt?: string;
    issuedAt?: string;
    referenceCode?: string;
  } = {},
): string {
  const encodedPayload = Buffer.from(
    JSON.stringify({
      expiresAt: input.expiresAt ?? '2026-09-15T08:00:00.000Z',
      issuedAt: input.issuedAt ?? NOW.toISOString(),
      referenceCode:
        input.referenceCode ?? membershipReferenceCode(TEST_USER),
      version: 1,
    }),
  ).toString('base64url');
  const signature = sign(null, Buffer.from(encodedPayload), privateKey).toString(
    'base64url',
  );
  return `${encodedPayload}.${signature}`;
}

describe('MembershipService', () => {
  it('bypasses membership outside packaged production builds', async () => {
    const { read, store } = memoryStore();
    const service = new MembershipService({
      now: () => NOW,
      publicKey: '',
      required: false,
      store,
    });

    await expect(service.getStatus(TEST_USER)).resolves.toMatchObject({
      expiresAt: null,
      referenceCode: membershipReferenceCode(TEST_USER),
      required: false,
      state: 'bypassed',
    });
    await expect(service.assertActive(TEST_USER)).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('returns an inactive production status with a stable reference code', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const { store } = memoryStore();
    const service = new MembershipService({
      now: () => NOW,
      publicKey: publicKeyConfiguration(publicKey),
      required: true,
      store,
    });

    const status = await service.getStatus(TEST_USER);

    expect(status).toMatchObject({
      expiresAt: null,
      referenceCode: membershipReferenceCode(TEST_USER),
      required: true,
      state: 'inactive',
    });
    expect(status.referenceCode).toMatch(/^TRC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    await expect(service.assertActive(TEST_USER)).rejects.toThrow(
      'active membership',
    );
  });

  it('activates and persists a correctly signed, user-bound code', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const { store, write } = memoryStore();
    const service = new MembershipService({
      now: () => NOW,
      publicKey: publicKeyConfiguration(publicKey),
      required: true,
      store,
    });
    const activationCode = issueCode(privateKey);

    await expect(
      service.activate(TEST_USER, activationCode),
    ).resolves.toMatchObject({
      expiresAt: '2026-09-15T08:00:00.000Z',
      required: true,
      state: 'active',
    });
    expect(write).toHaveBeenCalledWith(activationCode);
    await expect(service.assertActive(TEST_USER)).resolves.toBeUndefined();
  });

  it('rejects a code signed by an unknown private key without persisting it', async () => {
    const trustedKeys = generateKeyPairSync('ed25519');
    const unknownKeys = generateKeyPairSync('ed25519');
    const { store, write } = memoryStore();
    const service = new MembershipService({
      now: () => NOW,
      publicKey: publicKeyConfiguration(trustedKeys.publicKey),
      required: true,
      store,
    });

    await expect(
      service.activate(TEST_USER, issueCode(unknownKeys.privateKey)),
    ).rejects.toThrow('not valid');
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a valid code issued for a different reference code', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const { store, write } = memoryStore();
    const service = new MembershipService({
      now: () => NOW,
      publicKey: publicKeyConfiguration(publicKey),
      required: true,
      store,
    });

    await expect(
      service.activate(
        TEST_USER,
        issueCode(privateKey, { referenceCode: 'TRC-AAAA-BBBB-CCCC' }),
      ),
    ).rejects.toThrow('another account');
    expect(write).not.toHaveBeenCalled();
  });

  it('reports expiry and denies access after the signed end time', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const expiredCode = issueCode(privateKey, {
      expiresAt: '2026-08-16T07:59:59.000Z',
      issuedAt: '2026-08-15T08:00:00.000Z',
    });
    const { store } = memoryStore(expiredCode);
    const service = new MembershipService({
      now: () => NOW,
      publicKey: publicKeyConfiguration(publicKey),
      required: true,
      store,
    });

    await expect(service.getStatus(TEST_USER)).resolves.toMatchObject({
      expiresAt: '2026-08-16T07:59:59.000Z',
      state: 'expired',
    });
    await expect(service.assertActive(TEST_USER)).rejects.toThrow('expired');
  });

  it('rejects a correctly signed code whose issue time is too far ahead', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const { store, write } = memoryStore();
    const service = new MembershipService({
      now: () => NOW,
      publicKey: publicKeyConfiguration(publicKey),
      required: true,
      store,
    });

    await expect(
      service.activate(
        TEST_USER,
        issueCode(privateKey, {
          expiresAt: '2026-09-15T08:10:01.000Z',
          issuedAt: '2026-08-16T08:10:01.000Z',
        }),
      ),
    ).rejects.toThrow('not valid yet');
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a signed payload whose expiry is not after its issue time', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const { store, write } = memoryStore();
    const service = new MembershipService({
      now: () => NOW,
      publicKey: publicKeyConfiguration(publicKey),
      required: true,
      store,
    });

    await expect(
      service.activate(
        TEST_USER,
        issueCode(privateKey, {
          expiresAt: '2026-08-16T08:00:00.000Z',
          issuedAt: '2026-08-16T08:00:00.000Z',
        }),
      ),
    ).rejects.toThrow('not valid');
    expect(write).not.toHaveBeenCalled();
  });

  it('returns an error status when encrypted membership storage cannot be read', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const service = new MembershipService({
      now: () => NOW,
      publicKey: publicKeyConfiguration(publicKey),
      required: true,
      store: {
        read: vi.fn(async () => {
          throw new Error('storage failure');
        }),
        write: vi.fn(),
      },
    });

    await expect(service.getStatus(TEST_USER)).resolves.toMatchObject({
      state: 'error',
      summary: expect.stringContaining('could not be read'),
    });
  });

  it('fails closed when a production build has no verification key', async () => {
    const { store } = memoryStore();
    const service = new MembershipService({
      now: () => NOW,
      publicKey: '',
      required: true,
      store,
    });

    await expect(service.getStatus(TEST_USER)).resolves.toMatchObject({
      required: true,
      state: 'error',
    });
    await expect(service.assertActive(TEST_USER)).rejects.toThrow(
      'not configured',
    );
  });

  it('accepts activation codes issued by the administrator CLI', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'trocode-membership-cli-'),
    );
    const privateKeyPath = path.join(temporaryDirectory, 'private.pem');
    const publicKeyPath = path.join(temporaryDirectory, 'public.txt');

    try {
      const keygen = await execFileAsync(
        process.execPath,
        [
          path.resolve('scripts/membership-codes.mjs'),
          'keygen',
          '--private-key',
          privateKeyPath,
          '--public-key',
          publicKeyPath,
        ],
        { cwd: process.cwd() },
      );
      const configuredKey = (await readFile(publicKeyPath, 'utf8')).trim();
      expect(keygen.stdout.trim()).toBe(
        `TROCODE_MEMBERSHIP_PUBLIC_KEY=${configuredKey}`,
      );

      const { stdout } = await execFileAsync(
        process.execPath,
        [
          path.resolve('scripts/membership-codes.mjs'),
          'issue',
          '--private-key',
          privateKeyPath,
          '--reference',
          membershipReferenceCode(TEST_USER),
          '--days',
          '30',
          '--now',
          NOW.toISOString(),
        ],
        { cwd: process.cwd() },
      );
      const { store } = memoryStore();
      const service = new MembershipService({
        now: () => NOW,
        publicKey: configuredKey,
        required: true,
        store,
      });

      await expect(
        service.activate(TEST_USER, stdout.trim()),
      ).resolves.toMatchObject({
        expiresAt: '2026-09-15T08:00:00.000Z',
        state: 'active',
      });
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
