import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const StoredAnalyticsIdentitySchema = z.object({
  anonymousId: z.string().uuid(),
});

export interface AnalyticsIdentity {
  anonymousId: string;
  userId?: string;
}

export interface AnalyticsIdentityStore {
  load(): Promise<AnalyticsIdentity>;
  save(identity: AnalyticsIdentity): Promise<void>;
}

export class FileAnalyticsIdentityStore implements AnalyticsIdentityStore {
  constructor(
    private readonly filePath: string,
    private readonly createAnonymousId: () => string = randomUUID,
  ) {}

  async load(): Promise<AnalyticsIdentity> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      return StoredAnalyticsIdentitySchema.parse(JSON.parse(contents));
    } catch {
      // Invalid or unreadable analytics state is replaced with a fresh,
      // non-identifying installation ID instead of blocking application startup.
      const identity = StoredAnalyticsIdentitySchema.parse({
        anonymousId: this.createAnonymousId(),
      });
      await this.save(identity);
      return identity;
    }
  }

  async save(identity: AnalyticsIdentity): Promise<void> {
    const parsedIdentity = StoredAnalyticsIdentitySchema.parse(identity);
    const directory = path.dirname(this.filePath);

    await mkdir(directory, { recursive: true });
    await writeFile(
      this.filePath,
      `${JSON.stringify(parsedIdentity, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }
}
