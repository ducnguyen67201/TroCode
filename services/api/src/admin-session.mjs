import { createHmac, timingSafeEqual } from 'node:crypto';

export const ADMIN_SESSION_COOKIE_NAME = 'trocode_admin_session';
export const ADMIN_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const SESSION_VERSION = 'v1';
const SESSION_PATTERN = /^v1\.(\d{10,12})\.([A-Za-z0-9_-]{43})$/u;

function signature(payload, accessToken) {
  if (typeof accessToken !== 'string' || accessToken.length < 32) {
    throw new Error('Admin sessions require a strong access token.');
  }
  return createHmac('sha256', accessToken)
    .update('trocode-admin-browser-session-v1\0', 'utf8')
    .update(payload, 'utf8')
    .digest('base64url');
}

function equalSignature(actual, expected) {
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(
    Buffer.from(actual, 'ascii'),
    Buffer.from(expected, 'ascii'),
  );
}

export function issueAdminSession(accessToken, { now = Date.now() } = {}) {
  const expiresAt =
    Math.floor(now / 1_000) + ADMIN_SESSION_MAX_AGE_SECONDS;
  const payload = `${SESSION_VERSION}.${expiresAt}`;
  return `${payload}.${signature(payload, accessToken)}`;
}

export function verifyAdminSession(
  value,
  accessToken,
  { now = Date.now() } = {},
) {
  if (typeof value !== 'string' || value.length > 256) return false;
  const match = SESSION_PATTERN.exec(value);
  if (!match) return false;
  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt)) return false;
  const nowSeconds = Math.floor(now / 1_000);
  if (expiresAt <= nowSeconds) return false;
  const payload = `${SESSION_VERSION}.${expiresAt}`;
  try {
    return equalSignature(match[2], signature(payload, accessToken));
  } catch {
    return false;
  }
}

export function adminSessionFromCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string' || cookieHeader.length > 8_192) {
    return null;
  }
  const prefix = `${ADMIN_SESSION_COOKIE_NAME}=`;
  for (const part of cookieHeader.split(';')) {
    const candidate = part.trim();
    if (candidate.startsWith(prefix)) return candidate.slice(prefix.length);
  }
  return null;
}

export function setAdminSessionCookie(value) {
  if (typeof value !== 'string' || !SESSION_PATTERN.test(value)) {
    throw new Error('Admin session cookie value is invalid.');
  }
  return [
    `${ADMIN_SESSION_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`,
  ].join('; ');
}

export function clearAdminSessionCookie() {
  return [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ');
}
