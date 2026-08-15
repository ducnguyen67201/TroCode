import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { verifyGoogleIdToken } from './google-token-verifier';

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('verifyGoogleIdToken', () => {
  it('verifies the Google signature and required identity claims', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const now = Date.UTC(2026, 7, 15, 6, 0, 0);
    const nowSeconds = Math.floor(now / 1_000);
    const header = encode({ alg: 'RS256', kid: 'test-key' });
    const payload = encode({
      aud: 'desktop-client.apps.googleusercontent.com',
      email: 'person@example.com',
      email_verified: true,
      exp: nowSeconds + 3_600,
      iat: nowSeconds,
      iss: 'https://accounts.google.com',
      name: 'Test Person',
      nonce: 'expected-nonce',
      sub: 'google-user-123',
    });
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      privateKey,
    ).toString('base64url');
    const token = `${header}.${payload}.${signature}`;
    const jwk = publicKey.export({ format: 'jwk' });
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({ keys: [{ ...jwk, alg: 'RS256', kid: 'test-key' }] }),
        { status: 200 },
      ),
    );

    await expect(
      verifyGoogleIdToken(token, {
        clientId: 'desktop-client.apps.googleusercontent.com',
        expectedNonce: 'expected-nonce',
        fetchImpl,
        now: () => now,
      }),
    ).resolves.toEqual({
      id: 'google-user-123',
      email: 'person@example.com',
      name: 'Test Person',
    });
  });

  it('rejects a token issued for another nonce', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const now = Date.UTC(2026, 7, 15, 6, 0, 0);
    const nowSeconds = Math.floor(now / 1_000);
    const header = encode({ alg: 'RS256', kid: 'test-key' });
    const payload = encode({
      aud: 'desktop-client.apps.googleusercontent.com',
      email: 'person@example.com',
      email_verified: true,
      exp: nowSeconds + 3_600,
      iat: nowSeconds,
      iss: 'accounts.google.com',
      nonce: 'different-nonce',
      sub: 'google-user-123',
    });
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      privateKey,
    ).toString('base64url');
    const jwk = publicKey.export({ format: 'jwk' });

    await expect(
      verifyGoogleIdToken(`${header}.${payload}.${signature}`, {
        clientId: 'desktop-client.apps.googleusercontent.com',
        expectedNonce: 'expected-nonce',
        fetchImpl: vi.fn<typeof fetch>(async () =>
          new Response(
            JSON.stringify({
              keys: [{ ...jwk, alg: 'RS256', kid: 'test-key' }],
            }),
            { status: 200 },
          ),
        ),
        now: () => now,
      }),
    ).rejects.toThrow('nonce is invalid');
  });
});
