import type { Configuration } from 'webpack';

import { plugins } from './webpack.plugins';
import { rules } from './webpack.rules';

rules.push({
  test: /\.css$/,
  use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
});

rules.push({
  test: /\.(png|jpe?g|webp)$/i,
  type: 'asset/resource',
});

rules.push({
  test: /\.worklet\.js$/i,
  type: 'asset/resource',
});

export const rendererConfig: Configuration = {
  // Keep the strict renderer CSP valid in development. Electron Forge defaults
  // to eval-source-map, which requires unsafe-eval and leaves the window blank.
  devtool: 'source-map',
  module: {
    rules,
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
  },
};
