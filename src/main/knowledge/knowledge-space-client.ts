import { z } from 'zod';

import {
  ClassroomBroadcastFeedSchema,
  ClassroomBroadcastReceiptSchema,
  GuidanceClaimSchema,
  GuidanceSummarySchema,
  TeacherClassroomContextSchema,
  type ClassroomBroadcastPayload,
  type GuidanceReport,
  type GuidanceStartRequest,
} from '../../shared/classroom-broadcast-contracts';
import {
  AddKnowledgeSpaceMembersResultSchema,
  AssignedActivityListSchema,
  ClassroomDirectiveClaimSchema,
  ClassroomDirectiveListSchema,
  ClassroomDirectiveSchema,
  CreateKnowledgeSpaceResponseSchema,
  HostedAttemptContextSchema,
  KnowledgeActivityDraftSchema,
  KnowledgeActivityVersionSchema,
  KnowledgeAttemptTransitionSchema,
  KnowledgeCapabilitiesSchema,
  KnowledgeClassroomSessionSchema,
  KnowledgeClassSessionListSchema,
  KnowledgeClassSessionSchema,
  KnowledgeDashboardSchema,
  KnowledgeGroupListSchema,
  KnowledgeGroupSchema,
  KnowledgeInviteSchema,
  KnowledgeRoomCodeSchema,
  KnowledgeRoomRevocationSchema,
  KnowledgeRunSchema,
  KnowledgeSourceListSchema,
  KnowledgeSpaceListSchema,
  KnowledgeSpaceMemberListSchema,
  KnowledgeSpaceSummarySchema,
  LeaveKnowledgeClassroomResponseSchema,
  PreparedKnowledgeActivitySchema,
  PublishedKnowledgeActivityListSchema,
  RedeemKnowledgeInviteResponseSchema,
  type AddKnowledgeSpaceMembersRequest,
  type AddKnowledgeSpaceMembersResult,
  type AssignedActivityList,
  type ClaimClassroomDirectiveRequest,
  type ClassroomDirective,
  type ClassroomDirectiveClaim,
  type ClassroomDirectiveList,
  type CreateClassroomDirectiveRequest,
  type CreateKnowledgeClassSessionRequest,
  type CreateKnowledgeGroupRequest,
  type CreateKnowledgeInviteRequest,
  type CreateKnowledgeRoomCodeRequest,
  type CreateKnowledgeRunRequest,
  type CreateKnowledgeSpaceRequest,
  type CreateKnowledgeSpaceResponse,
  type HostedAttemptContext,
  type JoinKnowledgeRoomRequest,
  type KnowledgeActivityDraft,
  type KnowledgeActivityVersion,
  type KnowledgeAttemptTransition,
  type KnowledgeCapabilities,
  type KnowledgeClassroomSession,
  type KnowledgeClassSession,
  type KnowledgeClassSessionList,
  type KnowledgeDashboard,
  type KnowledgeGroup,
  type KnowledgeGroupList,
  type KnowledgeInvite,
  type KnowledgeRoomCode,
  type KnowledgeRoomRevocation,
  type KnowledgeRun,
  type KnowledgeSourceList,
  type KnowledgeSpaceList,
  type KnowledgeSpaceMemberList,
  type KnowledgeSpaceSummary,
  type LeaveKnowledgeClassroomResponse,
  type PreparedKnowledgeActivity,
  type PrepareKnowledgeActivityRequest,
  type PublishedKnowledgeActivityList,
  type PublishKnowledgeActivityRequest,
  type RedeemKnowledgeInviteResponse,
  type ResolveKnowledgeAttemptHelpRequest,
  type ReviewKnowledgeAttemptRequest,
  type RevokeKnowledgeRoomCodeRequest,
  type SaveKnowledgeActivityRequest,
} from '../../shared/contracts';

import { KnowledgeHttpClient } from './knowledge-http-client';
import {
  ActivityEvidenceResponseSchema,
  ActivityStarterFilesSchema,
  CompleteResponseSchema,
  InitiateResponseSchema,
  KnowledgeSearchResponseSchema,
  WorkSessionSchema,
  type ActivityStarterFiles,
  type HostedWorkSession,
  type InitiateUploadResponse,
  type KnowledgeSearchResponse,
} from './knowledge-response-contracts';

export type { ActivityStarterFiles,HostedWorkSession,InitiateUploadResponse,KnowledgeSearchResponse } from './knowledge-response-contracts';

export { KnowledgeSpaceRequestError } from './knowledge-http-client';
export class KnowledgeSpaceClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly accessTokenProvider: () => Promise<string | null>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  capabilities(): Promise<KnowledgeCapabilities> {
    if (!this.apiBaseUrl.trim())
      return Promise.resolve({
        knowledgeSpaces: { enabled: false, contractVersion: 2 },
      });
    return this.request(
      '/v1/capabilities',
      { method: 'GET' },
      KnowledgeCapabilitiesSchema,
    );
  }
  listSpaces(): Promise<KnowledgeSpaceList> {
    return this.request(
      '/v1/spaces',
      { method: 'GET' },
      KnowledgeSpaceListSchema,
    );
  }
  createSpace(
    input: CreateKnowledgeSpaceRequest,
  ): Promise<CreateKnowledgeSpaceResponse> {
    return this.request(
      '/v1/spaces',
      this.json('POST', input),
      CreateKnowledgeSpaceResponseSchema,
    );
  }
  getSpace(spaceId: string): Promise<KnowledgeSpaceSummary> {
    return this.request(
      `/v1/spaces/${spaceId}`,
      { method: 'GET' },
      KnowledgeSpaceSummarySchema,
    );
  }
  listGroups(spaceId: string): Promise<KnowledgeGroupList> {
    return this.request(
      `/v1/spaces/${spaceId}/groups`,
      { method: 'GET' },
      KnowledgeGroupListSchema,
    );
  }
  createGroup(input: CreateKnowledgeGroupRequest): Promise<KnowledgeGroup> {
    const { spaceId, ...body } = input;
    return this.request(
      `/v1/spaces/${spaceId}/groups`,
      this.json('POST', body),
      KnowledgeGroupSchema,
    );
  }
  listMembers(spaceId: string): Promise<KnowledgeSpaceMemberList> {
    return this.request(
      `/v1/spaces/${spaceId}/members`,
      { method: 'GET' },
      KnowledgeSpaceMemberListSchema,
    );
  }
  addMembers(
    input: AddKnowledgeSpaceMembersRequest,
  ): Promise<AddKnowledgeSpaceMembersResult> {
    const { spaceId, ...body } = input;
    return this.request(
      `/v1/spaces/${spaceId}/members/bulk`,
      this.json('POST', body),
      AddKnowledgeSpaceMembersResultSchema,
    );
  }
  createInvite(input: CreateKnowledgeInviteRequest): Promise<KnowledgeInvite> {
    const { spaceId, ...body } = input;
    return this.request(
      `/v1/spaces/${spaceId}/invites`,
      this.json('POST', body),
      KnowledgeInviteSchema,
    );
  }
  redeemInvite(code: string): Promise<RedeemKnowledgeInviteResponse> {
    return this.request(
      '/v1/space-invites/redeem',
      this.json('POST', { code }),
      RedeemKnowledgeInviteResponseSchema,
    );
  }
  listSources(spaceId: string): Promise<KnowledgeSourceList> {
    return this.request(
      `/v1/spaces/${spaceId}/sources`,
      { method: 'GET' },
      KnowledgeSourceListSchema,
    );
  }
  initiateUpload(
    spaceId: string,
    input: unknown,
  ): Promise<InitiateUploadResponse> {
    return this.request(
      `/v1/spaces/${spaceId}/uploads/initiate`,
      this.json('POST', input),
      InitiateResponseSchema,
    );
  }
  initiateSubmission(
    attemptId: string,
    input: unknown,
  ): Promise<InitiateUploadResponse> {
    return this.request(
      `/v1/attempts/${attemptId}/submissions/initiate`,
      this.json('POST', input),
      InitiateResponseSchema,
    );
  }
  commitSubmission(attemptId: string, clientId: string): Promise<void> {
    return this.request(
      `/v1/attempts/${attemptId}/submissions/commit`,
      this.json('POST', { clientId }),
      z.object({
        attemptId: z.string().uuid(),
        state: z.literal('submitted'),
        submittedAt: z.string().datetime(),
      }),
    ).then(() => undefined);
  }
  completeUpload(input: {
    clientId: string;
    sourceVersionId: string;
  }): Promise<z.infer<typeof CompleteResponseSchema>> {
    return this.request(
      '/v1/uploads/complete',
      this.json('POST', input),
      CompleteResponseSchema,
    );
  }
  prepareActivity(
    input: PrepareKnowledgeActivityRequest,
  ): Promise<PreparedKnowledgeActivity> {
    const { spaceId, ...body } = input;
    return this.request(
      `/v1/spaces/${spaceId}/activities/prepare`,
      { ...this.json('POST', body), signal: AbortSignal.timeout(90_000) },
      PreparedKnowledgeActivitySchema,
    );
  }
  saveActivity(
    input: SaveKnowledgeActivityRequest,
  ): Promise<KnowledgeActivityDraft> {
    const { spaceId, ...body } = input;
    return this.request(
      `/v1/spaces/${spaceId}/activities`,
      this.json('POST', body),
      KnowledgeActivityDraftSchema,
    );
  }
  publishActivity(
    input: PublishKnowledgeActivityRequest,
  ): Promise<KnowledgeActivityVersion> {
    return this.request(
      `/v1/spaces/${input.spaceId}/activities/${input.activityId}/publish`,
      this.json('POST', { clientId: input.clientId }),
      KnowledgeActivityVersionSchema,
    );
  }
  listPublishedActivities(
    spaceId: string,
  ): Promise<PublishedKnowledgeActivityList> {
    return this.request(
      `/v1/spaces/${spaceId}/activities`,
      { method: 'GET' },
      PublishedKnowledgeActivityListSchema,
    );
  }
  listClassSessions(spaceId: string): Promise<KnowledgeClassSessionList> {
    return this.request(
      `/v1/spaces/${spaceId}/sessions`,
      { method: 'GET' },
      KnowledgeClassSessionListSchema,
    );
  }
  createClassSession(
    input: CreateKnowledgeClassSessionRequest,
  ): Promise<KnowledgeClassSession> {
    const { spaceId, ...body } = input;
    return this.request(
      `/v1/spaces/${spaceId}/sessions`,
      this.json('POST', body),
      KnowledgeClassSessionSchema,
    );
  }
  createRun(input: CreateKnowledgeRunRequest): Promise<KnowledgeRun> {
    const { spaceId, ...body } = input;
    return this.request(
      `/v1/spaces/${spaceId}/runs`,
      this.json('POST', body),
      KnowledgeRunSchema,
    );
  }
  createRoomCode(
    input: CreateKnowledgeRoomCodeRequest,
  ): Promise<KnowledgeRoomCode> {
    const { spaceId, runId, ...body } = input;
    return this.request(
      `/v1/spaces/${spaceId}/runs/${runId}/room-code`,
      this.json('POST', body),
      KnowledgeRoomCodeSchema,
    );
  }
  revokeRoomCode(
    input: RevokeKnowledgeRoomCodeRequest,
  ): Promise<KnowledgeRoomRevocation> {
    return this.request(
      `/v1/spaces/${input.spaceId}/runs/${input.runId}/room-code`,
      { method: 'DELETE' },
      KnowledgeRoomRevocationSchema,
    );
  }
  joinRoom(
    input: JoinKnowledgeRoomRequest,
  ): Promise<KnowledgeClassroomSession> {
    return this.request(
      '/v1/live-rooms/join',
      this.json('POST', input),
      KnowledgeClassroomSessionSchema,
    );
  }
  getCurrentClassroomSession(): Promise<KnowledgeClassroomSession | null> {
    return this.request(
      '/v1/live-rooms/current',
      { method: 'GET' },
      z.object({ session: KnowledgeClassroomSessionSchema.nullable() }),
    ).then((response) => response.session);
  }
  leaveClassroom(
    attemptId: string,
    clientId: string,
  ): Promise<LeaveKnowledgeClassroomResponse> {
    return this.request(
      `/v1/attempts/${attemptId}/live-session/leave`,
      this.json('POST', { clientId }),
      LeaveKnowledgeClassroomResponseSchema,
    );
  }
  createDirective(
    input: CreateClassroomDirectiveRequest,
  ): Promise<ClassroomDirective> {
    const { spaceId, runId, ...body } = input;
    return this.request(
      `/v1/spaces/${spaceId}/runs/${runId}/directives`,
      this.json('POST', body),
      ClassroomDirectiveSchema,
    );
  }
  listDirectives(
    attemptId: string,
    sinceSequence: number,
    signal?: AbortSignal,
  ): Promise<ClassroomDirectiveList> {
    return this.request(
      `/v1/attempts/${attemptId}/directives?sinceSequence=${sinceSequence}`,
      { method: 'GET', signal },
      ClassroomDirectiveListSchema,
    );
  }
  claimDirective(
    input: ClaimClassroomDirectiveRequest,
  ): Promise<ClassroomDirectiveClaim> {
    const { attemptId, directiveId, clientId } = input;
    return this.request(
      `/v1/attempts/${attemptId}/directives/${directiveId}/claim`,
      this.json('POST', { clientId }),
      ClassroomDirectiveClaimSchema,
    );
  }
  readyAttempt(
    attemptId: string,
    clientId: string,
  ): Promise<KnowledgeAttemptTransition> {
    return this.request(
      `/v1/attempts/${attemptId}/ready`,
      this.json('POST', { clientId }),
      KnowledgeAttemptTransitionSchema,
    );
  }
  reviewAttempt(
    input: ReviewKnowledgeAttemptRequest,
  ): Promise<KnowledgeAttemptTransition> {
    const { spaceId, runId, attemptId, ...body } = input;
    return this.request(
      `/v1/spaces/${spaceId}/runs/${runId}/attempts/${attemptId}/review`,
      this.json('POST', body),
      KnowledgeAttemptTransitionSchema,
    );
  }
  resolveHelp(
    input: ResolveKnowledgeAttemptHelpRequest,
  ): Promise<KnowledgeAttemptTransition> {
    const { spaceId, runId, attemptId, ...body } = input;
    return this.request(
      `/v1/spaces/${spaceId}/runs/${runId}/attempts/${attemptId}/help/resolve`,
      this.json('POST', body),
      KnowledgeAttemptTransitionSchema,
    );
  }
  setRunState(
    spaceId: string,
    runId: string,
    state: 'open' | 'closed',
  ): Promise<KnowledgeRun> {
    return this.request(
      `/v1/spaces/${spaceId}/runs/${runId}/${state === 'open' ? 'open' : 'close'}`,
      this.json('POST', {}),
      KnowledgeRunSchema,
    );
  }
  listAssigned(): Promise<AssignedActivityList> {
    return this.request(
      '/v1/assignments/me',
      { method: 'GET' },
      AssignedActivityListSchema,
    );
  }
  getAttempt(attemptId: string): Promise<HostedAttemptContext> {
    return this.request(
      `/v1/attempts/${attemptId}`,
      { method: 'GET' },
      HostedAttemptContextSchema,
    );
  }
  starterFiles(attemptId: string): Promise<ActivityStarterFiles> {
    return this.request(
      `/v1/attempts/${attemptId}/starter-files`,
      { method: 'GET' },
      ActivityStarterFilesSchema,
    );
  }
  acknowledgeAttempt(attemptId: string, policyVersion: string): Promise<void> {
    return this.request(
      `/v1/attempts/${attemptId}/acknowledge`,
      this.json('POST', { policyVersion }),
      z.object({ acknowledged: z.literal(true) }),
    ).then(() => undefined);
  }
  requestHelp(attemptId: string, clientId: string): Promise<void> {
    return this.request(
      `/v1/attempts/${attemptId}/help`,
      this.json('POST', { clientId }),
      z.object({ requested: z.literal(true), state: z.string() }),
    ).then(() => undefined);
  }
  createWorkSession(
    attemptId: string,
    input: {
      clientId: string;
      taskId: string;
      launchKind: 'none' | 'workspace' | 'current_surface';
      purpose: 'work' | 'help' | 'check';
    },
  ): Promise<HostedWorkSession> {
    return this.request(
      `/v1/attempts/${attemptId}/work-sessions`,
      this.json('POST', input),
      WorkSessionSchema,
    );
  }
  updateWorkSession(workSessionId: string, input: unknown): Promise<unknown> {
    return this.request(
      `/v1/work-sessions/${workSessionId}`,
      this.json('PATCH', input),
      z.unknown(),
    );
  }
  searchKnowledge(
    attemptId: string,
    input: unknown,
  ): Promise<KnowledgeSearchResponse> {
    return this.request(
      `/v1/attempts/${attemptId}/knowledge/search`,
      this.json('POST', input),
      KnowledgeSearchResponseSchema,
    );
  }
  recordEvidence(
    attemptId: string,
    input: unknown,
  ): Promise<z.infer<typeof ActivityEvidenceResponseSchema>> {
    return this.request(
      `/v1/attempts/${attemptId}/evidence`,
      this.json('POST', input),
      ActivityEvidenceResponseSchema,
    );
  }
  dashboard(
    spaceId: string,
    runId: string,
    sinceSequence?: number,
  ): Promise<KnowledgeDashboard> {
    return this.request(
      `/v1/spaces/${spaceId}/runs/${runId}/dashboard${sinceSequence === undefined ? '' : `?sinceSequence=${sinceSequence}`}`,
      { method: 'GET' },
      KnowledgeDashboardSchema,
    );
  }

  teacherClassroomContext(spaceId: string, sessionId: string) {
    return this.request(
      `/v1/spaces/${spaceId}/sessions/${sessionId}/teacher-context`,
      { method: 'GET' },
      TeacherClassroomContextSchema,
    );
  }
  commitClassroomBroadcast(
    spaceId: string,
    sessionId: string,
    clientId: string,
    payload: ClassroomBroadcastPayload,
  ) {
    return this.request(
      `/v1/spaces/${spaceId}/sessions/${sessionId}/broadcasts`,
      this.json('POST', { clientId, payload }),
      ClassroomBroadcastReceiptSchema,
    );
  }
  lookupClassroomBroadcast(
    spaceId: string,
    sessionId: string,
    clientId: string,
  ) {
    return this.request(
      `/v1/spaces/${spaceId}/sessions/${sessionId}/broadcasts/by-client/${clientId}`,
      { method: 'GET' },
      z
        .object({ receipt: ClassroomBroadcastReceiptSchema.nullable() })
        .strict(),
    );
  }
  listClassroomBroadcasts(
    anchor: string,
    afterSequence?: number,
    signal?: AbortSignal,
  ) {
    return this.request(
      `/v1/attempts/${anchor}/session-broadcasts${afterSequence === undefined ? '' : `?afterSequence=${afterSequence}`}`,
      {
        method: 'GET',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
          : undefined,
      },
      ClassroomBroadcastFeedSchema,
    );
  }
  resolveBroadcastAssignment(anchor: string, broadcast: string) {
    return this.request(
      `/v1/attempts/${anchor}/session-broadcasts/${broadcast}/assignment`,
      { method: 'GET' },
      z.object({ attemptId: z.string().uuid() }).strict(),
    );
  }
  claimClassroomGuidance(
    anchor: string,
    broadcast: string,
    input: GuidanceStartRequest,
  ) {
    return this.request(
      `/v1/attempts/${anchor}/session-broadcasts/${broadcast}/guidance-starts`,
      this.json('POST', input),
      GuidanceClaimSchema,
    );
  }
  lookupClassroomGuidance(anchor: string, broadcast: string) {
    return this.request(
      `/v1/attempts/${anchor}/session-broadcasts/${broadcast}/guidance-start`,
      { method: 'GET' },
      z.object({ claim: GuidanceClaimSchema.nullable() }).strict(),
    );
  }
  reportClassroomGuidance(workSessionId: string, input: GuidanceReport) {
    return this.request(
      `/v1/work-sessions/${workSessionId}/classroom-guidance`,
      this.json('PATCH', input),
      GuidanceClaimSchema,
    );
  }
  classroomGuidanceSummary(space: string, session: string, broadcast: string) {
    return this.request(
      `/v1/spaces/${space}/sessions/${session}/broadcasts/${broadcast}/guidance-summary`,
      { method: 'GET' },
      GuidanceSummarySchema,
    );
  }

  private json(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  }
  private request<T>(path: string, init: RequestInit, schema: z.ZodType<T>, authenticated = true): Promise<T> {
    return new KnowledgeHttpClient(this.apiBaseUrl, this.accessTokenProvider, this.fetchImpl).request(path, init, schema, authenticated);
  }
}
