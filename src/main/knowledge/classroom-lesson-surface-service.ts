import { randomUUID } from 'node:crypto';

import type { LessonLocalState } from '../../shared/classroom-lesson-contracts';
import type { DesktopObservation } from '../agent/execution-contracts';
import type { CuaService } from '../cua/cua-service';
import type { CuaWindowIdentity } from '../cua/cua-window-selection';

import { LessonBlockedError } from './classroom-lesson-errors';

interface Binding {
  owner: string;
  step: string;
  identity: CuaWindowIdentity;
  title: string;
  url?: string;
  explicit: boolean;
}

/** Native identities are main-only, short-lived, and never restored as authority after restart. */
export class ClassroomLessonSurfaceService {
  private readonly fileTitles = new Map<string, string>();
  selectFileTitle(state: LessonLocalState, title: string) { this.clear(state.envelope.lessonId); this.fileTitles.set(state.envelope.lessonId, title); }
  restoreFileTitle(state: LessonLocalState, title: string) { this.fileTitles.set(state.envelope.lessonId, title); }
  private readonly bindings = new Map<string, Binding>();
  private readonly choices = new Map<string, { lesson: string; owner: string; revision: number; expires: number; identity: CuaWindowIdentity }>();
  constructor(private readonly options: {
    cua: Pick<CuaService, 'externalLessonWindows' | 'observeLessonWindow'>;
    prepareObservation(): Promise<() => Promise<void>>;
    now?: () => number;
  }) {}

  clear(lessonId: string) {
    this.bindings.delete(lessonId);
    this.fileTitles.delete(lessonId);
    for (const [token, choice] of this.choices) if (choice.lesson === lessonId) this.choices.delete(token);
  }

  async list(state: LessonLocalState, signal?: AbortSignal) {
    const cleanup = await this.options.prepareObservation();
    try {
      for (const [token, choice] of this.choices) if (choice.expires < this.now() || choice.lesson === state.envelope.lessonId) this.choices.delete(token);
      return (await this.options.cua.externalLessonWindows(signal)).slice(0, 50).map((window) => {
        const token = randomUUID();
        this.choices.set(token, { lesson: state.envelope.lessonId, owner: state.ownerId, revision: state.revision,
          expires: this.now() + 60_000, identity: { processId: window.pid, windowId: window.window_id } });
        return { token, label: `${window.app_name} — ${window.title}`.slice(0, 500) };
      });
    } finally { await cleanup(); }
  }

  select(state: LessonLocalState, token: string) {
    const choice = this.choices.get(token);
    this.choices.delete(token);
    const step = state.envelope.plan.steps[state.stepIndex];
    if (!choice || !step || choice.lesson !== state.envelope.lessonId || choice.owner !== state.ownerId ||
      choice.revision !== state.revision || choice.expires < this.now()) throw new Error('Window selection expired. Refresh the windows.');
    this.bindings.set(choice.lesson, { owner: choice.owner, step: step.id, identity: choice.identity, title: '', explicit: true });
  }

  async observe(state: LessonLocalState, taskId: string, signal: AbortSignal): Promise<DesktopObservation> {
    const result = await this.inspectMaterial(state, taskId, signal);
    if (!result.ready) throw result.error;
    return result.observation;
  }

  /** Observation and resource verification are separate; unfamiliar UI is not lesson content. */
  async inspectMaterial(state: LessonLocalState, taskId: string, signal: AbortSignal): Promise<
    { ready: true; observation: DesktopObservation } |
    { ready: false; observation?: DesktopObservation; error: LessonBlockedError }
  > {
    signal.throwIfAborted();
    const step = state.envelope.plan.steps[state.stepIndex];
    if (!step) throw new Error('Lesson step is unavailable.');
    let bound = this.bindings.get(state.envelope.lessonId);
    if (bound && (bound.owner !== state.ownerId || bound.step !== step.id)) {
      this.clear(state.envelope.lessonId); bound = undefined;
    }
    const cleanup = await this.options.prepareObservation();
    try {
      const result = await this.options.cua.observeLessonWindow(taskId, bound?.identity, signal);
      if (!result) {
        // A dead identity is not a permanent target. The next observation may
        // discover the resource in a new window, but must verify it afresh.
        this.bindings.delete(state.envelope.lessonId);
        return { ready: false, error: new LessonBlockedError('surface_unverified', 'The previous window is unavailable. Observe the current screen and show the requested material.') };
      }
      // Preserve the shared router's identity: its dispatch binding owns this
      // fingerprint. Presentation compares additional visual evidence separately.
      const observation = result.observation;
      try {
        const title = observation.surface?.title ?? '';
        if (bound && ((bound.title && bound.title !== title) || bound.url !== undefined && bound.url !== observation.surface?.url)) {
          this.bindings.delete(state.envelope.lessonId);
          throw new LessonBlockedError('surface_unverified', 'The document or tab changed. Observe again to verify the requested material.');
        }
        const resource = state.envelope.plan.resources.find((r) => r.id === step.resourceId);
        const material = state.material;
        if (!resource || (material && (material.resource.id !== resource.id || material.resource.kind !== resource.kind ||
            (resource.kind === 'source_text' && material.resource.kind === 'source_text' && material.resource.sourceVersionId !== resource.sourceVersionId))))
          throw new LessonBlockedError('resource_unavailable', 'Material no longer matches the reviewed resource.');
        if (!bound?.explicit && (resource?.kind === 'source_text' || this.fileTitles.has(state.envelope.lessonId))) {
          const name = (this.fileTitles.get(state.envelope.lessonId) ?? resource!.title).split(/[\\/]/u).pop()!.toLocaleLowerCase();
          if (!title.toLocaleLowerCase().includes(name))
            throw new LessonBlockedError('surface_unverified', 'Show the requested file, or select its window to explain it.');
          const source = [material?.text, ...(material?.chunks.map((chunk) => chunk.body) ?? [])].filter(Boolean).join('\n').trim();
          // A title may name a file while an OS dialog is still opening it.
          // Match content evidence, not application names or localized controls.
          if (source && observation.text.trim()) {
            const visible = [observation.text, ...(observation.elements ?? []).map((element) => element.value ?? '')].join('\n').replace(/\s+/gu, ' ');
            const excerpts = source.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.length >= Math.min(8, source.length));
            if (!excerpts.some((line) => visible.includes(line.slice(0, 120).replace(/\s+/gu, ' '))))
              throw new LessonBlockedError('surface_unverified', 'The requested document content is not visible yet. Observe the screen and finish opening it.');
          }
        }
        if (resource?.kind === 'web' && observation.surface?.url !== resource.url)
          throw new LessonBlockedError('surface_unverified', 'Show the requested webpage before starting this lesson.');
        if (!observation.text.trim() && !observation.screenshot)
          throw new LessonBlockedError('resource_unavailable', 'The material is not readable. Open it or zoom in, then continue.');
        this.bindings.set(state.envelope.lessonId, { owner: state.ownerId, step: step.id, identity: result.identity,
          title, url: observation.surface?.url, explicit: bound?.explicit ?? false });
        return { ready: true, observation };
      } catch (error) {
        if (!(error instanceof LessonBlockedError)) throw error;
        return { ready: false, observation, error };
      }
    } finally { await cleanup(); }
  }

  private now() { return this.options.now?.() ?? Date.now(); }
}
