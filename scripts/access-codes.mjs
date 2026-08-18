import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import pg from 'pg';

import {
  digestAccessCode,
  normalizeAccessCode,
} from '../services/api/src/access-code-repository.mjs';
import { runMigrations } from '../services/api/src/migrate.mjs';

function usage() {
  return [
    'Usage:',
    '  npm run access-code:create -- --code <CODE> --max-users <COUNT> --plan <basic|pro|max> [--label <LABEL>]',
    '',
    'DATABASE_URL and TROCODE_SESSION_TOKEN_HMAC_KEY must match the TroCode API.',
    'Omit --code to generate a strong code automatically.',
  ].join('\n');
}

export function generateAccessCode() {
  return `TRO-${randomBytes(12).toString('hex').toUpperCase()}`;
}

export function parseCreateOptions(args) {
  if (args[0] !== 'create') throw new Error(usage());

  const allowedOptions = new Set(['--code', '--label', '--max-users', '--plan']);
  const values = new Map();
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name || !allowedOptions.has(name)) {
      throw new Error(`Unknown option: ${name ?? ''}`);
    }
    if (values.has(name)) throw new Error(`${name} may be provided only once.`);
    if (!value || value.startsWith('--')) {
      throw new Error(`${name} requires a value.`);
    }
    values.set(name, value);
  }

  const code = normalizeAccessCode(
    values.get('--code') ?? generateAccessCode(),
  );
  if (!code) {
    throw new Error(
      'Access codes must contain 4 to 64 letters, numbers, hyphens, or underscores.',
    );
  }

  const maxUsersValue = values.get('--max-users');
  const maxUsers = Number(maxUsersValue);
  if (!maxUsersValue || !Number.isInteger(maxUsers) || maxUsers < 1) {
    throw new Error('--max-users must be a positive integer.');
  }

  const labelValue = values.get('--label');
  const label = labelValue?.trim() || null;
  if (label && label.length > 100) {
    throw new Error('--label must be at most 100 characters.');
  }

  const plan = values.get('--plan');
  if (!['basic', 'pro', 'max'].includes(plan)) {
    throw new Error('--plan must be one of: basic, pro, max.');
  }

  return { code, label, maxUsers, plan };
}

export async function createAccessCode({
  code,
  databaseUrl,
  hmacKey,
  label,
  maxUsers,
  plan,
  Pool = pg.Pool,
}) {
  if (!Number.isInteger(maxUsers) || maxUsers < 1) {
    throw new Error('maxUsers must be a positive integer.');
  }
  if (label && (typeof label !== 'string' || label.length > 100)) {
    throw new Error('label must be at most 100 characters.');
  }
  if (!['basic', 'pro', 'max'].includes(plan)) {
    throw new Error('plan must be one of: basic, pro, max.');
  }
  const codeDigest = digestAccessCode(code, hmacKey);
  if (!codeDigest) throw new Error('Access code is invalid.');
  if (!databaseUrl?.trim()) throw new Error('DATABASE_URL is required.');

  const pool = new Pool({ connectionString: databaseUrl.trim(), max: 2 });
  try {
    await runMigrations(pool);
    const result = await pool.query(
      `INSERT INTO access_codes (code_digest, label, max_users, plan)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [codeDigest, label, maxUsers, plan],
    );
    return result.rows[0];
  } catch (error) {
    if (error && typeof error === 'object' && error.code === '23505') {
      throw new Error('That access code already exists.');
    }
    throw error;
  } finally {
    await pool.end();
  }
}

async function main() {
  const options = parseCreateOptions(process.argv.slice(2));
  const created = await createAccessCode({
    ...options,
    databaseUrl: process.env.DATABASE_URL,
    hmacKey: process.env.TROCODE_SESSION_TOKEN_HMAC_KEY,
  });
  console.info(`Created access code ${created.id}.`);
  console.info(`Code: ${options.code}`);
  console.info(`User limit: ${options.maxUsers}`);
  console.info(`Plan: ${options.plan}`);
  if (options.label) console.info(`Label: ${options.label}`);
  console.info(
    'Store the code securely; PostgreSQL keeps only its keyed HMAC digest.',
  );
}

const isEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
