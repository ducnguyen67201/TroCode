import type { AppLanguage, OrganizationSummary } from '../shared/contracts';

import { translate } from './app-language';

export type ActiveView =
  | 'agent'
  | 'spaces'
  | 'assigned'
  | 'history'
  | 'insights'
  | 'organization';

export function organizationSettingsAvailable(
  organization: OrganizationSummary | null,
): boolean {
  return organization !== null;
}

export function navigationTitle(view: ActiveView, language: AppLanguage): { kicker: string; title: string } {
  switch (view) {
    case 'spaces': return { kicker: language === 'vi' ? 'Lớp học' : 'Classroom', title: translate(language, 'Classes') };
    case 'assigned': return { kicker: translate(language, 'Your work'), title: translate(language, 'Assigned Activities') };
    case 'history': return { kicker: translate(language, 'Session task record'), title: translate(language, 'History') };
    case 'insights': return { kicker: translate(language, 'Private on-device summary'), title: translate(language, 'Insights overview') };
    case 'organization': return { kicker: translate(language, 'Account settings'), title: translate(language, 'Organization') };
    case 'agent': return { kicker: translate(language, 'General-purpose agent'), title: translate(language, 'Current task') };
  }
}
