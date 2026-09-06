import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Expand our ordered local CSS entrypoints for source-level style assertions. */
export function readStylesheet(
  file: string,
  ancestors = new Set<string>(),
): string {
  const absolute = resolve(file);
  if (ancestors.has(absolute))
    throw new Error(`Circular stylesheet import: ${absolute}`);
  const chain = new Set(ancestors).add(absolute);
  return readFileSync(absolute, 'utf8').replace(
    /@import\s+['"]([^'"]+)['"];\r?\n?/g,
    (_match, imported: string) =>
      readStylesheet(resolve(dirname(absolute), imported), chain),
  );
}
