import { createHash, randomUUID } from 'node:crypto';
import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  WORK_CHECK_LIMITS,
  type ActivityContext,
  type WorkspaceIdentity,
} from '../../shared/contracts';
import type { DesktopObservation } from '../agent/execution-contracts';
import { WorkspaceEditor } from '../agent/workspace-device-adapters';

import type { KnowledgeSpaceClient } from './knowledge-space-client';
import type { WorkCheckPacket } from './work-check-policy';

const EXCLUDED = new Set([
  'node_modules',
  'build',
  'dist',
  'target',
  'venv',
  '__pycache__',
]);
const TEXT = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.xml',
  '.yaml',
  '.yml',
]);
interface Binding {
  activity: ActivityContext;
  workspace: WorkspaceIdentity | null;
}

/** Main-owned evidence readers; no model tools and no write/execute capability. */
export class WorkCheckContextService {
  private readonly bindings = new Map<string, Binding>();
  constructor(
    private readonly client: Pick<
      KnowledgeSpaceClient,
      'searchKnowledge' | 'getAttempt'
    >,
    private readonly now = () => new Date(),
    private readonly limits: {
      [K in keyof typeof WORK_CHECK_LIMITS]: number;
    } = WORK_CHECK_LIMITS,
  ) {}
  bind(
    taskId: string,
    activity: ActivityContext,
    workspace: WorkspaceIdentity | null,
  ): void {
    if (this.bindings.has(taskId))
      throw new Error('Check context already bound.');
    this.bindings.set(taskId, { activity, workspace });
  }
  release(taskId: string): void {
    this.bindings.delete(taskId);
  }
  async verify(taskId: string): Promise<void> {
    const binding = this.require(taskId);
    const latest = await this.client.getAttempt(binding.activity.attemptId);
    if (
      this.bindings.get(taskId) !== binding ||
      latest.activityVersionId !== binding.activity.activityVersionId ||
      latest.run.state !== 'open' ||
      !['assigned', 'in_progress', 'blocked'].includes(latest.state)
    )
      throw new Error('The assignment changed. Start a fresh check.');
  }
  async prepare(
    taskId: string,
    observation: DesktopObservation | null,
    signal: AbortSignal,
  ): Promise<WorkCheckPacket> {
    const binding = this.require(taskId);
    await this.verify(taskId);
    signal.throwIfAborted();
    const kind = binding.activity.activity.launchTarget;
    const packet: WorkCheckPacket = {
      taskId,
      checkId: randomUUID(),
      activity: binding.activity,
      coverage: {
        kind:
          kind === 'workspace'
            ? 'saved_files'
            : kind === 'current_surface'
              ? 'screen'
              : 'none',
        partial: false,
        notes: [],
      },
      evidence: [],
      sources: [],
    };
    const note = (text: string) => {
      packet.coverage.partial = true;
      if (packet.coverage.notes.length < 20)
        packet.coverage.notes.push(text.slice(0, 240));
    };
    if (kind === 'current_surface') {
      note(
        'Visible content only. Hidden code, other sprites and unseen pages were not checked.',
      );
      if (
        observation &&
        observation.taskId === taskId &&
        (observation.text.trim() || observation.screenshot)
      ) {
        packet.evidence.push({
          id: 'screen-1',
          kind: 'screen',
          label: (observation.surface?.application ?? 'Current screen').slice(
            0,
            255,
          ),
          capturedAt: observation.capturedAt,
          fingerprint: observation.fingerprint,
        });
        packet.sources.push({
          id: 'screen-1',
          text: observation.text.slice(0, 16_000),
        });
      } else
        note(
          'Screen context is unavailable. Show your work and allow screen access, then check again.',
        );
    } else if (kind === 'workspace' && binding.workspace) {
      const root = await realpath(binding.workspace.canonicalPath);
      if (root !== binding.workspace.canonicalPath)
        throw new Error('The selected workspace changed.');
      const editor = new WorkspaceEditor(root);
      let entries = 0,
        characters = 0,
        files = 0;
      const walk = async (directory: string, depth: number): Promise<void> => {
        signal.throwIfAborted();
        if (depth > this.limits.depth) {
          note('Some folders exceeded the discovery depth limit.');
          return;
        }
        const dir = await opendir(directory);
        const discovered = [];
        for await (const entry of dir) {
          signal.throwIfAborted();
          if (++entries > this.limits.entries) {
            note('Only a bounded selection of saved files was checked.');
            break;
          }
          discovered.push(entry);
        }
        discovered.sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        );
        for (const entry of discovered) {
          signal.throwIfAborted();
          if (
            files >= this.limits.files ||
            characters >= this.limits.totalCharacters
          ) {
            note('Only a bounded selection of saved files was checked.');
            break;
          }
          if (entry.name.startsWith('.') || EXCLUDED.has(entry.name)) continue;
          const absolute = path.join(directory, entry.name);
          const relative = path.relative(root, absolute);
          try {
            const info = await lstat(absolute);
            if (info.isSymbolicLink()) {
              note('Symbolic links were not followed.');
              continue;
            }
            const canonical = await realpath(absolute);
            if (!canonical.startsWith(root + path.sep)) {
              note('A path outside the selected folder was omitted.');
              continue;
            }
            if (info.isDirectory()) {
              if (entries >= this.limits.entries)
                note('Some folders exceeded the discovery entry limit.');
              else await walk(canonical, depth + 1);
              continue;
            }
            if (
              !info.isFile() ||
              !TEXT.has(path.extname(entry.name).toLowerCase())
            ) {
              note('Unsupported files were omitted.');
              continue;
            }
            if (info.size > this.limits.fileBytes) {
              note('An oversized file was omitted.');
              continue;
            }
            const content = await editor.readTextFile(relative);
            const after = await lstat(absolute);
            if (
              info.size !== after.size ||
              info.mtimeMs !== after.mtimeMs ||
              after.isSymbolicLink()
            ) {
              note('A file changed while it was being read.');
              continue;
            }
            const text = content.slice(
              0,
              Math.min(
                this.limits.fileCharacters,
                this.limits.totalCharacters - characters,
              ),
            );
            if (text.length < content.length)
              note('Some saved-file contents were truncated.');
            if (!text.trim()) continue;
            const id = `file-${++files}`;
            characters += text.length;
            packet.evidence.push({
              id,
              kind: 'file',
              label: relative.slice(0, 255),
              capturedAt: this.now().toISOString(),
              fingerprint: createHash('sha256').update(content).digest('hex'),
            });
            packet.sources.push({ id, text });
          } catch {
            signal.throwIfAborted();
            note('An unreadable or changing file was omitted.');
          }
        }
      };
      await walk(root, 0);
      packet.coverage.notes.unshift(
        'Saved files only. Unsaved editor changes and program execution were not checked.',
      );
    } else note('No student work context was supplied.');
    if (binding.activity.sourceCatalog.length) {
      try {
        const query = [
          binding.activity.activity.objective,
          ...binding.activity.activity.criteria.map((c) => c.title),
        ]
          .join(' ')
          .slice(0, 1000);
        const results = await this.client.searchKnowledge(
          binding.activity.attemptId,
          { query, limit: 6 },
        );
        signal.throwIfAborted();
        let remaining = this.limits.referenceCharacters;
        for (const [index, result] of results.results.entries()) {
          const text = result.snippet.slice(0, remaining);
          remaining -= text.length;
          if (!text) break;
          const id = `reference-${index + 1}`;
          packet.evidence.push({
            id,
            kind: 'reference',
            label: result.sourceTitle.slice(0, 255),
            capturedAt: this.now().toISOString(),
            fingerprint: null,
          });
          packet.sources.push({ id, text });
        }
        if (results.truncated)
          note('Reference search returned partial excerpts.');
      } catch {
        signal.throwIfAborted();
        note('Published reference passages could not be retrieved.');
      }
    }
    signal.throwIfAborted();
    if (this.bindings.get(taskId) !== binding)
      throw new Error('Check context expired.');
    if (!packet.evidence.some((e) => e.kind !== 'reference'))
      note('Student work could not be verified.');
    packet.coverage.notes = packet.coverage.notes.slice(0, 20);
    return packet;
  }
  private require(taskId: string): Binding {
    const binding = this.bindings.get(taskId);
    if (!binding) throw new Error('Check context is unavailable.');
    return binding;
  }
}
