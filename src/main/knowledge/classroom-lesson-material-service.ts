import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import type { LessonFile, LessonLocalState } from '../../shared/classroom-lesson-contracts';
import type { ToolExecutionResult } from '../agent/agent-contracts';
import { AsyncOperationTracker, type AsyncOperation } from '../agent/async-operation-tracker';

import type { ClassroomLessonClient } from './classroom-lesson-client';
import { LessonBlockedError } from './classroom-lesson-errors';
import { safeMaterialName } from './classroom-lesson-material-policy';
import type { ClassroomLessonStateStore } from './classroom-lesson-state-store';
import type { ClassroomLessonSurfaceService } from './classroom-lesson-surface-service';

/** Download tickets and native paths stay in main; the renderer selects a lesson resource. */
export class ClassroomLessonMaterialService {
  private readonly operations = new AsyncOperationTracker();
  constructor(private readonly options: {
    directory: string;
    client: Pick<ClassroomLessonClient, 'file'>;
    store: Pick<ClassroomLessonStateStore, 'readNativeMaterial' | 'saveNativeMaterial' | 'readResourceOperation' | 'saveResourceOperation'>;
    surfaces: Pick<ClassroomLessonSurfaceService, 'selectFileTitle' | 'restoreFileTitle'>;
    chooseFile?(): Promise<string | null>;
    validateSelection?(state: LessonLocalState, revision: number): Promise<void>;
    openPath(value: string): Promise<string>;
    openUrl(value: string): Promise<void>;
    markEffect(effect: LessonLocalState['effect']): Promise<void>;
    authorize(): Promise<void>;
    consume(kind: 'action' | 'observation'): Promise<void>;
    fetchImpl?: typeof fetch;
  }) {}

  private operationStorage(state: LessonLocalState, handle: string) {
    const { ownerId } = state;
    const lessonId = state.envelope.lessonId;
    return {
      read: () => this.options.store.readResourceOperation(ownerId, lessonId, handle),
      save: (record: AsyncOperation) => this.options.store.saveResourceOperation(ownerId, lessonId, handle, record),
    };
  }
  private operationKey(state: LessonLocalState, handle: string) {
    return `${state.ownerId}:${state.envelope.lessonId}:${handle}`;
  }
  resourceOperation(state: LessonLocalState) {
    const handle = state.envelope.plan.steps[state.stepIndex]!.resourceId;
    return this.operations.read(this.operationKey(state, handle), this.operationStorage(state, handle));
  }

  async prepare(state: LessonLocalState, signal: AbortSignal) {
    await this.options.authorize();
    signal.throwIfAborted();
    const resource = state.envelope.plan.resources.find((item) => item.id === state.envelope.plan.steps[state.stepIndex]?.resourceId);
    if (!resource) throw new LessonBlockedError('resource_unavailable', 'Lesson resource is unavailable.');
    const previous = await this.options.store.readNativeMaterial(state.ownerId, state.envelope.lessonId, resource.id);
    if (previous && resource.kind !== 'web') this.options.surfaces.restoreFileTitle(state, path.basename(previous.path));
    if (previous?.legacyOutcomeUnknown) { await this.options.markEffect('unknown'); throw new Error('The earlier opening is uncertain. Inspect the material before accepting a new lesson.'); }
    if (previous) return;
    if (resource.kind === 'current_screen' || resource.kind === 'assignment') return;
    let target: string, sha256 = '';
    if (resource.kind === 'source_text') {
      const file = await this.options.client.file(state.anchorAttemptId, state.envelope.lessonId, resource.id, signal);
      if (file.sourceVersionId !== resource.sourceVersionId)
        throw new LessonBlockedError('resource_unavailable', 'The file does not match the reviewed source version.');
      try { target = await this.download(state.ownerId, file, signal); }
      catch (error) {
        signal.throwIfAborted();
        throw new LessonBlockedError('resource_unavailable', error instanceof Error && !('code' in error) ? error.message : 'Could not prepare the lesson material cache.');
      }
      sha256 = file.sha256;
      this.options.surfaces.selectFileTitle(state, path.basename(target));
    } else if (resource.kind === 'web') target = resource.url;
    else throw new LessonBlockedError('resource_unavailable', 'Select a class file or website to open.');
    signal.throwIfAborted();
    await this.options.store.saveNativeMaterial(state.ownerId, state.envelope.lessonId, resource.id, { version: 2, path: target, sha256, legacyOutcomeUnknown: false });
  }

  /** Called only through the journaled tool dispatcher. OS acceptance is not document verification. */
  async openResource(state: LessonLocalState, handle: string, signal: AbortSignal): Promise<ToolExecutionResult> {
    if (state.effect === 'unknown' || state.effect === 'dispatching')
      return { status: 'unknown', summary: 'A prior action has an unresolved outcome. Opening will not be dispatched.' };
    const resource = state.envelope.plan.resources.find((item) => item.id === state.envelope.plan.steps[state.stepIndex]?.resourceId);
    if (!resource || handle !== resource.id) return { status: 'denied', summary: 'The resource is outside the current lesson step.' };
    await this.options.authorize();
    signal.throwIfAborted();
    const previous = await this.options.store.readNativeMaterial(state.ownerId, state.envelope.lessonId, resource.id);
    if (!previous) return { status: 'not_executed', summary: 'This resource has no prepared file. Observe its current window or ask the student to select the material.' };
    if (previous.legacyOutcomeUnknown) return { status: 'unknown', summary: 'The earlier opening has an unknown outcome and will not be repeated.' };
    const { path: target, sha256 } = previous;
    if (resource.kind !== 'web' || target !== resource.url) {
      try {
        const info = await lstat(target);
        if (!info.isFile() || info.isSymbolicLink())
          return { status: 'not_executed', summary: 'The prepared resource is no longer a regular file. Select the material again.' };
        if (sha256 && createHash('sha256').update(await readFile(target)).digest('hex') !== sha256)
          return { status: 'not_executed', summary: 'The prepared file has changed. It was preserved; select its window to continue.' };
      } catch {
        return { status: 'not_executed', summary: 'The prepared file is unavailable. Select the material again.' };
      }
    }
    const operation = await this.operations.start(this.operationKey(state, handle), this.operationStorage(state, handle), async () => {
      await this.options.authorize();
      signal.throwIfAborted();
      await this.options.consume('action');
      signal.throwIfAborted();
    }, () => {
      signal.throwIfAborted();
      return resource.kind === 'web' && target === resource.url
        ? this.options.openUrl(target) : this.options.openPath(target);
    });
    return {
      status: operation.status === 'unknown' ? 'unknown' : operation.status === 'failed' ? 'failed' : 'confirmed',
      summary: operation.status === 'pending'
        ? 'Opening was requested once and is pending. Observe the screen and use shared controls to finish any application UI. Do not wait or reopen the resource. Verify the document before teaching.'
        : operation.status === 'completed'
          ? 'The OS accepted the existing opening request. Observe and verify the requested document before teaching.'
          : operation.status === 'failed' ? 'The OS rejected the opening request. It was not repeated.'
            : 'The existing opening has an unknown outcome and was not repeated. Inspect the screen before requesting new work.',
      data: { operation },
    };
  }

  async chooseLocal(state: LessonLocalState) {
    const revision = state.revision;
    const selected = await this.options.chooseFile?.();
    if (!selected) return;
    const info = await lstat(selected).catch(() => { throw new Error('The selected file is unavailable. Choose it again or select its open window.'); });
    if (!info.isFile() || info.isSymbolicLink() || !['.pdf', '.txt', '.md', '.png', '.jpg', '.jpeg', '.docx', '.pptx', '.xlsx'].includes(path.extname(selected).toLowerCase()))
      throw new Error('Choose a document file, or open this format yourself and select its window.');
    if (!this.options.validateSelection) throw new Error('File selection is unavailable.');
    await this.options.validateSelection(state, revision);
    await this.options.store.saveNativeMaterial(state.ownerId, state.envelope.lessonId, state.envelope.plan.steps[state.stepIndex]!.resourceId, { version: 2, path: selected, sha256: '', legacyOutcomeUnknown: false });
  }

  private async download(owner: string, file: LessonFile, signal: AbortSignal): Promise<string> {
    const name = safeMaterialName(file.name, file.mediaType);
    const root = path.join(this.options.directory, createHash('sha256').update(owner).digest('hex'));
    await mkdir(root, { recursive: true, mode: 0o700 });
    const folder = path.join(root, `${file.sourceVersionId}-${file.sha256}`);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink() || (await lstat(folder)).isSymbolicLink()) throw new Error('Material cache is unavailable.');
    const destination = path.join(folder, name);
    try {
      const info = await lstat(destination);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Material cache is unavailable.');
      if (info.size === file.byteSize && createHash('sha256').update(await readFile(destination)).digest('hex') === file.sha256) {
        return destination;
      }
      throw new Error('This cached material has changed. Open it yourself and choose its window; Tro will preserve your file.');
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    const url = new URL(file.download.url);
    if (url.protocol !== 'https:') throw new Error('Material downloads require HTTPS.');
    const partial = path.join(folder, `.${randomUUID()}.partial`);
    const handle = await open(partial, 'wx', 0o600);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
      if (!response.ok || !response.body) throw new Error('Material download is unavailable.');
      const reader = response.body.getReader();
      const hash = createHash('sha256');
      let size = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > file.byteSize || size > 25 * 1024 * 1024) throw new Error('Material exceeded its published size.');
          hash.update(chunk.value);
          await handle.writeFile(chunk.value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      if (size !== file.byteSize || hash.digest('hex') !== file.sha256) throw new Error('Material failed its integrity check.');
      await handle.close();
      signal.throwIfAborted();
      await rename(partial, destination);
      return destination;
    } finally {
      await handle.close().catch(() => undefined);
      await rm(partial, { force: true });
    }
  }

}
