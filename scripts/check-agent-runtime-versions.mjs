import { readFile } from 'node:fs/promises';
import path from 'node:path';

const EXPECTED = Object.freeze({
  '@openai/agents': '0.16.1',
  openai: '7.5.0',
  zod: '4.4.3',
});

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));

for (const [name, expected] of Object.entries(EXPECTED)) {
  const declared = packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name];
  const installed = lock.packages?.[`node_modules/${name}`]?.version;
  if (declared !== expected || installed !== expected) {
    throw new Error(
      `${name} must remain pinned to ${expected}; declared=${String(declared)}, locked=${String(installed)}.`,
    );
  }
}

console.log('Agent runtime versions match the supported compatibility baseline.');
