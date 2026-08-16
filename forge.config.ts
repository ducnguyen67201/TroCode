import { execFile } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

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

import { MACOS_VISION_OCR_HELPER_NAME } from './src/main/agent/macos-vision-grounder';
import {
  TROCODE_APP_BUNDLE_ID,
  TROCODE_EXECUTABLE_NAME,
  TROCODE_HELPER_BUNDLE_ID,
} from './src/main/app-identity';
import { MACOS_VOICE_SHORTCUT_HELPER_NAME } from './src/main/voice/macos-voice-shortcut-watcher';
import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const CUA_RUNTIME_DIRECTORY = 'cua-runtime';
const APP_ICON_BASENAME = path.resolve(
  __dirname,
  'src/assets/trocode-app-icon',
);
const APP_ICON_PNG = `${APP_ICON_BASENAME}.png`;
const APP_ICON_ICO = `${APP_ICON_BASENAME}.ico`;
const MACOS_SIGNING_IDENTITY = process.env.TROCODE_MACOS_SIGNING_IDENTITY?.trim();
const executeFile = promisify(execFile);
const MACOS_VOICE_SHORTCUT_SOURCE = path.resolve(
  __dirname,
  'native/macos-global-voice-shortcut.swift',
);
const MACOS_VOICE_SHORTCUT_BINARY = path.resolve(
  __dirname,
  '.generated-native',
  MACOS_VOICE_SHORTCUT_HELPER_NAME,
);
const MACOS_VISION_OCR_SOURCE = path.resolve(
  __dirname,
  'native/macos-vision-ocr.swift',
);
const MACOS_VISION_OCR_BINARY = path.resolve(
  __dirname,
  '.generated-native',
  MACOS_VISION_OCR_HELPER_NAME,
);

async function compileMacOSNativeHelpers(
  platform: ForgePlatform,
  arch: ForgeArch,
): Promise<void> {
  if (platform !== 'darwin') return;
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new Error(`macOS voice shortcut helper does not support ${arch}.`);
  }

  await mkdir(path.dirname(MACOS_VOICE_SHORTCUT_BINARY), { recursive: true });
  const targetArchitecture = arch === 'x64' ? 'x86_64' : 'arm64';
  for (const [source, binary] of [
    [MACOS_VOICE_SHORTCUT_SOURCE, MACOS_VOICE_SHORTCUT_BINARY],
    [MACOS_VISION_OCR_SOURCE, MACOS_VISION_OCR_BINARY],
  ]) {
    await executeFile('xcrun', [
      'swiftc',
      '-O',
      '-target',
      `${targetArchitecture}-apple-macosx13.0`,
      source,
      '-o',
      binary,
    ]);
  }
}

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
    appBundleId: TROCODE_APP_BUNDLE_ID,
    executableName: TROCODE_EXECUTABLE_NAME,
    extraResource: [
      APP_ICON_PNG,
      ...(process.platform === 'darwin'
        ? [MACOS_VOICE_SHORTCUT_BINARY, MACOS_VISION_OCR_BINARY]
        : []),
    ],
    helperBundleId: TROCODE_HELPER_BUNDLE_ID,
    icon: APP_ICON_BASENAME,
    osxSign:
      process.platform === 'darwin'
        ? {
            identity: MACOS_SIGNING_IDENTITY || '-',
            identityValidation: Boolean(MACOS_SIGNING_IDENTITY),
            optionsForFile: () => ({
              hardenedRuntime: Boolean(MACOS_SIGNING_IDENTITY),
            }),
          }
        : undefined,
    // The CUA ESM package locates its native runtime relative to import.meta.url.
    // Keep this complete dependency island outside ASAR so both the JavaScript
    // loader and native libraries resolve to real filesystem paths.
    asar: {
      unpackDir: CUA_RUNTIME_DIRECTORY,
    },
    extendInfo: {
      NSMicrophoneUsageDescription:
        'TroCode uses the microphone only during a voice turn started with a voice shortcut.',
    },
  },
  hooks: {
    generateAssets: async (_forgeConfig, platform, arch) => {
      await compileMacOSNativeHelpers(platform, arch);
    },
    packageAfterCopy: async (_forgeConfig, buildPath, _version, platform, arch) => {
      await stageCuaRuntime(buildPath, platform, arch);
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ setupIcon: APP_ICON_ICO }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      devContentSecurityPolicy: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' data:",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self' https://api.openai.com ws://localhost:* http://localhost:*",
      ].join('; '),
      loggerPort: 9100,
      mainConfig,
      port: 3010,
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
          {
            html: './src/screen-recording-registration.html',
            js: './src/screen-recording-registration-renderer.ts',
            name: 'screen_recording',
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
