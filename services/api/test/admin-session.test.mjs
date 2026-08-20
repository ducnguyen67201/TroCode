import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  clearAdminSessionCookie,
  issueAdminSession,
  setAdminSessionCookie,
  verifyAdminSession,
} from '../src/admin-session.mjs';

const ADMIN_TOKEN = 'test-admin-token-that-is-longer-than-thirty-two-characters';
const ROTATED_TOKEN = 'rotated-admin-token-that-is-longer-than-thirty-two-chars';
const ISSUED_AT = Date.parse('2026-08-20T08:45:00.000Z');

test('issues a signed admin session that expires after thirty days', () => {
  const session = issueAdminSession(ADMIN_TOKEN, { now: ISSUED_AT });

  assert.equal(session.includes(ADMIN_TOKEN), false);
  assert.equal(
    verifyAdminSession(session, ADMIN_TOKEN, { now: ISSUED_AT }),
    true,
  );
  assert.equal(
    verifyAdminSession(session, ADMIN_TOKEN, {
      now: ISSUED_AT + ADMIN_SESSION_MAX_AGE_SECONDS * 1_000 + 1,
    }),
    false,
  );
});

test('rejects tampered sessions and sessions signed by a rotated token', () => {
  const session = issueAdminSession(ADMIN_TOKEN, { now: ISSUED_AT });
  const tampered = `${session.slice(0, -1)}${session.endsWith('A') ? 'B' : 'A'}`;

  assert.equal(
    verifyAdminSession(tampered, ADMIN_TOKEN, { now: ISSUED_AT }),
    false,
  );
  assert.equal(
    verifyAdminSession(session, ROTATED_TOKEN, { now: ISSUED_AT }),
    false,
  );
});

test('sets and clears only hardened HttpOnly browser cookies', () => {
  const session = issueAdminSession(ADMIN_TOKEN, { now: ISSUED_AT });
  const persistentCookie = setAdminSessionCookie(session);
  const clearedCookie = clearAdminSessionCookie();

  assert.match(persistentCookie, /^trocode_admin_session=/u);
  assert.match(persistentCookie, /Path=\//u);
  assert.match(persistentCookie, /HttpOnly/u);
  assert.match(persistentCookie, /Secure/u);
  assert.match(persistentCookie, /SameSite=Strict/u);
  assert.match(
    persistentCookie,
    new RegExp(`Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`, 'u'),
  );
  assert.doesNotMatch(persistentCookie, new RegExp(ADMIN_TOKEN, 'u'));
  assert.match(clearedCookie, /Max-Age=0/u);
});
