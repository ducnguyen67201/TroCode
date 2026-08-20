import type { AppLanguage } from '../shared/contracts';

import { translate } from './app-language';

export type ActiveView = 'agent' | 'spaces' | 'assigned' | 'history' | 'insights' | 'settings';

export function navigationTitle(view: ActiveView, language: AppLanguage): { kicker: string; title: string } {
  switch (view) {
    case 'spaces': return { kicker: translate(language, 'Reusable context'), title: translate(language, 'Knowledge Spaces') };
    case 'assigned': return { kicker: translate(language, 'Your work'), title: translate(language, 'Assigned Activities') };
    case 'history': return { kicker: translate(language, 'Session task record'), title: translate(language, 'History') };
    case 'insights': return { kicker: translate(language, 'Private on-device summary'), title: translate(language, 'Insights overview') };
    case 'settings': return { kicker: translate(language, 'Personal preferences'), title: translate(language, 'Language & settings') };
    case 'agent': return { kicker: translate(language, 'General-purpose agent'), title: translate(language, 'Current task') };
  }
}
