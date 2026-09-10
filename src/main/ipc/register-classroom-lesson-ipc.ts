import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import { z } from 'zod';

import * as C from '../../shared/classroom-lesson-contracts';
import * as I from '../../shared/classroom-lesson-desktop-api';
import type { ClassroomLessonClient } from '../knowledge/classroom-lesson-client';
import type { ClassroomLessonController } from '../knowledge/classroom-lesson-controller';
import type { ClassroomLessonDraftService } from '../knowledge/classroom-lesson-draft-service';
import type { ClassroomLessonStepRunner } from '../knowledge/classroom-lesson-step-runner';

export interface ClassroomLessonFeatures {
  client: ClassroomLessonClient;
  controller: ClassroomLessonController;
  drafts: ClassroomLessonDraftService;
  runner: ClassroomLessonStepRunner;
  chooseFile(lessonId: string, revision: number): Promise<C.LessonView>;
  windows(lessonId: string, revision: number): Promise<z.infer<typeof I.LessonWindowChoicesSchema>>;
  selectWindow(lessonId: string, revision: number, token: string): Promise<C.LessonView>;
}
export function registerClassroomLessonIpc(
  window: BrowserWindow,
  features: ClassroomLessonFeatures | undefined,
  authorize: (event: IpcMainInvokeEvent) => Promise<void>,
) {
  const ch = I.LESSON_CHANNELS;
  const registered: string[] = [];
  const handle = (channel: string, work: (raw: unknown) => unknown) => {
    ipcMain.handle(channel, async (event, raw: unknown) => {
      await authorize(event);
      if (!features) throw new Error('Update Tro to use classroom lessons.');
      return work(raw);
    });
    registered.push(channel);
  };
  handle(ch.chooseFile, (raw) => { const i = I.LessonDesktopInputSchema.parse(raw); return features!.chooseFile(i.lessonId, i.revision); });
  handle(ch.windows, async (raw) => { const i = I.LessonDesktopInputSchema.parse(raw); return I.LessonWindowChoicesSchema.parse(await features!.windows(i.lessonId, i.revision)); });
  handle(ch.selectWindow, (raw) => { const i = I.LessonWindowSelectSchema.parse(raw); return features!.selectWindow(i.lessonId, i.revision, i.token); });
  handle(ch.recoverDraft, () => features!.drafts.recover());
  handle(ch.cancelDraft, (raw) => features!.drafts.cancel(z.object({ draftId: z.uuid() }).strict().parse(raw).draftId));
  handle(ch.context, (raw) => {
    const i = I.LessonContextInputSchema.parse(raw);
    return features!.client.context(i.spaceId, i.sessionId, i.runId);
  });
  handle(ch.prepare, (raw) => {
    const i = I.LessonPrepareInputSchema.parse(raw);
    return features!.drafts.prepare(i.binding, i.plan);
  });
  handle(ch.confirm, (raw) => {
    const i = I.LessonConfirmInputSchema.parse(raw);
    return features!.drafts.confirm(i.draftId, i.revision, i.digest);
  });
  handle(ch.draft, (raw) => features!.drafts.get(z.object({ draftId: z.uuid() }).strict().parse(raw).draftId));
  handle(ch.reconcile, (raw) =>
    features!.drafts.reconcile(z.object({ draftId: z.uuid() }).strict().parse(raw).draftId),
  );
  handle(ch.view, () => features!.controller.view());
  handle(ch.continue, (raw) => features!.controller.continue(C.LessonContinueSchema.parse(raw)));
  handle(ch.consent, async (raw) => {
    await features!.controller.setConsent(z.object({ enabled: z.boolean() }).strict().parse(raw).enabled);
    return features!.controller.view();
  });
  handle(ch.materialPage, (raw) => {
    const i = I.LessonMaterialPageSchema.parse(raw);
    return features!.controller.materialPage(i.lessonId, i.resourceId, i.ordinal);
  });
  handle(ch.materialAck, (raw) => {
    const i = I.LessonMaterialAckSchema.parse(raw);
    features!.runner.acknowledge(i.lessonId, i.revision, i.resourceId);
  });
  handle(ch.progress, (raw) => {
    const i = I.LessonProgressInputSchema.parse(raw);
    return features!.client.progress(i.spaceId, i.sessionId, i.lessonId, i.cursor);
  });
  handle(ch.stop, (raw) => {
    const i = I.LessonProgressInputSchema.parse(raw);
    return features!.client.stop(i.spaceId, i.sessionId, i.lessonId);
  });
  const stop = features?.controller.onChange((view) => {
    if (!window.isDestroyed()) window.webContents.send(ch.changed, C.LessonViewSchema.parse(view));
  });
  return () => {
    stop?.();
    registered.forEach((channel) => ipcMain.removeHandler(channel));
  };
}
