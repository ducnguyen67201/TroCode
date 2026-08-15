export const CURSOR_ERROR_BADGE_TIMEOUT_MS = 3_000;

export interface TransientCursorErrorState {
  message: string | null;
  revision: number;
  visible: boolean;
}

export type TransientCursorErrorAction =
  | { type: 'cleared' }
  | { type: 'dismissed'; revision: number }
  | { type: 'reported'; message: string };

export const INITIAL_TRANSIENT_CURSOR_ERROR_STATE: TransientCursorErrorState = {
  message: null,
  revision: 0,
  visible: false,
};

export function transientCursorErrorReducer(
  state: TransientCursorErrorState,
  action: TransientCursorErrorAction,
): TransientCursorErrorState {
  switch (action.type) {
    case 'reported':
      return {
        message: action.message,
        revision: state.revision + 1,
        visible: true,
      };
    case 'cleared':
      return state.message || state.visible
        ? { ...state, message: null, visible: false }
        : state;
    case 'dismissed':
      return action.revision === state.revision && state.visible
        ? { ...state, visible: false }
        : state;
  }
}

export function scheduleTransientCursorErrorDismissal(
  revision: number,
  onDismiss: (revision: number) => void,
): () => void {
  const timeout = setTimeout(() => {
    onDismiss(revision);
  }, CURSOR_ERROR_BADGE_TIMEOUT_MS);

  return () => clearTimeout(timeout);
}

export function getCompanionErrorVisibility({
  computerFailed,
  taskFailed,
  transientErrorVisible,
  voiceProviderFailed,
}: {
  computerFailed: boolean;
  taskFailed: boolean;
  transientErrorVisible: boolean;
  voiceProviderFailed: boolean;
}): boolean {
  return (
    transientErrorVisible ||
    taskFailed ||
    computerFailed ||
    voiceProviderFailed
  );
}
