import { createPublicKey, verify } from 'node:crypto';

import { z } from 'zod';

import type { AuthUser } from '../../shared/contracts';

const GOOGLE_CERTIFICATES_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set([
  'accounts.google.com',
  'https://accounts.google.com',
]);

const JwtHeaderSchema = z.object({
  alg: z.literal('RS256'),
  kid: z.string().min(1),
});

const GoogleTokenPayloadSchema = z.object({
  aud: z.union([z.string(), z.array(z.string())]),
  email: z.string().email(),
  email_verified: z.boolean(),
  exp: z.number().int(),
  iat: z.number().int(),
  iss: z.string(),
  name: z.string().min(1).optional(),
  nonce: z.string().optional(),
  sub: z.string().min(1),
});

const GoogleJwksSchema = z.object({
  keys: z.array(
    z
      .object({
        alg: z.string().optional(),
        kid: z.string().min(1),
        kty: z.string().min(1),
        use: z.string().optional(),
      })
      .passthrough(),
  ),
});

export interface VerifyGoogleIdTokenOptions {
  clientId: string;
  expectedNonce: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function parseJwtPart(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Google returned a malformed identity token.');
  }
}

function includesAudience(audience: string | string[], clientId: string): boolean {
  return typeof audience === 'string'
    ? audience === clientId
    : audience.includes(clientId);
}

export async function verifyGoogleIdToken(
  idToken: string,
  options: VerifyGoogleIdTokenOptions,
): Promise<AuthUser> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Google returned a malformed identity token.');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('Google returned a malformed identity token.');
  }

  const header = JwtHeaderSchema.parse(parseJwtPart(encodedHeader));
  const payload = GoogleTokenPayloadSchema.parse(
    parseJwtPart(encodedPayload),
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(GOOGLE_CERTIFICATES_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error('Google identity verification is temporarily unavailable.');
  }

  const jwks = GoogleJwksSchema.parse(await response.json());
  const signingKey = jwks.keys.find((key) => key.kid === header.kid);
  if (!signingKey) {
    throw new Error('Google identity verification key was not found.');
  }

  const publicKey = createPublicKey({
    format: 'jwk',
    key: signingKey as JsonWebKey,
  });
  const signatureIsValid = verify(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
    publicKey,
    Buffer.from(encodedSignature, 'base64url'),
  );
  if (!signatureIsValid) {
    throw new Error('Google identity token signature is invalid.');
  }

  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1_000);
  if (!GOOGLE_ISSUERS.has(payload.iss)) {
    throw new Error('Google identity token issuer is invalid.');
  }
  if (!includesAudience(payload.aud, options.clientId)) {
    throw new Error('Google identity token audience is invalid.');
  }
  if (payload.exp <= nowSeconds - 30 || payload.iat > nowSeconds + 300) {
    throw new Error('Google identity token is expired or not yet valid.');
  }
  if (payload.nonce !== options.expectedNonce) {
    throw new Error('Google identity token nonce is invalid.');
  }
  if (!payload.email_verified) {
    throw new Error('Your Google email address must be verified.');
  }

  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email.split('@')[0] ?? payload.email,
  };
}
