import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SOURCE_LIMIT = 500;
export interface SourceFile {
  path: string;
  lines: number;
  test: boolean;
}

export function lineCount(source: string): number {
  if (!source) return 0;
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
}

export function isSource(path: string): boolean {
  return (
    /^(src|apps|services)\//.test(path) &&
    /\.(?:[cm]?[jt]sx?|css|scss|rs)$/.test(path) &&
    !/(?:^|\/)(?:node_modules|dist|admin-dist|target|public)\//.test(path)
  );
}

export function isTest(path: string): boolean {
  return /(?:\.test\.[^.]+$|\/tests?\/|\/test-support\/)/.test(path);
}

export function sizeViolations(
  files: readonly SourceFile[],
  baseline: Readonly<Record<string, number>>,
  previous?: Readonly<Record<string, number>>,
): string[] {
  const errors: string[] = [];
  for (const file of files) {
    if (file.test) continue;
    // New paths (including renames) cannot inherit an oversized exemption.
    const recorded = baseline[file.path] ?? SOURCE_LIMIT;
    const previousLimit = previous
      ? Math.max(SOURCE_LIMIT, previous[file.path] ?? SOURCE_LIMIT)
      : recorded;
    const limit = Math.min(recorded, previousLimit);
    if (file.lines > limit)
      errors.push(`${file.path}: ${file.lines} lines exceeds ${limit}`);
    if (recorded > previousLimit)
      errors.push(`${file.path}: baseline cannot increase`);
    if (recorded > SOURCE_LIMIT && file.lines < recorded) {
      errors.push(
        `${file.path}: lower baseline to ${Math.max(SOURCE_LIMIT, file.lines)}`,
      );
    }
  }
  const current = new Set(files.map((file) => file.path));
  for (const path of Object.keys(baseline)) {
    if (!current.has(path)) errors.push(`${path}: remove stale baseline entry`);
  }
  return errors;
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function inventory(root: string): SourceFile[] {
  const paths = git(
    root,
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  );
  return [...new Set(paths.split('\0'))]
    .filter(isSource)
    .filter((path) => existsSync(resolve(root, path)))
    .map((path) => ({
      path,
      lines: lineCount(readFileSync(resolve(root, path), 'utf8')),
      test: isTest(path),
    }))
    .sort(
      (left, right) =>
        right.lines - left.lines || left.path.localeCompare(right.path),
    );
}

function baseInventory(root: string, ref: string): Record<string, number> {
  if (!/^[a-f0-9]{40}$/.test(ref))
    throw new Error('Expected full base commit SHA');
  const paths = git(root, 'ls-tree', '-r', '--name-only', '-z', ref)
    .split('\0')
    .filter(isSource);
  return Object.fromEntries(
    paths.map((path) => [path, lineCount(git(root, 'show', `${ref}:${path}`))]),
  );
}

export function run(root = process.cwd(), report = false): void {
  const files = inventory(root);
  if (report) {
    console.log(JSON.stringify(files, null, 2));
    return;
  }
  const baseline = JSON.parse(
    readFileSync(resolve(root, 'scripts/source-size-baseline.json'), 'utf8'),
  ) as Record<string, number>;
  let previous: Record<string, number> | undefined;
  if (process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'),
    ) as {
      before?: string;
      pull_request?: { base: { sha: string } };
      merge_group?: { base_sha: string };
    };
    const ref =
      event.pull_request?.base.sha ??
      event.merge_group?.base_sha ??
      event.before;
    if (ref && !/^0+$/.test(ref)) previous = baseInventory(root, ref);
  }
  const errors = sizeViolations(files, baseline, previous);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    `Source size policy passed (${files.filter((file) => !file.test).length} production files).`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  run(process.cwd(), process.argv.includes('--report'));
}
