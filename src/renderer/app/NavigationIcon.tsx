export function NavigationIcon({
  name,
}: {
  name:
    | 'activity'
    | 'agent'
    | 'assigned'
    | 'history'
    | 'insights'
    | 'organization'
    | 'settings';
}) {
  if (name === 'agent') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 3 4.5 7.2v9.6L12 21l7.5-4.2V7.2L12 3Z" />
        <path d="M8.5 12h7M12 8.5v7" />
      </svg>
    );
  }

  if (name === 'insights') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    );
  }

  if (name === 'history') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4.5 6.5h10M4.5 12h7M4.5 17.5h5" />
        <path d="M18.5 10v4.5l2.5 1.5" />
        <circle cx="18.5" cy="14.5" r="4" />
      </svg>
    );
  }

  if (name === 'assigned') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M6 3h12v18H6z" />
        <path d="m9 12 2 2 4-5M9 7h6" />
      </svg>
    );
  }

  if (name === 'organization') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19v-2.2A3.8 3.8 0 0 1 7.3 13h3.4a3.8 3.8 0 0 1 3.8 3.8V19" />
        <path d="M16 10.5a2.5 2.5 0 1 0 0-5M16.5 13.5a3.5 3.5 0 0 1 4 3.5v2" />
      </svg>
    );
  }

  if (name === 'settings') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5L9 6.1a8 8 0 0 0-1.7 1L5 6.1 3 9.5 5 11a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 3.1h5l.4-3.1a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7.4 7.4 0 0 0 .1-1Z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 12h4l2-6 4 12 2-6h4" />
    </svg>
  );
}
