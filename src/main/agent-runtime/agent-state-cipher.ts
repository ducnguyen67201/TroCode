import { safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename } from 'node:fs/promises';
import path from 'node:path';

export interface AgentStateCipher {
  decrypt(value: Buffer): Promise<string>;
  encrypt(value: string): Promise<Buffer>;
  isAvailable(): Promise<boolean>;
}

export const operatingSystemCipher: AgentStateCipher = {
  isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: async (value) => safeStorage.encryptStringAsync(value),
  decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result,
};

export async function atomicWrite(target: string, value: string | Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    if (typeof value === 'string') await handle.writeFile(value, 'utf8');
    else await handle.writeFile(value);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  // Windows does not support opening a directory for fsync. The temporary file
  // itself is still flushed before the atomic rename on every platform.
  if (process.platform !== 'win32') {
    const directory = await open(path.dirname(target), 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}
