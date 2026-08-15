import { describe, expect, it } from 'vitest';

import { PrimaryLanguageSchema } from '../shared/contracts';

import {
  PRIMARY_LANGUAGE_OPTIONS,
  isPrimaryLanguageSetupComplete,
  primaryLanguageLabel,
} from './language-options';

describe('primary language options', () => {
  it('only exposes language codes accepted by the shared contract', () => {
    expect(
      PRIMARY_LANGUAGE_OPTIONS.every((option) =>
        PrimaryLanguageSchema.safeParse(option.code).success,
      ),
    ).toBe(true);
  });

  it('labels the onboarding defaults clearly', () => {
    expect(primaryLanguageLabel('en')).toBe('English');
    expect(primaryLanguageLabel('vi')).toBe('Vietnamese');
  });

  it('requires a persisted language before onboarding completes', () => {
    expect(isPrimaryLanguageSetupComplete(null, false)).toBe(false);
    expect(
      isPrimaryLanguageSetupComplete({ primaryLanguage: null }, true),
    ).toBe(false);
    expect(
      isPrimaryLanguageSetupComplete({ primaryLanguage: 'en' }, true),
    ).toBe(true);
  });
});
