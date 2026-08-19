import { useEffect, useState } from 'react';

import type { CompanionGuidanceVisual } from '../shared/contracts';

interface GuidanceConnectorGeometry {
  end: { x: number; y: number };
  path: string;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export function guidanceConnectorGeometry(
  visual: CompanionGuidanceVisual,
): GuidanceConnectorGeometry {
  const start = visual.companion;
  const center = {
    x: visual.target.x + visual.target.width / 2,
    y: visual.target.y + visual.target.height / 2,
  };
  const deltaToCenter = {
    x: center.x - start.x,
    y: center.y - start.y,
  };
  const horizontalApproach =
    Math.abs(deltaToCenter.x) / Math.max(1, visual.target.width) >=
    Math.abs(deltaToCenter.y) / Math.max(1, visual.target.height);
  const end = horizontalApproach
    ? {
        x:
          deltaToCenter.x >= 0
            ? visual.target.x
            : visual.target.x + visual.target.width,
        y: center.y,
      }
    : {
        x: center.x,
        y:
          deltaToCenter.y >= 0
            ? visual.target.y
            : visual.target.y + visual.target.height,
      };
  const delta = { x: end.x - start.x, y: end.y - start.y };
  const distance = Math.max(1, Math.hypot(delta.x, delta.y));
  const bend = Math.min(150, Math.max(34, distance * 0.18));
  const normal = { x: -delta.y / distance, y: delta.x / distance };
  const bendDirection = delta.x >= 0 ? -1 : 1;
  const control = {
    x: (start.x + end.x) / 2 + normal.x * bend * bendDirection,
    y: (start.y + end.y) / 2 + normal.y * bend * bendDirection,
  };

  return {
    end: { x: rounded(end.x), y: rounded(end.y) },
    path: `M ${rounded(start.x)} ${rounded(start.y)} Q ${rounded(
      control.x,
    )} ${rounded(control.y)} ${rounded(end.x)} ${rounded(end.y)}`,
  };
}

export function DesktopControlIndicator() {
  const [visual, setVisual] = useState<CompanionGuidanceVisual | null>(null);

  useEffect(
    () => window.troCompanion.onGuidanceVisualChange(setVisual),
    [],
  );

  const connector = visual ? guidanceConnectorGeometry(visual) : null;

  return (
    <div
      aria-live="polite"
      className="desktop-control-indicator"
      role="status"
    >
      <div aria-hidden="true" className="desktop-control-indicator__border" />
      {visual && connector ? (
        <svg
          aria-hidden="true"
          className={`desktop-guidance-connector desktop-guidance-connector--${
            visual.moving ? 'moving' : 'holding'
          }`}
        >
          <defs>
            <linearGradient
              id="desktop-guidance-connector-gradient"
              gradientUnits="userSpaceOnUse"
              x1={visual.companion.x}
              x2={connector.end.x}
              y1={visual.companion.y}
              y2={connector.end.y}
            >
              <stop offset="0" stopColor="#fffdf4" stopOpacity="0.18" />
              <stop offset="0.42" stopColor="#f6d86f" stopOpacity="0.78" />
              <stop offset="1" stopColor="#f2c94c" />
            </linearGradient>
            <filter id="desktop-guidance-connector-glow">
              <feGaussianBlur result="blur" stdDeviation="3.5" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <marker
              id="desktop-guidance-arrow"
              markerHeight="9"
              markerUnits="strokeWidth"
              markerWidth="9"
              orient="auto"
              refX="7.2"
              refY="4.5"
            >
              <path d="M 0 0 L 8 4.5 L 0 9 Z" fill="#f2c94c" />
            </marker>
          </defs>
          <path
            className="desktop-guidance-connector__glow"
            d={connector.path}
          />
          <path
            className="desktop-guidance-connector__line"
            d={connector.path}
            markerEnd="url(#desktop-guidance-arrow)"
            pathLength="1"
          />
          <circle
            className="desktop-guidance-connector__origin"
            cx={visual.companion.x}
            cy={visual.companion.y}
            r="3.5"
          />
        </svg>
      ) : null}
      <div className="desktop-control-indicator__label">
        <span aria-hidden="true" />
        TroCode is controlling
      </div>
    </div>
  );
}
