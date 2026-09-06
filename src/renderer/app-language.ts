import type { AppLanguage } from '../shared/contracts';

import {
  CLASSROOM_VIETNAMESE_TRANSLATIONS,
  VIETNAMESE_TRANSLATIONS,
} from './i18n/vi/messages';

export const APP_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'vi', label: 'Tiếng Việt' },
] as const satisfies ReadonlyArray<{
  code: AppLanguage;
  label: string;
}>;

export function appLanguageLabel(language: AppLanguage): string {
  return (
    APP_LANGUAGE_OPTIONS.find((option) => option.code === language)?.label ??
    language
  );
}

export function appLocale(language: AppLanguage): string {
  return language === 'vi' ? 'vi-VN' : 'en-US';
}

export function translate(
  language: AppLanguage,
  message: string,
  replacements: Readonly<Record<string, string | number>> = {},
): string {
  let translated =
    language === 'vi'
      ? (VIETNAMESE_TRANSLATIONS[message] ??
        CLASSROOM_VIETNAMESE_TRANSLATIONS[message] ??
        message)
      : message;

  for (const [key, value] of Object.entries(replacements)) {
    translated = translated.replaceAll(`{${key}}`, String(value));
  }
  return translated;
}
