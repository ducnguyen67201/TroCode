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
    expect(createHash('sha256').update(css).digest('hex')).toBe(
      '8149df21590aaeb69f256ed2bde6eac23853f6446d0baf1a91b2893b5994d323',
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
