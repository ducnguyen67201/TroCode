import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SUPPORTED_VERSION = '0.146.0';
const SELECTED_BINDINGS = [
  'ClientNotification.ts',
  'InitializeParams.ts',
  'InitializeResponse.ts',
  'ServerNotification.ts',
  'ServerRequest.ts',
  'v2/AgentMessageDeltaNotification.ts',
  'v2/CommandExecutionRequestApprovalParams.ts',
  'v2/FileChangeRequestApprovalParams.ts',
  'v2/ItemCompletedNotification.ts',
  'v2/ItemStartedNotification.ts',
  'v2/PermissionsRequestApprovalParams.ts',
  'v2/ThreadStartParams.ts',
  'v2/ThreadStartResponse.ts',
  'v2/ToolRequestUserInputParams.ts',
  'v2/TurnCompletedNotification.ts',
  'v2/TurnPlanUpdatedNotification.ts',
  'v2/TurnStartParams.ts',
  'v2/TurnStartResponse.ts',
  'v2/TurnSteerParams.ts',
  'v2/TurnSteerResponse.ts',
];

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${executable} exited with ${String(code)}.`));
    });
  });
}

const executable = process.env.TROCODE_CODEX_PATH?.trim() || 'codex';
const versionOutput = await run(executable, ['--version']);
const version = /(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/u.exec(versionOutput)?.[1];
if (version !== SUPPORTED_VERSION) {
  throw new Error(`Codex ${SUPPORTED_VERSION} is required to generate protocol bindings; found ${version ?? 'unknown'}.`);
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'trocode-codex-bindings-'));
try {
  await run(executable, [
    'app-server',
    'generate-ts',
    '--experimental',
    '--out',
    temporaryDirectory,
  ]);
  const bindings = {};
  for (const relativePath of SELECTED_BINDINGS) {
    const source = await readFile(path.join(temporaryDirectory, relativePath), 'utf8');
    bindings[relativePath] = createHash('sha256').update(source).digest('hex');
  }
  const output = `${JSON.stringify({ bindings, codexVersion: version }, null, 2)}\n`;
  const target = path.join(
    process.cwd(),
    'src/main/codex/generated/protocol-manifest.json',
  );
  if (process.argv.includes('--check')) {
    const current = await readFile(target, 'utf8').catch(() => '');
    if (current !== output) {
      throw new Error('Committed Codex app-server bindings do not match the supported CLI.');
    }
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, output, 'utf8');
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log(`Codex app-server protocol bindings match ${SUPPORTED_VERSION}.`);
