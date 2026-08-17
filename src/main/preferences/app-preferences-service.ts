import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AppPreferencesSchema,
  UpdateAppPreferencesRequestSchema,
  type AppPreferences,
  type PrimaryLanguage,
} from '../../shared/contracts';

const EMPTY_PREFERENCES: AppPreferences = {
  appLanguage: 'en',
  muteSystemAudioWhileSpeaking: false,
  primaryLanguage: null,
};

export interface AppPreferencesStore {
  read(): Promise<unknown | null>;
  write(preferences: AppPreferences): Promise<void>;
}

export class FileAppPreferencesStore implements AppPreferencesStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(this.filePath, 'utf8')) as unknown;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }
  }

  async write(preferences: AppPreferences): Promise<void> {
    const validated = AppPreferencesSchema.parse(preferences);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      `${JSON.stringify(validated, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }
}

export class AppPreferencesService {
  constructor(private readonly store: AppPreferencesStore) {}

  async get(): Promise<AppPreferences> {
    const stored = await this.store.read();
    return stored === null
      ? { ...EMPTY_PREFERENCES }
      : AppPreferencesSchema.parse(stored);
  }

  async update(input: unknown): Promise<AppPreferences> {
    const update = UpdateAppPreferencesRequestSchema.parse(input);
    const preferences = AppPreferencesSchema.parse(update);
    await this.store.write(preferences);
    return preferences;
  }

  async getPrimaryLanguage(
    fallback: PrimaryLanguage = 'en',
  ): Promise<PrimaryLanguage> {
    return (await this.get()).primaryLanguage ?? fallback;
  }
}
