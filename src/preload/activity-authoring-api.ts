import { ipcRenderer } from 'electron';

import {
  CreateKnowledgeClassSessionRequestSchema,
  KnowledgeActivityDraftSchema,
  KnowledgeActivityVersionSchema,
  KnowledgeClassSessionListSchema,
  KnowledgeClassSessionSchema,
  KnowledgeSpaceIdRequestSchema,
  PrepareKnowledgeActivityRequestSchema,
  PreparedKnowledgeActivitySchema,
  PublishKnowledgeActivityRequestSchema,
  PublishedKnowledgeActivityListSchema,
  SaveKnowledgeActivityRequestSchema,
} from '../shared/contracts';
import { IPC_CHANNELS, type DesktopApi } from '../shared/desktop-api';

export const activityAuthoringApi: Pick<DesktopApi,
  'prepareKnowledgeActivity' | 'saveKnowledgeActivity' | 'publishKnowledgeActivity' | 'listPublishedKnowledgeActivities' | 'listKnowledgeClassSessions' | 'createKnowledgeClassSession'
> = {
  async prepareKnowledgeActivity(input) {
    const request = PrepareKnowledgeActivityRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.prepareKnowledgeActivity,
      request,
    );
    return PreparedKnowledgeActivitySchema.parse(response);
  },

  async saveKnowledgeActivity(input) {
    const request = SaveKnowledgeActivityRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.saveKnowledgeActivity,
      request,
    );
    return KnowledgeActivityDraftSchema.parse(response);
  },

  async publishKnowledgeActivity(input) {
    const request = PublishKnowledgeActivityRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.publishKnowledgeActivity,
      request,
    );
    return KnowledgeActivityVersionSchema.parse(response);
  },

  async listPublishedKnowledgeActivities(spaceId) {
    const request = KnowledgeSpaceIdRequestSchema.parse({ spaceId });
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.listPublishedKnowledgeActivities,
      request,
    );
    return PublishedKnowledgeActivityListSchema.parse(response);
  },

  async listKnowledgeClassSessions(spaceId) {
    const request = KnowledgeSpaceIdRequestSchema.parse({ spaceId });
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.listKnowledgeClassSessions,
      request,
    );
    return KnowledgeClassSessionListSchema.parse(response);
  },

  async createKnowledgeClassSession(input) {
    const request = CreateKnowledgeClassSessionRequestSchema.parse(input);
    const response: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.createKnowledgeClassSession,
      request,
    );
    return KnowledgeClassSessionSchema.parse(response);
  },

};
