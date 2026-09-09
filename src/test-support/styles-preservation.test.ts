import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readStylesheet } from './read-stylesheet';

describe('ordered stylesheet migration', () => {
  it('preserves every desktop rule, declaration and override in source order', () => {
    const css = readStylesheet(resolve(__dirname, '../index.css')).replace(
      /^\/\* Keep this order:[^\n]*\n/,
      '',
    );
    // Reviewed class identity spacing, title size, and wrapping update.
    expect(createHash('sha256').update(css).digest('hex')).toBe(
      '376dcb1a31c77727735b06e6b71a9f687107cba189086d83a0be515ccbdaef07',
    );
  });
  it('preserves every admin rule, declaration and override in source order', () => {
    const css = readStylesheet(
      resolve(__dirname, '../../apps/admin/src/styles.css'),
    ).replace(/^\/\* Keep this order:[^\n]*\n/, '');
    expect(createHash('sha256').update(css).digest('hex')).toBe(
      '9d22b39e310b71ccda6f7114deba8997ce2ba8c43b475621baef4b911c2a8a8d',
    );
  });
});
