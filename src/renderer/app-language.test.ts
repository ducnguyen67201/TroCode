import { describe, expect, it } from 'vitest';

import { AppLanguageSchema } from '../shared/contracts';

import {
  APP_LANGUAGE_OPTIONS,
  appLanguageLabel,
  appLocale,
  translate,
} from './app-language';

describe('app language', () => {
  it('only exposes interface languages supported by the shared contract', () => {
    expect(
      APP_LANGUAGE_OPTIONS.every((option) =>
        AppLanguageSchema.safeParse(option.code).success,
      ),
    ).toBe(true);
  });

  it('provides native labels and locales', () => {
    expect(appLanguageLabel('en')).toBe('English');
    expect(appLanguageLabel('vi')).toBe('Tiếng Việt');
    expect(appLocale('vi')).toBe('vi-VN');
  });

  it('translates known interface copy and interpolates values', () => {
    expect(translate('vi', 'Settings')).toBe('Cài đặt');
    expect(translate('vi', 'Version {version}', { version: '0.2.0' })).toBe(
      'Phiên bản 0.2.0',
    );
    expect(translate('en', 'Settings')).toBe('Settings');
  });
});
