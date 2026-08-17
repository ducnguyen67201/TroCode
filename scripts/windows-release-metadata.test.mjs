import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  readWindowsMetadata,
  stampWindowsExecutable,
} from './windows-release-metadata.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const squirrelSetup = path.join(
  repositoryRoot,
  'node_modules',
  'electron-winstaller',
  'vendor',
  'Setup.exe',
);

test('stamps the Squirrel installer with constrained TroCode metadata', async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'trocode-windows-metadata-'),
  );
  const installer = path.join(temporaryDirectory, 'TroCode-0.1.0 Setup.exe');

  try {
    await copyFile(squirrelSetup, installer);
    await stampWindowsExecutable({
      filePath: installer,
      kind: 'installer',
      version: '0.1.0',
    });

    const metadata = await readWindowsMetadata(installer);
    assert.deepEqual(
      {
        CompanyName: metadata.CompanyName,
        FileDescription: metadata.FileDescription,
        FileVersion: metadata.FileVersion,
        InternalName: metadata.InternalName,
        OriginalFilename: metadata.OriginalFilename,
        ProductName: metadata.ProductName,
        ProductVersion: metadata.ProductVersion,
      },
      {
        CompanyName: 'TroCode',
        FileDescription: 'TroCode Installer',
        FileVersion: '0.1.0',
        InternalName: 'TroCode Setup',
        OriginalFilename: 'TroCode-0.1.0 Setup.exe',
        ProductName: 'TroCode',
        ProductVersion: '0.1.0',
      },
    );
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});

test('rejects non-semantic or out-of-range Windows versions', async () => {
  await assert.rejects(
    stampWindowsExecutable({
      filePath: squirrelSetup,
      kind: 'installer',
      version: 'not-a-version',
    }),
    /Invalid release version/,
  );
  await assert.rejects(
    stampWindowsExecutable({
      filePath: squirrelSetup,
      kind: 'installer',
      version: '70000.0.0',
    }),
    /at most 65535/,
  );
});
