import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAccessCode,
  generateAccessCode,
  parseCreateOptions,
} from './access-codes.mjs';

const TEST_HMAC_KEY = 'test-access-code-key-that-is-at-least-32-characters';

test('parses a fixed code and account limit', () => {
  assert.deepEqual(
    parseCreateOptions([
      'create',
      '--code',
      'codea',
      '--max-users',
      '10',
      '--label',
      'Private beta',
    ]),
    { code: 'CODEA', label: 'Private beta', maxUsers: 10 },
  );
});

test('generates a strong code when the administrator omits one', () => {
  assert.match(generateAccessCode(), /^TRO-[A-F0-9]{24}$/u);
  assert.match(
    parseCreateOptions(['create', '--max-users', '3']).code,
    /^TRO-[A-F0-9]{24}$/u,
  );
});

test('creates the database row with a digest instead of plaintext', async () => {
  const queries = [];
  class FakePool {
    async query(sql, parameters = []) {
      queries.push({ parameters, sql });
      return sql.includes('INSERT INTO access_codes')
        ? { rows: [{ created_at: new Date(), id: 'code-id' }] }
        : { rows: [] };
    }

    async end() {}
  }

  await createAccessCode({
    code: 'CODEA',
    databaseUrl: 'postgresql://example.invalid/trocode',
    hmacKey: TEST_HMAC_KEY,
    label: 'Private beta',
    maxUsers: 10,
    Pool: FakePool,
  });

  const insert = queries.find((query) =>
    query.sql.includes('INSERT INTO access_codes'),
  );
  assert(insert);
  assert(Buffer.isBuffer(insert.parameters[0]));
  assert.equal(insert.parameters[0].length, 32);
  assert.equal(insert.parameters[0].includes(Buffer.from('CODEA')), false);
  assert.deepEqual(insert.parameters.slice(1), ['Private beta', 10]);
});

test('rejects invalid limits and malformed codes', () => {
  assert.throws(
    () => parseCreateOptions(['create', '--code', 'bad code', '--max-users', '10']),
    /Access codes must contain/u,
  );
  assert.throws(
    () => parseCreateOptions(['create', '--code', 'CODEA', '--max-users', '0']),
    /positive integer/u,
  );
  assert.throws(
    () =>
      parseCreateOptions([
        'create',
        '--code',
        'CODEA',
        '--max-users',
        '10',
        'unexpected',
      ]),
    /Unknown option/u,
  );
});
