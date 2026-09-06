import { useCallback, useEffect, useState } from 'react';

import type { AppUpdateStatus } from '../../../shared/contracts';

export function useAppUpdates() {
  const [appUpdateStatus, setAppUpdateStatus] =
    useState<AppUpdateStatus | null>(null);

  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);

  const [isUpdatingApp, setIsUpdatingApp] = useState(false);

  useEffect(() => {
    const unsubscribeAppUpdates = window.tro.onAppUpdateStatusChanged(
      (status) => {
        setAppUpdateStatus(status);
        setAppUpdateError(null);
      },
    );
    void window.tro
      .getAppUpdateStatus()
      .then((status) => {
        setAppUpdateStatus(status);
        setAppUpdateError(null);
      })
      .catch((updateStatusError: unknown) => {
        setAppUpdateError(
          updateStatusError instanceof Error
            ? updateStatusError.message
            : 'Tro could not inspect application updates.',
        );
      });
    return unsubscribeAppUpdates;
  }, []);

  const checkForAppUpdates = useCallback(async () => {
    setIsUpdatingApp(true);
    setAppUpdateError(null);
    try {
      setAppUpdateStatus(await window.tro.checkForAppUpdates());
    } catch (updateError) {
      setAppUpdateError(
        updateError instanceof Error
          ? updateError.message
          : 'Tro could not check for updates.',
      );
    } finally {
      setIsUpdatingApp(false);
    }
  }, []);

  const restartAndInstallAppUpdate = useCallback(async () => {
    setIsUpdatingApp(true);
    setAppUpdateError(null);
    try {
      await window.tro.restartAndInstallAppUpdate();
    } catch (updateError) {
      setAppUpdateError(
        updateError instanceof Error
          ? updateError.message
          : 'Tro could not restart to install the update.',
      );
      setIsUpdatingApp(false);
    }
  }, []);

  return {
    isUpdatingApp,
    restartAndInstallAppUpdate,
    appUpdateStatus,
    appUpdateError,
    checkForAppUpdates,
  };
}
