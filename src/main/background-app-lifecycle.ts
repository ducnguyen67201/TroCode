interface WindowCloseEvent {
  preventDefault(): void;
}

interface BackgroundVoiceWindow {
  hide(): void;
  on(
    event: 'close',
    listener: (event: WindowCloseEvent) => void,
  ): unknown;
  removeListener(
    event: 'close',
    listener: (event: WindowCloseEvent) => void,
  ): unknown;
}

interface BackgroundVoiceLifecycleOptions {
  isShuttingDown(): boolean;
}

/**
 * Keep the renderer that owns microphone capture alive when the user closes
 * the main window. A real application shutdown is still allowed through.
 */
export function keepWindowAliveForBackgroundVoice(
  window: BackgroundVoiceWindow,
  { isShuttingDown }: BackgroundVoiceLifecycleOptions,
): () => void {
  const handleClose = (event: WindowCloseEvent): void => {
    if (isShuttingDown()) return;

    event.preventDefault();
    window.hide();
  };

  window.on('close', handleClose);
  return () => window.removeListener('close', handleClose);
}
