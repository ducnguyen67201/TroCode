#!/usr/bin/env node

import {
  createPrivateKey,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const REFERENCE_PATTERN = /^TRC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function usage() {
  return [
    'Usage:',
    '  node scripts/membership-codes.mjs keygen --private-key <path> [--public-key <path>]',
    '  node scripts/membership-codes.mjs issue --private-key <path> --reference <TRC-...> --days <1-3650>',
  ].join('\n');
}

function parseOptions(argumentsList) {
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(usage());
    }
    if (options.has(key)) throw new Error(`Duplicate option: ${key}`);
    options.set(key, value);
  }
  return options;
}

function requiredOption(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`Missing ${name}.\n${usage()}`);
  return value;
}

async function generateKeys(options) {
  const allowedOptions = new Set(['--private-key', '--public-key']);
  for (const option of options.keys()) {
    if (!allowedOptions.has(option)) throw new Error(`Unknown option: ${option}`);
  }

  const privateKeyPath = requiredOption(options, '--private-key');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  const publicKeyBase64 = publicKey
    .export({ format: 'der', type: 'spki' })
    .toString('base64');

  await writeFile(privateKeyPath, privateKeyPem, {
    flag: 'wx',
    mode: 0o600,
  });
  const publicKeyPath = options.get('--public-key');
  if (publicKeyPath) {
    await writeFile(publicKeyPath, `${publicKeyBase64}\n`, {
      flag: 'wx',
      mode: 0o644,
    });
  }

  process.stdout.write(`TROCODE_MEMBERSHIP_PUBLIC_KEY=${publicKeyBase64}\n`);
}

async function issueMembership(options) {
  const allowedOptions = new Set([
    '--days',
    '--now',
    '--private-key',
    '--reference',
  ]);
  for (const option of options.keys()) {
    if (!allowedOptions.has(option)) throw new Error(`Unknown option: ${option}`);
  }

  const privateKeyPath = requiredOption(options, '--private-key');
  const referenceCode = requiredOption(options, '--reference').toUpperCase();
  const daysText = requiredOption(options, '--days');
  const days = Number(daysText);
  if (!REFERENCE_PATTERN.test(referenceCode)) {
    throw new Error('Reference code must look like TRC-AAAA-BBBB-CCCC.');
  }
  if (!Number.isInteger(days) || days < 1 || days > 3_650) {
    throw new Error('Membership duration must be a whole number from 1 to 3650 days.');
  }

  const issuedAt = new Date(options.get('--now') ?? Date.now());
  if (Number.isNaN(issuedAt.getTime())) throw new Error('--now must be an ISO date.');
  const expiresAt = new Date(issuedAt.getTime() + days * 86_400_000);
  const privateKey = createPrivateKey(await readFile(privateKeyPath));
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('The membership private key must be Ed25519.');
  }

  const encodedPayload = Buffer.from(
    JSON.stringify({
      expiresAt: expiresAt.toISOString(),
      issuedAt: issuedAt.toISOString(),
      referenceCode,
      version: 1,
    }),
  ).toString('base64url');
  const signature = sign(null, Buffer.from(encodedPayload), privateKey).toString(
    'base64url',
  );
  process.stdout.write(`${encodedPayload}.${signature}\n`);
}

async function main() {
  const [command, ...argumentsList] = process.argv.slice(2);
  const options = parseOptions(argumentsList);
  if (command === 'keygen') {
    await generateKeys(options);
    return;
  }
  if (command === 'issue') {
    await issueMembership(options);
    return;
  }
  throw new Error(usage());
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
