import { useState } from 'react';

import type {
  AppLanguage,
  ClassroomAccountRole,
  KnowledgeSpaceSummary,
  SubmitTaskRequest,
  TaskSnapshot,
} from '../shared/contracts';

import { AssignedActivitiesPage } from './AssignedActivitiesPage';
import { AttemptLaunchPage } from './AttemptLaunchPage';
import { SpaceDetailPage, type SpaceDetailTab } from './SpaceDetailPage';
import { SpacesPage } from './SpacesPage';

export function KnowledgeHubPage({
  checkSnapshots = [],
  onTeacherSessionSelect,
  teacherSessionId,
  appLanguage,
  classroomError,
  classroomLoading,
  classroomRole,
  classSpaces,
  focusAttemptId = null,
  mode,
  onAttemptFocusCleared,
  onLaunch,
  onRefreshClassSpaces,
  onSelectSpace,
  space,
  spaceInitialTab = 'library',
}: {
  checkSnapshots?: readonly TaskSnapshot[];
  onTeacherSessionSelect?: (
    spaceId: string,
    sessionId: string | null,
  ) => Promise<void>;
  teacherSessionId?: string | null;
  appLanguage: AppLanguage;
  classroomError: string | null;
  classroomLoading: boolean;
  classroomRole: ClassroomAccountRole;
  classSpaces: KnowledgeSpaceSummary[];
  focusAttemptId?: string | null;
  mode: 'spaces' | 'assigned';
  onAttemptFocusCleared?: () => void;
  onLaunch: (request: SubmitTaskRequest) => Promise<void>;
  onRefreshClassSpaces: () => Promise<void>;
  onSelectSpace: (space: KnowledgeSpaceSummary | null) => void;
  space: KnowledgeSpaceSummary | null;
  spaceInitialTab?: SpaceDetailTab;
}) {
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
    null,
  );
  const attemptId = focusAttemptId ?? selectedAttemptId;

  if (attemptId) {
    return (
      <AttemptLaunchPage
        checkSnapshots={checkSnapshots}
        appLanguage={appLanguage}
        attemptId={attemptId}
        onBack={() => {
          setSelectedAttemptId(null);
          onAttemptFocusCleared?.();
        }}
        onLaunch={onLaunch}
      />
    );
  }
  if (mode === 'assigned') {
    return (
      <AssignedActivitiesPage
        appLanguage={appLanguage}
        onOpen={setSelectedAttemptId}
      />
    );
  }
  if (space) {
    return (
      <SpaceDetailPage
        onTeacherSessionSelect={onTeacherSessionSelect}
        teacherSessionId={teacherSessionId}
        appLanguage={appLanguage}
        initialTab={spaceInitialTab}
        key={`${space.id}:${spaceInitialTab}`}
        onBack={() => onSelectSpace(null)}
        onJoined={setSelectedAttemptId}
        space={space}
      />
    );
  }
  return (
    <SpacesPage
      appLanguage={appLanguage}
      classroomRole={classroomRole}
      error={classroomError}
      loading={classroomLoading}
      onOpen={onSelectSpace}
      onRefresh={onRefreshClassSpaces}
      spaces={classSpaces}
    />
  );
}
