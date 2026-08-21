import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeKey(key) {
  const value = Buffer.isBuffer(key) ? key : Buffer.from(key, 'base64');
  if (value.byteLength !== 32) throw new Error('Agent-state encryption keys must be 32 bytes.');
  return value;
}

export function parseAgentStateKeys(value, currentVersion) {
  const keys = new Map();
  for (const entry of String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    if (separator <= 0) throw new Error('Agent-state keys must use version:base64 format.');
    const version = Number(entry.slice(0, separator));
    if (!Number.isInteger(version) || version <= 0 || keys.has(version)) {
      throw new Error('Agent-state key versions must be unique positive integers.');
    }
    keys.set(version, normalizeKey(entry.slice(separator + 1)));
  }
  if (!keys.has(currentVersion)) throw new Error('The current agent-state key version is unavailable.');
  return keys;
}

export class AgentStateCrypto {
  constructor({ currentKeyVersion, keys }) {
    if (!Number.isInteger(currentKeyVersion) || currentKeyVersion <= 0) {
      throw new Error('A positive current agent-state key version is required.');
    }
    this.currentKeyVersion = currentKeyVersion;
    this.keys = new Map([...keys].map(([version, key]) => [version, normalizeKey(key)]));
    if (!this.keys.has(currentKeyVersion)) throw new Error('Current agent-state key is unavailable.');
  }

  encryptJson(value, metadata) {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.keys.get(this.currentKeyVersion), iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(stableJson(metadata), 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    return {
      ciphertext,
      iv,
      keyVersion: this.currentKeyVersion,
      tag: cipher.getAuthTag(),
    };
  }

  decryptJson(envelope, metadata) {
    const key = this.keys.get(envelope.keyVersion);
    if (!key) throw new Error(`Agent-state key version ${envelope.keyVersion} is unavailable.`);
    const decipher = createDecipheriv(ALGORITHM, key, envelope.iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(stableJson(metadata), 'utf8'));
    decipher.setAuthTag(envelope.tag);
    const plaintext = Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8'));
  }
}
