import { z } from 'zod';

import {
  AssignedActivityListSchema, CreateKnowledgeSpaceResponseSchema, HostedAttemptContextSchema,
  KnowledgeActivityDraftSchema, KnowledgeActivityVersionSchema, KnowledgeCapabilitiesSchema,
  KnowledgeDashboardSchema, KnowledgeRunSchema, KnowledgeSourceListSchema, KnowledgeSpaceListSchema,
  KnowledgeSpaceSummarySchema,
  KnowledgeGroupListSchema, KnowledgeGroupSchema, KnowledgeInviteSchema,
  RedeemKnowledgeInviteResponseSchema,
  type AssignedActivityList, type CreateKnowledgeRunRequest, type CreateKnowledgeSpaceRequest,
  type CreateKnowledgeSpaceResponse, type HostedAttemptContext, type KnowledgeActivityDraft,
  type KnowledgeActivityVersion, type KnowledgeCapabilities, type KnowledgeDashboard, type KnowledgeRun,
  type KnowledgeSourceList, type KnowledgeSpaceList, type KnowledgeSpaceSummary,
  type PublishKnowledgeActivityRequest, type SaveKnowledgeActivityRequest,
  type CreateKnowledgeGroupRequest, type CreateKnowledgeInviteRequest,
  type KnowledgeGroup, type KnowledgeGroupList, type KnowledgeInvite,
  type RedeemKnowledgeInviteResponse,
} from '../../shared/contracts';

const InitiateResponseSchema = z.object({
  uploads: z.array(z.object({
    sourceId: z.string().uuid(), sourceVersionId: z.string().uuid(),
    state: z.enum(['pending_upload', 'processing', 'ready', 'failed']),
    upload: z.object({ url: z.string().url(), expiresInSeconds: z.number().int().positive(), headers: z.record(z.string(), z.string()) }).nullable(),
  })).max(100),
});
const CompleteResponseSchema = z.object({ id: z.string().uuid(), state: z.enum(['processing', 'ready']) });
const WorkSessionSchema = z.object({ id: z.string().uuid(), state: z.enum(['created','active','paused','completed','cancelled','failed']), taskId: z.string().uuid(), launchKind: z.enum(['none','workspace','current_surface']), createdAt: z.string().datetime() });
const KnowledgeSearchResponseSchema = z.object({
  results: z.array(z.object({
    sourceTitle: z.string().max(255),
    role: z.enum(['reference', 'instructions', 'rubric', 'starter']),
    locator: z.record(z.string(), z.unknown()),
    snippet: z.string().max(4_000),
    score: z.number().finite(),
  })).max(6),
  truncated: z.boolean(),
});
const ActivityEvidenceResponseSchema = z.object({
  id: z.string().uuid(), criterionId: z.string().max(80), tag: z.string().max(80),
  provenance: z.enum(['participant','host','agent_candidate','facilitator']),
  resultCode: z.enum(['observed','passed','failed','blocked','needs_review']), createdAt: z.string().datetime(),
});
const ActivityStarterFilesSchema = z.object({
  files: z.array(z.object({
    byteSize: z.number().int().positive().max(25 * 1024 * 1024),
    mediaType: z.enum(['text/plain', 'text/markdown', 'application/pdf']),
    relativePath: z.string().trim().min(1).max(2_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    sourceVersionId: z.string().uuid(),
    download: z.object({
      expiresInSeconds: z.number().int().positive().max(300),
      url: z.string().url(),
    }),
  })).max(100),
});

export type InitiateUploadResponse = z.infer<typeof InitiateResponseSchema>;
export type HostedWorkSession = z.infer<typeof WorkSessionSchema>;
export type KnowledgeSearchResponse = z.infer<typeof KnowledgeSearchResponseSchema>;
export type ActivityStarterFiles = z.infer<typeof ActivityStarterFilesSchema>;

export class KnowledgeSpaceClient {
  constructor(private readonly apiBaseUrl: string, private readonly accessTokenProvider: () => Promise<string | null>, private readonly fetchImpl: typeof fetch = fetch) {}

  capabilities(): Promise<KnowledgeCapabilities> {
    if (!this.apiBaseUrl.trim()) return Promise.resolve({ knowledgeSpaces: { enabled: false, contractVersion: 1 } });
    return this.request('/v1/capabilities', { method: 'GET' }, KnowledgeCapabilitiesSchema, false);
  }
  listSpaces(): Promise<KnowledgeSpaceList> { return this.request('/v1/spaces', { method: 'GET' }, KnowledgeSpaceListSchema); }
  createSpace(input: CreateKnowledgeSpaceRequest): Promise<CreateKnowledgeSpaceResponse> { return this.request('/v1/spaces', this.json('POST', input), CreateKnowledgeSpaceResponseSchema); }
  getSpace(spaceId: string): Promise<KnowledgeSpaceSummary> { return this.request(`/v1/spaces/${spaceId}`, { method: 'GET' }, KnowledgeSpaceSummarySchema); }
  listGroups(spaceId: string): Promise<KnowledgeGroupList> { return this.request(`/v1/spaces/${spaceId}/groups`, { method: 'GET' }, KnowledgeGroupListSchema); }
  createGroup(input: CreateKnowledgeGroupRequest): Promise<KnowledgeGroup> { const { spaceId, ...body } = input; return this.request(`/v1/spaces/${spaceId}/groups`, this.json('POST', body), KnowledgeGroupSchema); }
  createInvite(input: CreateKnowledgeInviteRequest): Promise<KnowledgeInvite> { const { spaceId, ...body } = input; return this.request(`/v1/spaces/${spaceId}/invites`, this.json('POST', body), KnowledgeInviteSchema); }
  redeemInvite(code: string): Promise<RedeemKnowledgeInviteResponse> { return this.request('/v1/space-invites/redeem', this.json('POST', { code }), RedeemKnowledgeInviteResponseSchema); }
  listSources(spaceId: string): Promise<KnowledgeSourceList> { return this.request(`/v1/spaces/${spaceId}/sources`, { method: 'GET' }, KnowledgeSourceListSchema); }
  initiateUpload(spaceId: string, input: unknown): Promise<InitiateUploadResponse> { return this.request(`/v1/spaces/${spaceId}/uploads/initiate`, this.json('POST', input), InitiateResponseSchema); }
  initiateSubmission(attemptId: string, input: unknown): Promise<InitiateUploadResponse> { return this.request(`/v1/attempts/${attemptId}/submissions/initiate`, this.json('POST', input), InitiateResponseSchema); }
  commitSubmission(attemptId: string, clientId: string): Promise<void> { return this.request(`/v1/attempts/${attemptId}/submissions/commit`, this.json('POST', { clientId }), z.object({ attemptId: z.string().uuid(), state: z.literal('submitted'), submittedAt: z.string().datetime() })).then(() => undefined); }
  completeUpload(input: { clientId: string; sourceVersionId: string }): Promise<z.infer<typeof CompleteResponseSchema>> { return this.request('/v1/uploads/complete', this.json('POST', input), CompleteResponseSchema); }
  saveActivity(input: SaveKnowledgeActivityRequest): Promise<KnowledgeActivityDraft> {
    const { spaceId, ...body } = input; return this.request(`/v1/spaces/${spaceId}/activities`, this.json('POST', body), KnowledgeActivityDraftSchema);
  }
  publishActivity(input: PublishKnowledgeActivityRequest): Promise<KnowledgeActivityVersion> {
    return this.request(`/v1/spaces/${input.spaceId}/activities/${input.activityId}/publish`, this.json('POST', { clientId: input.clientId }), KnowledgeActivityVersionSchema);
  }
  createRun(input: CreateKnowledgeRunRequest): Promise<KnowledgeRun> {
    const { spaceId, ...body } = input; return this.request(`/v1/spaces/${spaceId}/runs`, this.json('POST', body), KnowledgeRunSchema);
  }
  setRunState(spaceId: string, runId: string, state: 'open' | 'closed'): Promise<KnowledgeRun> {
    return this.request(`/v1/spaces/${spaceId}/runs/${runId}/${state === 'open' ? 'open' : 'close'}`, this.json('POST', {}), KnowledgeRunSchema);
  }
  listAssigned(): Promise<AssignedActivityList> { return this.request('/v1/assignments/me', { method: 'GET' }, AssignedActivityListSchema); }
  getAttempt(attemptId: string): Promise<HostedAttemptContext> { return this.request(`/v1/attempts/${attemptId}`, { method: 'GET' }, HostedAttemptContextSchema); }
  starterFiles(attemptId: string): Promise<ActivityStarterFiles> { return this.request(`/v1/attempts/${attemptId}/starter-files`, { method: 'GET' }, ActivityStarterFilesSchema); }
  acknowledgeAttempt(attemptId: string, policyVersion: string): Promise<void> { return this.request(`/v1/attempts/${attemptId}/acknowledge`, this.json('POST', { policyVersion }), z.object({ acknowledged: z.literal(true) })).then(() => undefined); }
  requestHelp(attemptId: string, clientId: string): Promise<void> { return this.request(`/v1/attempts/${attemptId}/help`, this.json('POST', { clientId }), z.object({ requested: z.literal(true), state: z.string() })).then(() => undefined); }
  createWorkSession(attemptId: string, input: { clientId: string; taskId: string; launchKind: 'none'|'workspace'|'current_surface' }): Promise<HostedWorkSession> { return this.request(`/v1/attempts/${attemptId}/work-sessions`, this.json('POST', input), WorkSessionSchema); }
  updateWorkSession(workSessionId: string, input: unknown): Promise<unknown> { return this.request(`/v1/work-sessions/${workSessionId}`, this.json('PATCH', input), z.unknown()); }
  searchKnowledge(attemptId: string, input: unknown): Promise<KnowledgeSearchResponse> { return this.request(`/v1/attempts/${attemptId}/knowledge/search`, this.json('POST', input), KnowledgeSearchResponseSchema); }
  recordEvidence(attemptId: string, input: unknown): Promise<z.infer<typeof ActivityEvidenceResponseSchema>> { return this.request(`/v1/attempts/${attemptId}/evidence`, this.json('POST', input), ActivityEvidenceResponseSchema); }
  dashboard(spaceId: string, runId: string, sinceSequence?: number): Promise<KnowledgeDashboard> { return this.request(`/v1/spaces/${spaceId}/runs/${runId}/dashboard${sinceSequence === undefined ? '' : `?sinceSequence=${sinceSequence}`}`, { method: 'GET' }, KnowledgeDashboardSchema); }

  private json(method: string, body: unknown): RequestInit { return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
  private async request<T>(path: string, init: RequestInit, schema: z.ZodType<T>, authenticated = true): Promise<T> {
    const baseUrl = this.apiBaseUrl.trim().replace(/\/+$/u, '');
    if (!baseUrl) throw new Error('Knowledge Spaces require the hosted TroCode service.');
    const token = authenticated ? await this.accessTokenProvider() : null;
    if (authenticated && !token) throw new Error('Sign in to use Knowledge Spaces.');
    const response = await this.fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Knowledge Spaces returned HTTP ${response.status}.`);
    return schema.parse(await response.json());
  }
}
