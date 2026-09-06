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
  expect(keys).toHaveLength(1076);
  const entries = JSON.stringify(
    keys.map((key) => [key, translate('vi', key)]),
  );
  expect(createHash('sha256').update(entries).digest('hex')).toBe(
    '523c12920945281291689c0d8f0e971af847c7e8e35a06cf78e517da67e7423c',
  );
});
