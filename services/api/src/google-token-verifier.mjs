import { createPublicKey, verify } from 'node:crypto';

const GOOGLE_CERTIFICATES_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set([
  'accounts.google.com',
  'https://accounts.google.com',
]);
const JWKS_CACHE_MS = 60 * 60 * 1_000;

let cachedJwks = null;
let cachedJwksAt = 0;

function parseJwtPart(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Google identity token is malformed.');
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function audienceIncludes(audience, clientId) {
  if (typeof audience === 'string') return audience === clientId;
  return Array.isArray(audience) && audience.includes(clientId);
}

async function readGoogleJwks(fetchImpl, now) {
  if (cachedJwks && now - cachedJwksAt < JWKS_CACHE_MS) return cachedJwks;
  const response = await fetchImpl(GOOGLE_CERTIFICATES_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error('Google identity verification is unavailable.');
  }
  const document = await response.json();
  if (!document || !Array.isArray(document.keys)) {
    throw new Error('Google identity keys are malformed.');
  }
  cachedJwks = document;
  cachedJwksAt = now;
  return document;
}

export async function verifyGoogleIdToken(
  idToken,
  { clientId, fetchImpl = fetch, now = Date.now() } = {},
) {
  if (!isNonEmptyString(idToken) || idToken.length > 16_384) {
    throw new Error('Google identity token is invalid.');
  }
  const parts = idToken.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('Google identity token is malformed.');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJwtPart(encodedHeader);
  const payload = parseJwtPart(encodedPayload);
  if (
    !header ||
    header.alg !== 'RS256' ||
    !isNonEmptyString(header.kid) ||
    !payload ||
    !isNonEmptyString(payload.sub) ||
    !isNonEmptyString(payload.email) ||
    typeof payload.email_verified !== 'boolean' ||
    !Number.isInteger(payload.exp) ||
    !Number.isInteger(payload.iat) ||
    !isNonEmptyString(payload.iss)
  ) {
    throw new Error('Google identity token claims are invalid.');
  }

  const jwks = await readGoogleJwks(fetchImpl, now);
  const signingKey = jwks.keys.find((key) => key?.kid === header.kid);
  if (!signingKey) throw new Error('Google identity signing key was not found.');
  const publicKey = createPublicKey({ format: 'jwk', key: signingKey });
  const signatureIsValid = verify(
    'RSA-SHA256',
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
    publicKey,
    Buffer.from(encodedSignature, 'base64url'),
  );
  if (!signatureIsValid) {
    throw new Error('Google identity token signature is invalid.');
  }

  const nowSeconds = Math.floor(now / 1_000);
  if (!GOOGLE_ISSUERS.has(payload.iss)) {
    throw new Error('Google identity token issuer is invalid.');
  }
  if (!audienceIncludes(payload.aud, clientId)) {
    throw new Error('Google identity token audience is invalid.');
  }
  if (payload.exp <= nowSeconds - 30 || payload.iat > nowSeconds + 300) {
    throw new Error('Google identity token is expired or not yet valid.');
  }
  if (!payload.email_verified) {
    throw new Error('Google email must be verified.');
  }

  return {
    email: payload.email,
    id: payload.sub,
    name:
      isNonEmptyString(payload.name) ? payload.name : payload.email.split('@')[0],
  };
}

export function clearGoogleJwksCacheForTest() {
  cachedJwks = null;
  cachedJwksAt = 0;
}
