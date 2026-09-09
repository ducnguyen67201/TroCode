import { ipcRenderer, type IpcRendererEvent } from 'electron';

import { z } from 'zod';

import * as C from './shared/classroom-lesson-contracts';
import * as I from './shared/classroom-lesson-desktop-api';

const ch = I.LESSON_CHANNELS;
const id = z.object({ draftId: z.uuid() }).strict();
function subscribe<T>(channel: string, schema: z.ZodType<T>, listener: (value: T) => void) {
  const handler = (_event: IpcRendererEvent, value: unknown) => listener(schema.parse(value));
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}
export const lessonDesktopApi: I.ClassroomLessonDesktopApi = {
  chooseFile: async (input) => C.LessonViewSchema.parse(await ipcRenderer.invoke(ch.chooseFile, I.LessonDesktopInputSchema.parse(input))),
  windows: async (input) => I.LessonWindowChoicesSchema.parse(await ipcRenderer.invoke(ch.windows, I.LessonDesktopInputSchema.parse(input))),
  selectWindow: async (input) => C.LessonViewSchema.parse(await ipcRenderer.invoke(ch.selectWindow, I.LessonWindowSelectSchema.parse(input))),
  desktopConsent: async (input) => C.LessonViewSchema.parse(await ipcRenderer.invoke(ch.desktopConsent, I.LessonDesktopConsentSchema.parse(input))),
  cancelDraft: async (input) => C.LessonDraftSchema.parse(await ipcRenderer.invoke(ch.cancelDraft, id.parse(input))),
  recoverDraft: async () => C.LessonDraftSchema.nullable().parse(await ipcRenderer.invoke(ch.recoverDraft)),
  context: async (input) =>
    C.LessonContextSchema.parse(await ipcRenderer.invoke(ch.context, I.LessonContextInputSchema.parse(input))),
  prepare: async (input) =>
    C.LessonDraftSchema.parse(await ipcRenderer.invoke(ch.prepare, I.LessonPrepareInputSchema.parse(input))),
  confirm: async (input) =>
    C.LessonDraftSchema.parse(await ipcRenderer.invoke(ch.confirm, I.LessonConfirmInputSchema.parse(input))),
  draft: async (input) => C.LessonDraftSchema.parse(await ipcRenderer.invoke(ch.draft, id.parse(input))),
  reconcile: async (input) => C.LessonDraftSchema.parse(await ipcRenderer.invoke(ch.reconcile, id.parse(input))),
  view: async () => C.LessonViewSchema.parse(await ipcRenderer.invoke(ch.view)),
  continue: async (input) =>
    C.LessonViewSchema.parse(await ipcRenderer.invoke(ch.continue, C.LessonContinueSchema.parse(input))),
  consent: async (input) =>
    C.LessonViewSchema.parse(
      await ipcRenderer.invoke(ch.consent, z.object({ enabled: z.boolean() }).strict().parse(input)),
    ),
  materialPage: async (input) =>
    C.LessonMaterialSchema.parse(await ipcRenderer.invoke(ch.materialPage, I.LessonMaterialPageSchema.parse(input))),
  materialAck: async (input) => {
    await ipcRenderer.invoke(ch.materialAck, I.LessonMaterialAckSchema.parse(input));
  },
  progress: async (input) =>
    C.LessonProgressSchema.parse(await ipcRenderer.invoke(ch.progress, I.LessonProgressInputSchema.parse(input))),
  stop: async (input) => {
    await ipcRenderer.invoke(ch.stop, I.LessonProgressInputSchema.parse(input));
  },
  onChange: (listener) => subscribe(ch.changed, C.LessonViewSchema, listener),
  onPrepared: (listener) => subscribe(ch.prepared, z.uuid(), listener),
};
