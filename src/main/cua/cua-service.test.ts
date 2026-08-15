import { describe, expect, it } from 'vitest';

import { getCuaModuleSpecifier } from './cua-service';

describe('getCuaModuleSpecifier', () => {
  it('uses the installed package during development', () => {
    expect(getCuaModuleSpecifier(false, '/unused')).toBe('@trycua/cua-driver');
  });

  it('loads the unpacked dependency island in a packaged app', () => {
    const moduleUrl = getCuaModuleSpecifier(true, '/Applications/TroCode/Resources');

    expect(moduleUrl).toBe(
      'file:///Applications/TroCode/Resources/app.asar.unpacked/cua-runtime/node_modules/@trycua/cua-driver/dist/index.js',
    );
  });
});
