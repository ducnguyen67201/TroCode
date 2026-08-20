import { describe, expect, it, vi } from 'vitest';

import { resolveWindowsUpdateRelease } from './github-release-update-source';

function release(
  tagName: string,
  options: {
    assets?: string[];
    draft?: boolean;
    prerelease?: boolean;
    publishedAt?: string;
  } = {},
) {
  return {
    assets: (options.assets ?? ['RELEASES', 'trocode-full.nupkg']).map(
      (name) => ({ name }),
    ),
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false,
    published_at: options.publishedAt ?? '2026-08-18T12:00:00Z',
    tag_name: tagName,
  };
}

function requestWith(releases: unknown[]) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(releases), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
  ) as unknown as typeof fetch;
}

describe('resolveWindowsUpdateRelease', () => {
  it('selects a newer prerelease when it contains a Squirrel feed', async () => {
    const request = requestWith([
      release('v0.1.3-signpath-bootstrap.8', { prerelease: true }),
      release('v0.1.2-signpath-bootstrap.7', { prerelease: true }),
    ]);

    await expect(
      resolveWindowsUpdateRelease({
        currentVersion: '0.1.1',
        repository: 'ducnguyen67201/TroCode',
        request,
      }),
    ).resolves.toEqual({
      feedUrl:
        'https://github.com/ducnguyen67201/TroCode/releases/download/v0.1.3-signpath-bootstrap.8',
      targetVersion: '0.1.3',
    });
  });

  it('skips draft, incomplete, and older releases', async () => {
    const request = requestWith([
      release('v0.2.0', { draft: true }),
      release('v0.1.5', { assets: ['TroSetup.exe'] }),
      release('v0.1.1'),
    ]);

    await expect(
      resolveWindowsUpdateRelease({
        currentVersion: '0.1.1',
        repository: 'ducnguyen67201/TroCode',
        request,
      }),
    ).resolves.toBeNull();
  });

  it('reports release-service failures without leaking a response body', async () => {
    const request = vi.fn(
      async () => new Response('private details', { status: 503 }),
    ) as unknown as typeof fetch;

    await expect(
      resolveWindowsUpdateRelease({
        currentVersion: '0.1.1',
        repository: 'ducnguyen67201/TroCode',
        request,
      }),
    ).rejects.toThrow('HTTP 503');
  });
});
