import { accountMessages1 } from './account';
import { activityAuthoringMessages } from './activity-authoring';
import { classroomMessages1 } from './classroom-1';
import { classroomMessages2 } from './classroom-2';
import { commonMessages1 } from './common-1';
import { commonMessages2 } from './common-2';
import { companionMessages1 } from './companion';
import { settingsMessages1 } from './settings';
import { tasksMessages1 } from './tasks';

export const VIETNAMESE_TRANSLATIONS: Readonly<Record<string, string>> = {
  ...activityAuthoringMessages,
  ...tasksMessages1,
  ...commonMessages1,
  ...commonMessages2,
  ...settingsMessages1,
  ...accountMessages1,
  ...companionMessages1,
};

export const CLASSROOM_VIETNAMESE_TRANSLATIONS: Readonly<
  Record<string, string>
> = {
  ...classroomMessages1,
  ...classroomMessages2,
};
