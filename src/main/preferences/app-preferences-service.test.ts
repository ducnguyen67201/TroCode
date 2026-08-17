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

    await expect(service.get()).resolves.toEqual({
      appLanguage: 'en',
      muteSystemAudioWhileSpeaking: false,
      primaryLanguage: null,
    });
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
      service.update({
        appLanguage: 'vi',
        muteSystemAudioWhileSpeaking: true,
        primaryLanguage: 'vi',
      }),
    ).resolves.toEqual({
      appLanguage: 'vi',
      muteSystemAudioWhileSpeaking: true,
      primaryLanguage: 'vi',
    });
    await expect(service.getPrimaryLanguage()).resolves.toBe('vi');
    expect(store.write).toHaveBeenCalledWith({
      appLanguage: 'vi',
      muteSystemAudioWhileSpeaking: true,
      primaryLanguage: 'vi',
    });
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

  it('rejects an unsupported app language before writing', async () => {
    const store: AppPreferencesStore = {
      read: vi.fn(async () => null),
      write: vi.fn(),
    };
    const service = new AppPreferencesService(store);

    await expect(
      service.update({ appLanguage: 'fr', primaryLanguage: 'en' }),
    ).rejects.toThrow();
    expect(store.write).not.toHaveBeenCalled();
  });
});

describe('FileAppPreferencesStore', () => {
  it('round-trips preferences in the application data directory', async () => {
    const filePath = await temporaryPreferencesPath();
    const store = new FileAppPreferencesStore(filePath);

    await expect(store.read()).resolves.toBeNull();
    await store.write({
      appLanguage: 'vi',
      muteSystemAudioWhileSpeaking: true,
      primaryLanguage: 'en',
    });

    await expect(store.read()).resolves.toEqual({
      appLanguage: 'vi',
      muteSystemAudioWhileSpeaking: true,
      primaryLanguage: 'en',
    });
    await expect(readFile(filePath, 'utf8')).resolves.toContain(
      '"appLanguage": "vi"',
    );
    await expect(readFile(filePath, 'utf8')).resolves.toContain(
      '"muteSystemAudioWhileSpeaking": true',
    );
    await expect(readFile(filePath, 'utf8')).resolves.toContain(
      '"primaryLanguage": "en"',
    );
  });

  it('loads preferences saved before app language was introduced', async () => {
    const service = new AppPreferencesService({
      read: vi.fn(async () => ({ primaryLanguage: 'vi' })),
      write: vi.fn(),
    });

    await expect(service.get()).resolves.toEqual({
      appLanguage: 'en',
      muteSystemAudioWhileSpeaking: false,
      primaryLanguage: 'vi',
    });
  });
});
