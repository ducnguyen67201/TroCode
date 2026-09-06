// @vitest-environment happy-dom

import { resolve } from 'node:path';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CompanionApi } from '../shared/desktop-api';
import { readStylesheet } from '../test-support/read-stylesheet';

import { CursorBuddy, CursorBuddyView } from './CursorBuddy';
import { CursorCompanion } from './CursorCompanion';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('CursorBuddy', () => {
  it('renders the original action cursor independently from the desktop pet', () => {
    const buddyMarkup = renderToStaticMarkup(createElement(CursorBuddy));
    const petMarkup = renderToStaticMarkup(createElement(CursorCompanion));

    expect(buddyMarkup).toContain('Tro teaching cursor');
    expect(buddyMarkup).toContain('cursor-buddy__image');
    expect(buddyMarkup).toContain('tro-cursor-buddy');
    expect(buddyMarkup).not.toContain('tro-desktop-pet');
    expect(petMarkup).toContain('Tro desktop pet: Idle');
    expect(petMarkup).not.toContain('tro-cursor-buddy');
  });

  it('applies pointer coordinates only in full-desktop overlay mode', () => {
    const overlayMarkup = renderToStaticMarkup(
      createElement(CursorBuddyView, {
        overlayTracking: true,
        snapshot: {
          busy: false,
          phase: 'following',
          position: { x: 10, y: 20 },
        },
      }),
    );
    const nativeMarkup = renderToStaticMarkup(
      createElement(CursorBuddyView, {
        overlayTracking: false,
        snapshot: {
          busy: false,
          phase: 'following',
          position: { x: 10, y: 20 },
        },
      }),
    );

    expect(overlayMarkup).toContain('cursor-buddy--overlay');
    expect(overlayMarkup).toContain('translate3d(10px, 20px, 0)');
    expect(nativeMarkup).not.toContain('cursor-buddy--overlay');
    expect(nativeMarkup).not.toContain('translate3d');
  });

  it('shows an accessible loading ring while Cursor Buddy is thinking', () => {
    const workingMarkup = renderToStaticMarkup(
      createElement(CursorBuddyView, {
        overlayTracking: false,
        snapshot: {
          busy: true,
          phase: 'thinking',
          position: { x: 0, y: 0 },
        },
      }),
    );
    const idleMarkup = renderToStaticMarkup(
      createElement(CursorBuddyView, {
        overlayTracking: false,
        snapshot: {
          busy: false,
          phase: 'following',
          position: { x: 0, y: 0 },
        },
      }),
    );

    expect(workingMarkup).toContain('Tro teaching cursor: Thinking');
    expect(workingMarkup).toContain('cursor-buddy--thinking');
    expect(workingMarkup).toContain('cursor-buddy--busy');
    expect(workingMarkup).toContain('cursor-buddy__loading');
    expect(idleMarkup).toContain('cursor-buddy--following');
    expect(idleMarkup).not.toContain('cursor-buddy--busy');
  });

  it('uses a transform-only spinner and leaves a static reduced-motion signal', () => {
    const css = readStylesheet(resolve(__dirname, '../index.css'));

    expect(css).toContain('@keyframes cursor-buddy-loading-spin');
    expect(css).toContain('transform: rotate(1turn);');
    expect(css).toMatch(
      /\.cursor-buddy--busy \.cursor-buddy__loading\s*\{[^}]*animation: cursor-buddy-loading-spin/u,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.cursor-buddy__loading[^{]*\{[^}]*animation: none;/u,
    );
    expect(css).not.toContain('cursor-buddy-visual-click');
  });

  it('subscribes to snapshots, renders updates, and cleans up', async () => {
    const container = document.createElement('div');
    const unsubscribe = vi.fn();
    let publishSnapshot:
      | ((snapshot: {
          busy: boolean;
          phase: 'demonstrating';
          position: { x: number; y: number };
        }) => void)
      | null = null;
    const onCursorBuddySnapshotChange = vi.fn((listener) => {
      publishSnapshot = listener;
      return unsubscribe;
    });
    Object.defineProperty(window, 'troCompanion', {
      configurable: true,
      value: {
        getCursorBuddySnapshot: vi.fn(async () => ({
          busy: false,
          phase: 'following',
          position: { x: 0, y: 0 },
        })),
        onCursorBuddySnapshotChange,
      } as unknown as CompanionApi,
    });
    let root: Root | null = null;

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(CursorBuddy, { overlayTracking: true }));
    });
    expect(onCursorBuddySnapshotChange).toHaveBeenCalledOnce();

    await act(async () => {
      publishSnapshot?.({
        busy: true,
        phase: 'demonstrating',
        position: { x: 31, y: 47 },
      });
    });
    expect(container.innerHTML).toContain('translate3d(31px, 47px, 0)');
    expect(container.innerHTML).toContain('cursor-buddy--demonstrating');
    expect(container.innerHTML).toContain('cursor-buddy--busy');

    await act(async () => root?.unmount());
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('requests the current snapshot after subscribing', async () => {
    const container = document.createElement('div');
    const callOrder: string[] = [];
    const getCursorBuddySnapshot = vi.fn(async () => {
      callOrder.push('request');
      return {
        busy: false,
        phase: 'following' as const,
        position: { x: 31, y: 47 },
      };
    });
    const onCursorBuddySnapshotChange = vi.fn(() => {
      callOrder.push('subscribe');
      return vi.fn();
    });
    Object.defineProperty(window, 'troCompanion', {
      configurable: true,
      value: {
        getCursorBuddySnapshot,
        onCursorBuddySnapshotChange,
      } as unknown as CompanionApi,
    });
    let root: Root | null = null;

    await act(async () => {
      root = createRoot(container);
      root.render(createElement(CursorBuddy, { overlayTracking: true }));
    });

    expect(callOrder).toEqual(['subscribe', 'request']);
    expect(container.innerHTML).toContain('translate3d(31px, 47px, 0)');

    await act(async () => root?.unmount());
  });
});
