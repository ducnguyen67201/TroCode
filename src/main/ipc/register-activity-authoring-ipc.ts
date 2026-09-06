import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import {
  CreateKnowledgeClassSessionRequestSchema,
  KnowledgeSpaceIdRequestSchema,
  PrepareKnowledgeActivityRequestSchema,
  PublishKnowledgeActivityRequestSchema,
  SaveKnowledgeActivityRequestSchema,
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/desktop-api';
import type { KnowledgeSpaceClient } from '../knowledge/knowledge-space-client';

export function registerActivityAuthoringIpc(
  client: KnowledgeSpaceClient,
  assertAuthorized: (event: IpcMainInvokeEvent) => Promise<void>,
): void {
  ipcMain.handle(
    IPC_CHANNELS.prepareKnowledgeActivity,
    async (event, input: unknown) => {
      await assertAuthorized(event);
      return client.prepareActivity(
        PrepareKnowledgeActivityRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.saveKnowledgeActivity,
    async (event, input: unknown) => {
      await assertAuthorized(event);
      return client.saveActivity(
        SaveKnowledgeActivityRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.publishKnowledgeActivity,
    async (event, input: unknown) => {
      await assertAuthorized(event);
      return client.publishActivity(
        PublishKnowledgeActivityRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.listPublishedKnowledgeActivities,
    async (event, input: unknown) => {
      await assertAuthorized(event);
      const request = KnowledgeSpaceIdRequestSchema.parse(input);
      return client.listPublishedActivities(
        request.spaceId,
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.listKnowledgeClassSessions,
    async (event, input: unknown) => {
      await assertAuthorized(event);
      const request = KnowledgeSpaceIdRequestSchema.parse(input);
      return client.listClassSessions(request.spaceId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.createKnowledgeClassSession,
    async (event, input: unknown) => {
      await assertAuthorized(event);
      return client.createClassSession(
        CreateKnowledgeClassSessionRequestSchema.parse(input),
      );
    },
  );

}
