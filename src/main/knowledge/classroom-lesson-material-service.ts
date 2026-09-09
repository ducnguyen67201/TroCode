import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import type { LessonFile, LessonLocalState } from '../../shared/classroom-lesson-contracts';

import type { ClassroomLessonClient } from './classroom-lesson-client';
import { LessonBlockedError } from './classroom-lesson-errors';
import { safeMaterialName } from './classroom-lesson-material-policy';
import type { ClassroomLessonOpeningService } from './classroom-lesson-opening-service';
import type { ClassroomLessonStateStore } from './classroom-lesson-state-store';
import type { ClassroomLessonSurfaceService } from './classroom-lesson-surface-service';

/** Download tickets and native paths stay in main; the renderer selects a lesson resource. */
export class ClassroomLessonMaterialService {
  constructor(private readonly options: {
    directory: string;
    client: Pick<ClassroomLessonClient, 'file'>;
    store: Pick<ClassroomLessonStateStore, 'readNativeMaterial' | 'saveNativeMaterial'>;
    surfaces: Pick<ClassroomLessonSurfaceService, 'observe' | 'selectFileTitle' | 'restoreFileTitle'>;
    opening: Pick<ClassroomLessonOpeningService, 'complete'>;
    chooseFile?(): Promise<string | null>;
    validateSelection?(state: LessonLocalState, revision: number): Promise<void>;
    openPath(value: string): Promise<string>;
    openUrl(value: string): Promise<void>;
    markEffect(effect: LessonLocalState['effect']): Promise<void>;
    authorize(): Promise<void>;
    consume(kind: 'action' | 'observation'): Promise<void>;
    fetchImpl?: typeof fetch;
  }) {}

  async prepare(state: LessonLocalState, signal: AbortSignal) {
    const step = state.envelope.plan.steps[state.stepIndex]!;
    const resource = state.material!.resource;
    const previous = await this.options.store.readNativeMaterial(state.ownerId, state.envelope.lessonId, resource.id);
    if (previous && resource.kind !== 'web') this.options.surfaces.restoreFileTitle(state, path.basename(previous.path));
    if (previous?.status !== 'selected') {
      await this.options.consume('observation');
      try { await this.options.surfaces.observe(state, state.envelope.lessonId, signal); return; }
      catch (error) { if (!(error instanceof LessonBlockedError) || step.surface?.kind !== 'resource_app') throw error; }
    }
    if (previous?.status === 'dispatching') { await this.options.markEffect('unknown'); throw new Error('The earlier opening is uncertain. Inspect the material before accepting a new lesson.'); }
    if (previous?.status === 'opened') {
      await this.finishOpening(state, previous.path, previous.sha256, resource.kind !== 'web', signal);
      return;
    }
    let target: string, sha256 = '';
    if (previous?.status === 'selected') { target = previous.path; this.options.surfaces.selectFileTitle(state, path.basename(target)); }
    else if (resource.kind === 'source_text') {
      const file = await this.options.client.file(state.anchorAttemptId, state.envelope.lessonId, resource.id, signal);
      try { target = await this.download(state.ownerId, file, signal); }
      catch (error) {
        signal.throwIfAborted();
        throw new LessonBlockedError('resource_unavailable', error instanceof Error && !('code' in error) ? error.message : 'Could not prepare the lesson material cache.');
      }
      sha256 = file.sha256;
      this.options.surfaces.selectFileTitle(state, path.basename(target));
    } else if (resource.kind === 'web') target = resource.url;
    else throw new LessonBlockedError('resource_unavailable', 'Select a class file or website to open.');
    await this.options.authorize();
    signal.throwIfAborted();
    await this.options.consume('action');
    await this.options.store.saveNativeMaterial(state.ownerId, state.envelope.lessonId, resource.id, { path: target, sha256, status: 'dispatching' });
    await this.options.markEffect('dispatching');
    signal.throwIfAborted();
    if (resource.kind === 'web' && previous?.status !== 'selected') await this.openWithDeadline(() => this.options.openUrl(target));
    else {
      const error = await this.openWithDeadline(() => this.options.openPath(target));
      if (error) {
        await this.options.store.saveNativeMaterial(state.ownerId, state.envelope.lessonId, resource.id, { path: target, sha256, status: 'failed' });
        await this.options.markEffect('none');
        throw new LessonBlockedError('resource_unavailable', 'The file could not be opened. Open it in a suitable app, then choose its window.');
      }
    }
    await this.options.store.saveNativeMaterial(state.ownerId, state.envelope.lessonId, resource.id, { path: target, sha256, status: 'opened' });
    await this.options.markEffect('confirmed');
    await this.finishOpening(state, target, sha256, resource.kind !== 'web' || previous?.status === 'selected', signal);
  }

  private finishOpening(state: LessonLocalState, target: string, sha256: string, file: boolean, signal: AbortSignal) {
    return this.options.opening.complete(state, file ? path.basename(target) : undefined, signal, async (effect) => {
      const resource = state.envelope.plan.steps[state.stepIndex]!.resourceId;
      // Journal chooser clicks too, so a crash cannot turn an unknown click into a retry.
      await this.options.store.saveNativeMaterial(state.ownerId, state.envelope.lessonId, resource,
        { path: target, sha256, status: effect === 'dispatching' || effect === 'unknown' ? 'dispatching' : 'opened' });
      await this.options.markEffect(effect);
    });
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
    await this.options.store.saveNativeMaterial(state.ownerId, state.envelope.lessonId, state.envelope.plan.steps[state.stepIndex]!.resourceId, { path: selected, sha256: '', status: 'selected' });
  }

  private async openWithDeadline<T>(open: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([open(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Opening the material has an uncertain outcome. Inspect its window before continuing.')), 10_000); })]); }
    catch { throw new Error('The material opening outcome could not be verified. Inspect its window; Tro will not repeat the opening.'); }
    finally { clearTimeout(timer); }
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
