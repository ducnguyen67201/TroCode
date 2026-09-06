import { createHash } from 'node:crypto';

import { expect, it } from 'vitest';

import { translate } from '../app-language';

import {
  CLASSROOM_VIETNAMESE_TRANSLATIONS,
  VIETNAMESE_TRANSLATIONS,
} from './vi/messages';

it('preserves all original Vietnamese messages and dictionary precedence', () => {
  const keys = [
    ...new Set([
      ...Object.keys(VIETNAMESE_TRANSLATIONS),
      ...Object.keys(CLASSROOM_VIETNAMESE_TRANSLATIONS),
    ]),
  ].sort();
  expect(keys).toHaveLength(1008);
  const entries = JSON.stringify(
    keys.map((key) => [key, translate('vi', key)]),
  );
  expect(createHash('sha256').update(entries).digest('hex')).toBe(
    '34037d910cc3eb90700b3c6fd3081b73635b1517386ce700b910af0db1c6208e',
  );
});
