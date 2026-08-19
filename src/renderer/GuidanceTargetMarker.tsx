export function GuidanceTargetMarker() {
  return (
    <div aria-hidden="true" className="guidance-target-marker">
      <div className="guidance-target-marker__ring">
        <span className="guidance-target-marker__highlight" />
      </div>
      <svg
        className="guidance-target-marker__pointer"
        focusable="false"
        viewBox="0 0 54 34"
      >
        <path className="guidance-target-marker__pointer-glow" d="M4 8 C20 2 39 8 45 24" />
        <path className="guidance-target-marker__pointer-line" d="M4 8 C20 2 39 8 45 24" />
        <path className="guidance-target-marker__pointer-head" d="m38 21 8 4 3-8" />
      </svg>
      <div className="guidance-target-marker__target" />
    </div>
  );
}
