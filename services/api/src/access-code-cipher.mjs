import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

const CIPHER_VERSION = 1;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MIN_SEALED_BYTES = 1 + IV_BYTES + AUTH_TAG_BYTES + 1;

function encryptionKey(hmacKey) {
  if (typeof hmacKey !== 'string' || hmacKey.length < 32) {
    throw new Error('Access code encryption requires a strong server key.');
  }
  return createHmac('sha256', hmacKey)
    .update('trocode-access-code-encryption-v1\0', 'utf8')
    .digest();
}

function assertDigest(codeDigest) {
  if (!Buffer.isBuffer(codeDigest) || codeDigest.length !== 32) {
    throw new Error('Access code digest must be 32 bytes.');
  }
}

export function sealAccessCode(code, hmacKey, codeDigest) {
  if (typeof code !== 'string' || !code) {
    throw new Error('Access code plaintext is required.');
  }
  assertDigest(codeDigest);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(hmacKey), iv);
  cipher.setAAD(codeDigest);
  const ciphertext = Buffer.concat([
    cipher.update(code, 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([
    Buffer.from([CIPHER_VERSION]),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

export function openAccessCode(sealed, hmacKey, codeDigest) {
  assertDigest(codeDigest);
  if (!Buffer.isBuffer(sealed) || sealed.length < MIN_SEALED_BYTES) {
    throw new Error('Could not authenticate access code ciphertext.');
  }
  if (sealed[0] !== CIPHER_VERSION) {
    throw new Error('Could not authenticate access code ciphertext.');
  }
  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const authTag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = sealed.subarray(1 + IV_BYTES + AUTH_TAG_BYTES);
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(hmacKey),
      iv,
    );
    decipher.setAAD(codeDigest);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Could not authenticate access code ciphertext.');
  }
}
