import { ipcRenderer, type IpcRendererEvent } from 'electron';

import { z } from 'zod';

import { lessonDesktopApi } from './classroom-lesson-preload';
import * as C from './shared/classroom-broadcast-contracts';
import {
  CLASSROOM_BROADCAST_CHANNELS as channels,
  type ClassroomDesktopApi,
} from './shared/classroom-desktop-api';
import type { ClassroomLessonDesktopApi } from './shared/classroom-lesson-desktop-api';

const taskId = z.object({ taskId: z.string().uuid() }).strict();
const guidanceId = z.object({ guidanceId: z.string().uuid() }).strict();
const summaryInput = z
  .object({
    spaceId: z.string().uuid(),
    sessionId: z.string().uuid(),
    broadcastId: z.string().uuid(),
  })
  .strict();
function subscribe<T>(
  channel: string,
  schema: z.ZodType<T>,
  listener: (value: T) => void,
): () => void {
  const handler = (_event: IpcRendererEvent, value: unknown) =>
    listener(schema.parse(value));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
export const classroomDesktopApi: ClassroomDesktopApi & { lessons: ClassroomLessonDesktopApi } = {
  lessons: lessonDesktopApi,
  selectTeacherClassroom: async (input) =>
    C.TeacherClassroomSelectionSchema.parse(
      await ipcRenderer.invoke(
        channels.selectTeacherClassroom,
        C.TeacherClassroomSelectSchema.parse(input),
      ),
    ),
  clearTeacherClassroom: async (input) => {
    await ipcRenderer.invoke(
      channels.clearTeacherClassroom,
      C.TeacherClassroomClearSchema.parse(input),
    );
  },
  getTeacherClassroom: async () =>
    C.TeacherClassroomSelectionSchema.nullable().parse(
      await ipcRenderer.invoke(channels.getTeacherClassroom),
    ),
  onTeacherClassroomChanged: (listener) =>
    subscribe(
      channels.teacherClassroomChanged,
      C.TeacherClassroomSelectionSchema.nullable(),
      listener,
    ),
  getClassroomBroadcastDrafts: async (input) =>
    C.BroadcastDraftProjectionSchema.parse(
      await ipcRenderer.invoke(
        channels.getClassroomBroadcastDrafts,
        taskId.parse(input),
      ),
    ),
  onClassroomBroadcastDraftsChanged: (listener) =>
    subscribe(
      channels.classroomBroadcastDraftsChanged,
      C.BroadcastDraftProjectionSchema,
      listener,
    ),
  confirmClassroomBroadcast: async (input) =>
    C.ClassroomBroadcastDraftSchema.parse(
      await ipcRenderer.invoke(
        channels.confirmClassroomBroadcast,
        C.BroadcastDraftActionSchema.parse(input),
      ),
    ),
  cancelClassroomBroadcast: async (input) =>
    C.ClassroomBroadcastDraftSchema.parse(
      await ipcRenderer.invoke(
        channels.cancelClassroomBroadcast,
        C.BroadcastDraftActionSchema.parse(input),
      ),
    ),
  reconcileClassroomBroadcast: async (input) =>
    C.ClassroomBroadcastDraftSchema.parse(
      await ipcRenderer.invoke(
        channels.reconcileClassroomBroadcast,
        C.BroadcastDraftLookupSchema.parse(input),
      ),
    ),
  getClassroomBroadcastNotice: async () =>
    C.BroadcastNoticeSchema.nullable().parse(
      await ipcRenderer.invoke(channels.getClassroomBroadcastNotice),
    ),
  onClassroomBroadcastChanged: (listener) =>
    subscribe(
      channels.classroomBroadcastChanged,
      C.BroadcastNoticeSchema.nullable(),
      listener,
    ),
  openClassroomBroadcastAssignment: async (input) =>
    z
      .object({ attemptId: z.string().uuid() })
      .strict()
      .parse(
        await ipcRenderer.invoke(
          channels.openClassroomBroadcastAssignment,
          C.BroadcastIdRequestSchema.parse(input),
        ),
      ),
  openClassroomBroadcastLink: async (input) => {
    await ipcRenderer.invoke(
      channels.openClassroomBroadcastLink,
      C.BroadcastIdRequestSchema.parse(input),
    );
  },
  dismissClassroomBroadcast: async (input) => {
    await ipcRenderer.invoke(
      channels.dismissClassroomBroadcast,
      C.BroadcastIdRequestSchema.parse(input),
    );
  },
  setClassroomGuidanceConsent: async (input) =>
    C.GuidanceStateSchema.parse(
      await ipcRenderer.invoke(
        channels.setClassroomGuidanceConsent,
        C.GuidanceConsentRequestSchema.parse(input),
      ),
    ),
  startClassroomExplanation: async (input) =>
    C.GuidanceStateSchema.parse(
      await ipcRenderer.invoke(
        channels.startClassroomExplanation,
        C.GuidanceStartLocalSchema.parse(input),
      ),
    ),
  continueClassroomExplanation: async (input) =>
    C.GuidanceStateSchema.parse(
      await ipcRenderer.invoke(
        channels.continueClassroomExplanation,
        C.GuidanceContinueSchema.parse(input),
      ),
    ),
  stopClassroomExplanation: async (input) =>
    C.GuidanceStateSchema.parse(
      await ipcRenderer.invoke(
        channels.stopClassroomExplanation,
        guidanceId.parse(input),
      ),
    ),
  getClassroomGuidanceState: async () =>
    C.GuidanceStateSchema.parse(
      await ipcRenderer.invoke(channels.getClassroomGuidanceState),
    ),
  onClassroomGuidanceChanged: (listener) =>
    subscribe(
      channels.classroomGuidanceChanged,
      C.GuidanceStateSchema,
      listener,
    ),
  getClassroomGuidanceSummary: async (input) =>
    C.GuidanceSummarySchema.parse(
      await ipcRenderer.invoke(
        channels.getClassroomGuidanceSummary,
        summaryInput.parse(input),
      ),
    ),
};
