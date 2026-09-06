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
  expect(keys).toHaveLength(1075);
  const entries = JSON.stringify(
    keys.map((key) => [key, translate('vi', key)]),
  );
  expect(createHash('sha256').update(entries).digest('hex')).toBe(
    '111f3e7fb6cda13ac3b78c248508c33267c7522650211868bf44609e6e6ef2c5',
  );
});
