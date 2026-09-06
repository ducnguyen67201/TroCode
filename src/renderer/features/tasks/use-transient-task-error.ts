import { useCallback, useEffect, useReducer } from 'react';

import {
  INITIAL_TRANSIENT_CURSOR_ERROR_STATE,
  scheduleTransientCursorErrorDismissal,
  transientCursorErrorReducer,
} from '../../transient-cursor-error';

export function useTransientTaskError() {
  const [transientCursorError, dispatchTransientCursorError] = useReducer(
    transientCursorErrorReducer,
    INITIAL_TRANSIENT_CURSOR_ERROR_STATE,
  );

  const error = transientCursorError.message;

  const clearError = useCallback(() => {
    dispatchTransientCursorError({ type: 'cleared' });
  }, []);

  const reportError = useCallback((message: string) => {
    dispatchTransientCursorError({ type: 'reported', message });
  }, []);

  useEffect(() => {
    if (!transientCursorError.visible) return;

    return scheduleTransientCursorErrorDismissal(
      transientCursorError.revision,
      (revision) => {
        dispatchTransientCursorError({ type: 'dismissed', revision });
      },
    );
  }, [transientCursorError]);

  return { reportError, clearError, error };
}
