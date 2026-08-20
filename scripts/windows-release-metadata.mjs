import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { NtExecutable, NtExecutableResource, Resource } from 'resedit';

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const PRODUCT_NAME = 'Tro';

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);
  if (!match) {
    throw new Error(`Invalid release version: ${version}`);
  }

  const numericVersion = match.slice(1, 4).map((part) => Number(part));
  if (numericVersion.some((part) => part > 65_535)) {
    throw new Error('Windows version components must be at most 65535.');
  }
  return numericVersion;
}

function metadataFor(kind, fileName, version) {
  if (kind !== 'app' && kind !== 'installer') {
    throw new Error(`Unsupported Windows artifact kind: ${kind}`);
  }

  return {
    CompanyName: PRODUCT_NAME,
    FileDescription: kind === 'app' ? PRODUCT_NAME : `${PRODUCT_NAME} Installer`,
    FileVersion: version,
    InternalName: kind === 'app' ? PRODUCT_NAME : `${PRODUCT_NAME} Setup`,
    LegalCopyright: `Copyright © ${new Date().getUTCFullYear()} Tro contributors`,
    OriginalFilename: fileName,
    ProductName: PRODUCT_NAME,
    ProductVersion: version,
  };
}

function parseExecutable(data) {
  const executable = NtExecutable.from(data);
  const resources = NtExecutableResource.from(executable);
  const versionInfos = Resource.VersionInfo.fromEntries(resources.entries);
  if (versionInfos.length !== 1) {
    throw new Error(
      `Expected one Windows version resource, received ${versionInfos.length}.`,
    );
  }

  return { executable, resources, versionInfo: versionInfos[0] };
}

export async function readWindowsMetadata(filePath) {
  const { versionInfo } = parseExecutable(await readFile(filePath));
  const languages = versionInfo.getAllLanguagesForStringValues();
  if (languages.length !== 1) {
    throw new Error(
      `Expected one Windows metadata language, received ${languages.length}.`,
    );
  }
  return versionInfo.getStringValues(languages[0]);
}

export async function stampWindowsExecutable({ filePath, kind, version }) {
  const numericVersion = parseVersion(version);
  const data = await readFile(filePath);
  const { executable, resources, versionInfo } = parseExecutable(data);
  const languages = versionInfo.getAllLanguagesForStringValues();
  if (languages.length !== 1) {
    throw new Error(
      `Expected one Windows metadata language, received ${languages.length}.`,
    );
  }

  versionInfo.setFileVersion(...numericVersion);
  versionInfo.setProductVersion(...numericVersion);
  versionInfo.setStringValues(
    languages[0],
    metadataFor(kind, path.basename(filePath), version),
  );
  versionInfo.outputToResourceEntries(resources.entries);
  resources.outputResource(executable);
  await writeFile(filePath, Buffer.from(executable.generate()));

  return readWindowsMetadata(filePath);
}

function optionValue(argumentsList, name) {
  const index = argumentsList.indexOf(name);
  if (index === -1 || !argumentsList[index + 1]) {
    throw new Error(`Missing required option: ${name}`);
  }
  return argumentsList[index + 1];
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const filePath = path.resolve(optionValue(argumentsList, '--file'));
  const kind = optionValue(argumentsList, '--kind');
  const version = optionValue(argumentsList, '--version');
  const metadata = await stampWindowsExecutable({ filePath, kind, version });
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
