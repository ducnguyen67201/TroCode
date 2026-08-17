import type {
  AppLanguage,
  AppPreferences,
  PrimaryLanguage,
} from '../shared/contracts';

import { appLocale } from './app-language';

export const PRIMARY_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'tr', label: 'Turkish' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ms', label: 'Malay' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'th', label: 'Thai' },
] as const satisfies ReadonlyArray<{
  code: PrimaryLanguage;
  label: string;
}>;

export function primaryLanguageLabel(
  language: PrimaryLanguage,
  displayLanguage: AppLanguage = 'en',
): string {
  const englishLabel =
    PRIMARY_LANGUAGE_OPTIONS.find((option) => option.code === language)
      ?.label ?? language;
  if (displayLanguage === 'en') return englishLabel;

  try {
    return (
      new Intl.DisplayNames([appLocale(displayLanguage)], {
        type: 'language',
      }).of(language) ?? englishLabel
    );
  } catch {
    return englishLabel;
  }
}

export function isPrimaryLanguageSetupComplete(
  preferences: AppPreferences | null,
  preferencesLoaded: boolean,
): boolean {
  return preferencesLoaded && Boolean(preferences?.primaryLanguage);
}
