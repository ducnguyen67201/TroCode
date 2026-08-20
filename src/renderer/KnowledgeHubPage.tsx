import { useState } from 'react';

import type { AppLanguage, KnowledgeSpaceSummary, SubmitTaskRequest } from '../shared/contracts';

import { AssignedActivitiesPage } from './AssignedActivitiesPage';
import { AttemptLaunchPage } from './AttemptLaunchPage';
import { SpaceDetailPage } from './SpaceDetailPage';
import { SpacesPage } from './SpacesPage';

export function KnowledgeHubPage({ appLanguage, mode, onLaunch }: { appLanguage: AppLanguage; mode: 'spaces'|'assigned'; onLaunch: (request: SubmitTaskRequest) => Promise<void> }) {
  const [space, setSpace] = useState<KnowledgeSpaceSummary | null>(null); const [attemptId, setAttemptId] = useState<string | null>(null);
  if (attemptId) return <AttemptLaunchPage appLanguage={appLanguage} attemptId={attemptId} onBack={() => setAttemptId(null)} onLaunch={onLaunch} />;
  if (mode === 'assigned') return <AssignedActivitiesPage appLanguage={appLanguage} onOpen={setAttemptId} />;
  if (space) return <SpaceDetailPage appLanguage={appLanguage} onBack={() => setSpace(null)} space={space} />;
  return <SpacesPage appLanguage={appLanguage} onOpen={setSpace} />;
}
