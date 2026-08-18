import { z } from 'zod';

const GitHubReleaseSchema = z.object({
  assets: z.array(
    z.object({
      name: z.string().trim().min(1).max(500),
    }),
  ),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
  tag_name: z.string().trim().min(1).max(200),
});

const GitHubReleasesSchema = z.array(GitHubReleaseSchema).max(100);

type NumericVersion = readonly [number, number, number, number];

export interface WindowsUpdateRelease {
  feedUrl: string;
  targetVersion: string;
}

interface ResolveWindowsUpdateReleaseOptions {
  currentVersion: string;
  repository: string;
  request?: typeof fetch;
}

function numericVersion(value: string): NumericVersion | null {
  const match = value
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/i);
  if (!match) return null;

  const parts = [match[1], match[2], match[3], match[4] ?? '0'].map(
    (part) => Number(part),
  );
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts as unknown as NumericVersion;
}

function compareVersions(left: NumericVersion, right: NumericVersion): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function displayVersion(version: NumericVersion): string {
  return version[3] === 0
    ? `${version[0]}.${version[1]}.${version[2]}`
    : version.join('.');
}

function hasSquirrelWindowsFeed(assets: ReadonlyArray<{ name: string }>): boolean {
  const names = assets.map((asset) => asset.name.toLowerCase());
  return (
    names.includes('releases') &&
    names.some((name) => name.endsWith('-full.nupkg'))
  );
}

export async function resolveWindowsUpdateRelease({
  currentVersion,
  repository,
  request = fetch,
}: ResolveWindowsUpdateReleaseOptions): Promise<WindowsUpdateRelease | null> {
  const installedVersion = numericVersion(currentVersion);
  if (!installedVersion) {
    throw new Error('The installed application version is not update-compatible.');
  }

  const [owner, name, unexpectedPart] = repository.split('/');
  if (!owner || !name || unexpectedPart) {
    throw new Error('The update repository must use the GitHub owner/name format.');
  }
  const response = await request(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/releases?per_page=50`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`The release service returned HTTP ${response.status}.`);
  }

  const releases = GitHubReleasesSchema.parse(await response.json());
  const candidates = releases
    .filter((release) => !release.draft && hasSquirrelWindowsFeed(release.assets))
    .map((release) => ({
      release,
      version: numericVersion(release.tag_name),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        release: z.infer<typeof GitHubReleaseSchema>;
        version: NumericVersion;
      } =>
        candidate.version !== null &&
        compareVersions(candidate.version, installedVersion) > 0,
    )
    .sort((left, right) => {
      const versionOrder = compareVersions(right.version, left.version);
      if (versionOrder !== 0) return versionOrder;
      if (left.release.prerelease !== right.release.prerelease) {
        return left.release.prerelease ? 1 : -1;
      }
      return (right.release.published_at ?? '').localeCompare(
        left.release.published_at ?? '',
      );
    });

  const latest = candidates[0];
  if (!latest) return null;

  return {
    feedUrl: `https://github.com/${owner}/${name}/releases/download/${encodeURIComponent(latest.release.tag_name)}`,
    targetVersion: displayVersion(latest.version),
  };
}
