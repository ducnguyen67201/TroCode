import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import type {
  ForgeArch,
  ForgeConfig,
  ForgePlatform,
} from '@electron-forge/shared-types';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const CUA_RUNTIME_DIRECTORY = 'cua-runtime';

function nativeCuaPackage(platform: ForgePlatform, arch: ForgeArch): string {
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new Error(`CUA packaging does not support ${platform}/${arch}.`);
  }

  if (platform === 'darwin') return `@trycua/cua-driver-darwin-${arch}`;
  if (platform === 'win32') return `@trycua/cua-driver-win32-${arch}-msvc`;
  if (platform === 'linux') return `@trycua/cua-driver-linux-${arch}-gnu`;

  throw new Error(`CUA packaging does not support ${platform}/${arch}.`);
}

async function stageCuaRuntime(
  buildPath: string,
  platform: ForgePlatform,
  arch: ForgeArch,
): Promise<void> {
  const packageNames = [
    '@trycua/cua-driver',
    '@ubjs/core',
    '@ubjs/node',
    nativeCuaPackage(platform, arch),
  ];
  const destinationRoot = path.join(
    buildPath,
    CUA_RUNTIME_DIRECTORY,
    'node_modules',
  );

  for (const packageName of packageNames) {
    const source = path.resolve(__dirname, 'node_modules', packageName);
    const destination = path.join(destinationRoot, packageName);

    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, force: true });
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    // The CUA ESM package locates its native runtime relative to import.meta.url.
    // Keep this complete dependency island outside ASAR so both the JavaScript
    // loader and native libraries resolve to real filesystem paths.
    asar: {
      unpackDir: CUA_RUNTIME_DIRECTORY,
    },
  },
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath, _version, platform, arch) => {
      await stageCuaRuntime(buildPath, platform, arch);
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload.ts',
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
