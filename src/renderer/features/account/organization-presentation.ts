import type { AppLanguage } from '../../../shared/contracts';
import { appLocale } from '../../app-language';

export function formatJoinedDate(
  value: string,
  appLanguage: AppLanguage,
): string {
  return new Intl.DateTimeFormat(appLocale(appLanguage), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}
