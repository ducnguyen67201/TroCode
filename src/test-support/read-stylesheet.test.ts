import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readStylesheet } from './read-stylesheet';

describe('stylesheet source reader', () => {
  const folders: string[] = [];
  function fixture() {
    const folder = mkdtempSync(join(tmpdir(), 'tro-styles-'));
    folders.push(folder);
    return folder;
  }
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true });
  });

  it.each(['\n', '\r\n'])(
    'preserves import order and declarations with %j checkout endings',
    (eol) => {
      const folder = fixture();
      writeFileSync(
        join(folder, 'entry.css'),
        `@import './base.css';${eol}@import './override.css';${eol}`,
      );
      writeFileSync(
        join(folder, 'base.css'),
        `.sample {${eol}  color: red;${eol}}${eol}`,
      );
      writeFileSync(
        join(folder, 'override.css'),
        `.sample { color: blue; }${eol}`,
      );
      expect(readStylesheet(join(folder, 'entry.css'))).toBe(
        '.sample {\n  color: red;\n}\n.sample { color: blue; }\n',
      );
    },
  );

  it('rejects a circular import instead of silently dropping styles', () => {
    const folder = fixture();
    writeFileSync(join(folder, 'entry.css'), "@import './child.css';\n");
    writeFileSync(join(folder, 'child.css'), "@import './entry.css';\n");
    expect(() => readStylesheet(join(folder, 'entry.css'))).toThrow(
      'Circular stylesheet import',
    );
  });
});
