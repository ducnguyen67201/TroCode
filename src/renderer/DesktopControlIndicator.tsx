export function DesktopControlIndicator() {
  return (
    <div
      aria-live="polite"
      className="desktop-control-indicator"
      role="status"
    >
      <div aria-hidden="true" className="desktop-control-indicator__border" />
      <div className="desktop-control-indicator__label">
        <span aria-hidden="true" />
        TroCode is controlling
      </div>
    </div>
  );
}
