export type SettingsSectionId =
  'general' | 'voice' | 'companion' | 'connections' | 'account' | 'about';

export interface SettingsSectionDefinition {
  description: string;
  group: 'Preferences' | 'Workspace' | 'Product';
  id: SettingsSectionId;
  label: string;
  number: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSectionDefinition[] = [
  {
    description: 'Language, behavior, and task safety.',
    group: 'Preferences',
    id: 'general',
    label: 'General',
    number: '01',
  },
  {
    description: 'Speech, shortcuts, and audio behavior.',
    group: 'Preferences',
    id: 'voice',
    label: 'Voice',
    number: '02',
  },
  {
    description: 'Shape how Tro appears beside your work.',
    group: 'Preferences',
    id: 'companion',
    label: 'Companion',
    number: '03',
  },
  {
    description: 'Connect tools Tro can use on your behalf.',
    group: 'Workspace',
    id: 'connections',
    label: 'Connections',
    number: '04',
  },
  {
    description: 'Plan, access, and organization details.',
    group: 'Workspace',
    id: 'account',
    label: 'Account',
    number: '05',
  },
  {
    description: 'Version, updates, and product details.',
    group: 'Product',
    id: 'about',
    label: 'About',
    number: '06',
  },
] as const;

export function SettingsSectionIcon({ name }: { name: SettingsSectionId }) {
  if (name === 'general') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6" />
      </svg>
    );
  }
  if (name === 'voice') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <rect height="11" rx="4" width="7" x="8.5" y="3" />
        <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" />
      </svg>
    );
  }
  if (name === 'companion') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M7 9V7a5 5 0 0 1 10 0v2M5 10h14v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3Z" />
        <path d="M9 14h.01M15 14h.01M9.5 17h5" />
      </svg>
    );
  }
  if (name === 'connections') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M9 8.5 7.5 7a3 3 0 0 0-4.2 4.2l2.5 2.5A3 3 0 0 0 10 13l1-1" />
        <path d="m15 15.5 1.5 1.5a3 3 0 0 0 4.2-4.2l-2.5-2.5A3 3 0 0 0 14 11l-1 1M8.5 15.5l7-7" />
      </svg>
    );
  }
  if (name === 'account') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="4" />
        <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7h.01" />
    </svg>
  );
}
