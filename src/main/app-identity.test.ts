import { describe, expect, it } from 'vitest';

import {
  TROCODE_APP_BUNDLE_ID,
  TROCODE_EXECUTABLE_NAME,
  TROCODE_HELPER_BUNDLE_ID,
} from './app-identity';

describe('Tro application identity', () => {
  it('uses stable, product-owned macOS bundle identifiers', () => {
    expect(TROCODE_APP_BUNDLE_ID).toBe('com.trocode.desktop');
    expect(TROCODE_HELPER_BUNDLE_ID).toBe('com.trocode.desktop.helper');
    expect(TROCODE_EXECUTABLE_NAME).toBe('Tro');
    expect(TROCODE_APP_BUNDLE_ID).not.toContain('electron');
  });
});
