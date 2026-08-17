import path from 'node:path';

import { config as loadEnvironment } from 'dotenv';
import { DefinePlugin, type Configuration } from 'webpack';

import { plugins } from './webpack.plugins';
import { rules } from './webpack.rules';

loadEnvironment({
  path: [
    path.resolve(__dirname, '.env.local'),
    path.resolve(__dirname, '.env'),
  ],
  quiet: true,
});

export const mainConfig: Configuration = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/index.ts',
  // Put your normal webpack config below here
  module: {
    rules,
  },
  plugins: [
    ...plugins,
    new DefinePlugin({
      'process.env.GOOGLE_OAUTH_CLIENT_ID': JSON.stringify(
        process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      ),
      'process.env.GOOGLE_OAUTH_CLIENT_SECRET': JSON.stringify(
        process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      ),
      'process.env.POSTHOG_ENVIRONMENT': JSON.stringify(
        process.env.POSTHOG_ENVIRONMENT ?? '',
      ),
      'process.env.POSTHOG_HOST': JSON.stringify(
        process.env.POSTHOG_HOST ?? '',
      ),
      'process.env.POSTHOG_PROJECT_TOKEN': JSON.stringify(
        process.env.POSTHOG_PROJECT_TOKEN ?? '',
      ),
      'process.env.TROCODE_MEMBERSHIP_PUBLIC_KEY': JSON.stringify(
        process.env.TROCODE_MEMBERSHIP_PUBLIC_KEY ?? '',
      ),
      'process.env.TROCODE_API_BASE_URL': JSON.stringify(
        process.env.TROCODE_API_BASE_URL ?? '',
      ),
    }),
  ],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
};
