import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { z } from 'zod';

import {
  HttpError,
  bearerToken,
  readJson,
  sendJson,
} from './http-primitives.mjs';
import {
  adminSessionFromCookie,
  clearAdminSessionCookie,
  issueAdminSession,
  setAdminSessionCookie,
  verifyAdminSession,
} from './admin-session.mjs';
import { PLAN_IDS } from './plan-catalog.mjs';

const ADMIN_HTML = readFileSync(
  new URL('../public/admin.html', import.meta.url),
  'utf8',
);
const ADMIN_CSS = readFileSync(
  new URL('../public/admin.css', import.meta.url),
  'utf8',
);
const ADMIN_JAVASCRIPT = readFileSync(
  new URL('../public/admin.js', import.meta.url),
  'utf8',
);
const ADMIN_FAVICON = readFileSync(
  new URL('../public/admin-favicon.svg', import.meta.url),
  'utf8',
);
const USER_ACCESS_PATH =
  /^\/v1\/admin\/users\/(?<userId>[^/]{1,768})\/access$/u;

const UserAccessSchema = z
  .object({ blocked: z.boolean() })
  .strict();
const BulkCodeSchema = z
  .object({
    count: z.number().int().min(1).max(100),
    label: z.string().trim().max(80).nullable().optional(),
    maxUsers: z.number().int().min(1).max(10_000),
    plan: z.enum(PLAN_IDS),
  })
  .strict();

function sendAsset(response, body, contentType) {
  response.statusCode = 200;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', String(Buffer.byteLength(body)));
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.end(body);
}

function sendPage(response) {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'",
  );
  sendAsset(response, ADMIN_HTML, 'text/html; charset=utf-8');
}

function sendAdminAsset(response, path) {
  if (path === '/source/admin/assets/favicon.svg') {
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    sendAsset(response, ADMIN_FAVICON, 'image/svg+xml; charset=utf-8');
    return true;
  }
  if (path === '/source/admin/assets/admin.css') {
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    sendAsset(response, ADMIN_CSS, 'text/css; charset=utf-8');
    return true;
  }
  if (path === '/source/admin/assets/admin.js') {
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    sendAsset(
      response,
      ADMIN_JAVASCRIPT,
      'text/javascript; charset=utf-8',
    );
    return true;
  }
  return false;
}

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new HttpError(400, 'Request values are invalid.', 'invalid_request');
}

function positiveInteger(value, fallback, { max, min = 0 }) {
  if (value === null) return fallback;
  if (!/^\d+$/u.test(value)) {
    throw new HttpError(400, 'Pagination values are invalid.', 'invalid_request');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, 'Pagination values are invalid.', 'invalid_request');
  }
  return parsed;
}

function tokenDigest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function equalToken(actual, expected) {
  if (typeof actual !== 'string') return false;
  return timingSafeEqual(tokenDigest(actual), tokenDigest(expected));
}

function requestIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const address = forwarded.split(',').at(-1)?.trim();
    if (address) return address;
  }
  return request.socket.remoteAddress || 'unknown';
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (origin === undefined) return;
  if (typeof origin !== 'string') {
    throw new HttpError(403, 'Browser origin is not allowed.', 'origin_denied');
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpError(403, 'Browser origin is not allowed.', 'origin_denied');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.host !== request.headers.host
  ) {
    throw new HttpError(403, 'Browser origin is not allowed.', 'origin_denied');
  }
}

export class AdminHttpController {
  constructor({ accessToken, now = () => Date.now(), rateLimiter, repository }) {
    this.accessToken = accessToken;
    this.now = now;
    this.rateLimiter = rateLimiter;
    this.repository = repository;
  }

  async authorize(request, { bearerOnly = false } = {}) {
    assertSameOrigin(request);
    const rate = await this.rateLimiter.consume({
      key: requestIp(request),
      limit: 120,
      scope: 'admin.api',
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      const error = new HttpError(
        429,
        'Too many admin requests. Try again shortly.',
        'rate_limited',
      );
      error.retryAfterSeconds = rate.retryAfterSeconds;
      throw error;
    }
    if (equalToken(bearerToken(request), this.accessToken)) return;
    const session = adminSessionFromCookie(request.headers.cookie);
    if (
      !bearerOnly &&
      verifyAdminSession(session, this.accessToken, { now: this.now() })
    ) return;
    throw new HttpError(401, 'Admin access token is invalid.', 'admin_required');
  }

  async handle({ request, response, url }) {
    const path = url.pathname;
    if (
      request.method === 'GET' &&
      (path === '/source/admin' || path === '/source/admin/')
    ) {
      sendPage(response);
      return true;
    }
    if (request.method === 'GET' && sendAdminAsset(response, path)) return true;
    if (!path.startsWith('/v1/admin/')) return false;

    if (request.method === 'POST' && path === '/v1/admin/session') {
      await this.authorize(request, { bearerOnly: true });
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader(
        'Set-Cookie',
        setAdminSessionCookie(
          issueAdminSession(this.accessToken, { now: this.now() }),
        ),
      );
      response.statusCode = 204;
      response.end();
      return true;
    }

    if (request.method === 'DELETE' && path === '/v1/admin/session') {
      await this.authorize(request);
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Set-Cookie', clearAdminSessionCookie());
      response.statusCode = 204;
      response.end();
      return true;
    }

    await this.authorize(request);
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && path === '/v1/admin/users') {
      const limit = positiveInteger(url.searchParams.get('limit'), 50, {
        max: 100,
        min: 1,
      });
      const offset = positiveInteger(url.searchParams.get('offset'), 0, {
        max: 100_000,
      });
      const search = (url.searchParams.get('search') ?? '').trim();
      if (search.length > 200) {
        throw new HttpError(400, 'Search is too long.', 'invalid_request');
      }
      const status = url.searchParams.get('status');
      if (status !== null && !['active', 'blocked'].includes(status)) {
        throw new HttpError(400, 'Status filter is invalid.', 'invalid_request');
      }
      sendJson(
        response,
        200,
        await this.repository.listUsers({
          limit,
          offset,
          search,
          ...(status ? { status } : {}),
        }),
      );
      return true;
    }

    if (request.method === 'GET' && path === '/v1/admin/access-codes') {
      const limit = positiveInteger(url.searchParams.get('limit'), 50, {
        max: 100,
        min: 1,
      });
      const offset = positiveInteger(url.searchParams.get('offset'), 0, {
        max: 100_000,
      });
      const search = (url.searchParams.get('search') ?? '').trim();
      if (search.length > 200) {
        throw new HttpError(400, 'Search is too long.', 'invalid_request');
      }
      const status = url.searchParams.get('status');
      if (status !== null && !['available', 'full'].includes(status)) {
        throw new HttpError(400, 'Status filter is invalid.', 'invalid_request');
      }
      sendJson(
        response,
        200,
        await this.repository.listAccessCodes({
          limit,
          offset,
          search,
          ...(status ? { status } : {}),
        }),
      );
      return true;
    }

    const userAccessMatch = USER_ACCESS_PATH.exec(path);
    if (request.method === 'PATCH' && userAccessMatch?.groups?.userId) {
      let userId;
      try {
        userId = decodeURIComponent(userAccessMatch.groups.userId).trim();
      } catch {
        throw new HttpError(400, 'User ID is invalid.', 'invalid_request');
      }
      if (!userId || userId.length > 255) {
        throw new HttpError(400, 'User ID is invalid.', 'invalid_request');
      }
      const body = parse(UserAccessSchema, await readJson(request, 4_096));
      const result = await this.repository.setUserBlocked(userId, body.blocked);
      if (!result) throw new HttpError(404, 'User not found.', 'user_not_found');
      sendJson(response, 200, result);
      return true;
    }

    if (
      request.method === 'POST' &&
      path === '/v1/admin/access-codes/bulk'
    ) {
      const body = parse(BulkCodeSchema, await readJson(request, 8_192));
      sendJson(
        response,
        201,
        await this.repository.createAccessCodes({
          ...body,
          label: body.label || null,
        }),
      );
      return true;
    }

    throw new HttpError(404, 'Admin endpoint not found.', 'not_found');
  }
}
