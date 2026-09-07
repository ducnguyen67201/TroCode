import { createHash } from 'node:crypto';

import { expect, it } from 'vitest';

import { translate } from '../app-language';

import {
  CLASSROOM_VIETNAMESE_TRANSLATIONS,
  VIETNAMESE_TRANSLATIONS,
} from './vi/messages';

it('preserves the reviewed Vietnamese messages and dictionary precedence', () => {
  const keys = [
    ...new Set([
      ...Object.keys(VIETNAMESE_TRANSLATIONS),
      ...Object.keys(CLASSROOM_VIETNAMESE_TRANSLATIONS),
    ]),
  ].sort();
  expect(keys).toHaveLength(1079);
  const entries = JSON.stringify(
    keys.map((key) => [key, translate('vi', key)]),
  );
  expect(createHash('sha256').update(entries).digest('hex')).toBe(
    '2873a9591c5a003d7073a819170a9415bc66ddc7f6dd9c9c1330a82d53bc0bf4',
  );
});
