export interface NonActivatingInteractiveWindow {
  setFocusable(focusable: boolean): void;
  setIgnoreMouseEvents(
    ignore: boolean,
    options?: { forward: boolean },
  ): void;
}

export function setNonActivatingWindowInteractivity(
  window: NonActivatingInteractiveWindow,
  interactive: boolean,
): void {
  window.setFocusable(false);
  window.setIgnoreMouseEvents(!interactive, { forward: true });
}
