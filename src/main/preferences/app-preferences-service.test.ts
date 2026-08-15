import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AppPreferencesService,
  FileAppPreferencesStore,
  type AppPreferencesStore,
} from './app-preferences-service';

const temporaryDirectories: string[] = [];

async function temporaryPreferencesPath(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'trocode-prefs-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'preferences.json');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('AppPreferencesService', () => {
  it('requires onboarding when no primary language has been saved', async () => {
    const service = new AppPreferencesService({
      read: vi.fn(async () => null),
      write: vi.fn(),
    });

    await expect(service.get()).resolves.toEqual({ primaryLanguage: null });
    await expect(service.getPrimaryLanguage()).resolves.toBe('en');
  });

  it('validates and persists a primary language', async () => {
    let stored: unknown = null;
    const store: AppPreferencesStore = {
      read: vi.fn(async () => stored),
      write: vi.fn(async (preferences) => {
        stored = preferences;
      }),
    };
    const service = new AppPreferencesService(store);

    await expect(
      service.update({ primaryLanguage: 'vi' }),
    ).resolves.toEqual({ primaryLanguage: 'vi' });
    await expect(service.getPrimaryLanguage()).resolves.toBe('vi');
    expect(store.write).toHaveBeenCalledWith({ primaryLanguage: 'vi' });
  });

  it('rejects unsupported language codes before writing', async () => {
    const store: AppPreferencesStore = {
      read: vi.fn(async () => null),
      write: vi.fn(),
    };
    const service = new AppPreferencesService(store);

    await expect(
      service.update({ primaryLanguage: 'xx' }),
    ).rejects.toThrow();
    expect(store.write).not.toHaveBeenCalled();
  });
});

describe('FileAppPreferencesStore', () => {
  it('round-trips preferences in the application data directory', async () => {
    const filePath = await temporaryPreferencesPath();
    const store = new FileAppPreferencesStore(filePath);

    await expect(store.read()).resolves.toBeNull();
    await store.write({ primaryLanguage: 'en' });

    await expect(store.read()).resolves.toEqual({ primaryLanguage: 'en' });
    await expect(readFile(filePath, 'utf8')).resolves.toContain(
      '"primaryLanguage": "en"',
    );
  });
});
