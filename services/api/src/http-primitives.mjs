export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message); this.status = status; this.code = code;
  }
}

export function sendJson(response, status, value, headers = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(value));
}

export async function readJson(request, maxBytes = 1_000_000) {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json.', 'invalid_content_type');
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new HttpError(413, 'Request body is too large.', 'body_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Request body must be valid JSON.', 'invalid_json'); }
}

export function bearerToken(request) {
  const match = /^Bearer ([^\s]+)$/u.exec(String(request.headers.authorization ?? ''));
  return match?.[1] ?? null;
}

export async function requireHostedSession(request, sessionRepository) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, 'Sign in to continue.', 'authentication_required');
  const session = await sessionRepository.authenticate(token);
  if (!session) throw new HttpError(401, 'Your session expired. Sign in again.', 'session_expired');
  return session;
}

export function routeUuid(path, pattern) {
  const match = pattern.exec(path);
  return match?.groups ?? null;
}
