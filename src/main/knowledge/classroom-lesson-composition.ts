import type { LessonView } from '../../shared/classroom-lesson-contracts';
import type { TaskApplicationService } from '../application/task-application-service';
import type { CursorBuddyController } from '../companion/cursor-buddy-controller';
import type { CuaService } from '../cua/cua-service';

import { ClassroomDesktopTeachingTools } from './classroom-desktop-teaching-tools';
import { ClassroomLessonClient } from './classroom-lesson-client';
import { ClassroomLessonController } from './classroom-lesson-controller';
import { ClassroomLessonDraftService } from './classroom-lesson-draft-service';
import { ClassroomLessonFeedService } from './classroom-lesson-feed-service';
import { ClassroomLessonMaterialService } from './classroom-lesson-material-service';
import { ClassroomLessonStateStore } from './classroom-lesson-state-store';
import { ClassroomLessonStepRunner } from './classroom-lesson-step-runner';
import { ClassroomLessonSurfaceService } from './classroom-lesson-surface-service';
import { ClassroomLessonToolPolicy } from './classroom-lesson-tool-policy';
import type { ClassroomSessionService } from './classroom-session-service';
import { KnowledgeHttpClient } from './knowledge-http-client';
import type { KnowledgeSpaceClient } from './knowledge-space-client';

export function createLessonServices(
  apiUrl: string,
  accessToken: () => Promise<string | null>,
  owner: () => Promise<string>,
) {
  const client = new ClassroomLessonClient(new KnowledgeHttpClient(apiUrl, accessToken));
  const store = new ClassroomLessonStateStore();
  return {
    client,
    store,
    policy: new ClassroomLessonToolPolicy(),
    drafts: new ClassroomLessonDraftService(client, store, owner),
  };
}
export function createClassroomLessonFeatures(
  base: ReturnType<typeof createLessonServices>,
  options: {
    tasks: TaskApplicationService;
    cua: CuaService;
    knowledge: KnowledgeSpaceClient;
    session: ClassroomSessionService;
    owner(): Promise<string>;
    openUrl(url: string): Promise<void>;
    showMaterial(): void;
    present(view: LessonView): void;
    build: string;
    directory: string;
    chooseFile(): Promise<string | null>;
    openPath(path: string): Promise<string>;
    prepareObservation(): Promise<() => Promise<void>>;
    presenter: Pick<CursorBuddyController, 'presentSequence' | 'cancelGuidance'>;
  },
) {
  const surfaces = new ClassroomLessonSurfaceService({ cua: options.cua, prepareObservation: options.prepareObservation });
  const materials = new ClassroomLessonMaterialService({ directory: options.directory, client: base.client, store: base.store, surfaces, chooseFile: options.chooseFile, validateSelection: async (state, revision) => { await controller.desktopState(state.envelope.lessonId, revision); }, openPath: options.openPath, openUrl: options.openUrl, authorize: () => controller.authorize(), consume: (kind) => controller.consume(kind), markEffect: (effect) => controller.markEffect(effect) });
  const teaching = new ClassroomDesktopTeachingTools({ surfaces, cua: options.cua, presenter: options.presenter, authorize: () => controller.authorize(), consume: (kind) => controller.consume(kind), markEffect: (effect) => controller.markEffect(effect) });
  const runner: ClassroomLessonStepRunner = new ClassroomLessonStepRunner({
    tasks: options.tasks,
    client: options.knowledge,
    cua: options.cua,
    policy: base.policy,
    desktop: { materials, teaching },
    openUrl: options.openUrl,
    showMaterial: options.showMaterial,
    authorize: () => controller.authorize(),
    consume: (kind, count) => controller.consume(kind, count),
  });
  const controller: ClassroomLessonController = new ClassroomLessonController({
    client: base.client,
    store: base.store,
    runner,
    owner: options.owner,
  });
  const feed = new ClassroomLessonFeedService(options.session, base.client, controller, options.build);
  let lastStatus = '';
  let lastPresentation = '';
  controller.onChange((view) => {
    const presentation = `${view.active?.envelope.lessonId}:${view.active?.revision}:${view.active?.phase}:${view.error}`;
    if (presentation !== lastPresentation) {
      lastPresentation = presentation;
      options.present(view);
    }
    if (!view.active) return;
    const state = view.active;
    const status = `${state.envelope.lessonId}:${state.status}:${state.phase}:${state.reasonCode}`;
    if (status === lastStatus) return;
    lastStatus = status;
    console.info('[classroom:lesson] state', {
      lessonId: state.envelope.lessonId,
      stepId: state.envelope.plan.steps[state.stepIndex]?.id,
      childTaskId: state.child?.taskId,
      status: state.status,
      phase: state.phase,
      reason: state.reasonCode,
      resourceId: state.material?.resource.id,
      resourceKind: state.material?.resource.kind,
      materialCharacters: (state.material?.text?.length ?? 0) + (state.material?.chunks.reduce((n, c) => n + c.body.length, 0) ?? 0),
      historyEntries: state.history.length,
    });
  });
  return { client: base.client, drafts: base.drafts, runner, controller, feed, teaching,
    async chooseFile(lessonId: string, revision: number) { await materials.chooseLocal(await controller.desktopState(lessonId, revision)); return controller.view(); },
    async windows(lessonId: string, revision: number) {
      const state = await controller.desktopState(lessonId, revision);
      await options.cua.startTaskSession(lessonId);
      try { return await surfaces.list(state); } finally { await options.cua.endTaskSession(lessonId); }
    },
    async selectWindow(lessonId: string, revision: number, token: string) {
      surfaces.select(await controller.desktopState(lessonId, revision), token);
      return controller.view();
    },
  };
}
