// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  KnowledgeCapabilities,
  MembershipStatus,
  TaskUpdate,
  VoiceModeToggleEvent,
} from '../shared/contracts';
import type { DesktopApi } from '../shared/desktop-api';

import { App } from './App';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const TIMESTAMP = '2026-08-28T16:00:00.000Z';

const ACTIVE_TASK_UPDATE: TaskUpdate = {
  event: {
    artifacts: [],
    eventId: EVENT_ID,
    nextActions: [],
    phase: 'acting',
    status: 'success',
    summary: 'Tro is working on the task.',
    taskId: TASK_ID,
    timestamp: TIMESTAMP,
  },
  snapshot: {
    createdAt: TIMESTAMP,
    goal: null,
    lastEvent: {
      artifacts: [],
      eventId: EVENT_ID,
      nextActions: [],
      phase: 'acting',
      status: 'success',
      summary: 'Tro is working on the task.',
      taskId: TASK_ID,
      timestamp: TIMESTAMP,
    },
    messages: [],
    pendingInteraction: null,
    phase: 'acting',
    progress: null,
    queuedSteering: [],
    request: 'Keep the current workspace mounted',
    runtimeResume: null,
    taskId: TASK_ID,
    updatedAt: TIMESTAMP,
  },
};

const PERMISSION_TASK_UPDATE: TaskUpdate = {
  event: {
    ...ACTIVE_TASK_UPDATE.event,
    phase: 'awaiting_permission',
    summary: 'Computer permission is required before this action can run.',
  },
  snapshot: {
    ...ACTIVE_TASK_UPDATE.snapshot,
    lifecycle: {
      state: 'awaiting_permission',
      runVersion: 2,
      phase: 'awaiting_permission',
      terminal: false,
      availableActions: ['cancel'],
      waitingOn: {
        kind: 'permission',
        interactionId: '33333333-3333-4333-8333-333333333333',
        invocationId: '44444444-4444-4444-8444-444444444444',
        requiredPermissions: ['accessibility'],
        since: TIMESTAMP,
      },
      failure: null,
      cancellationSource: null,
    },
    phase: 'awaiting_permission',
  },
};

describe('App membership and settings safety', () => {
  let cancelTask: ReturnType<typeof vi.fn>;
  let container: HTMLDivElement;
  let root: Root;
  let signOut: ReturnType<typeof vi.fn<() => void>>;
  let taskUpdateListener: ((update: TaskUpdate) => void) | null;
  let updateAppPreferences: ReturnType<typeof vi.fn>;
  let voiceModeToggleListener:
    | ((event: VoiceModeToggleEvent) => void)
    | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    taskUpdateListener = null;
    voiceModeToggleListener = null;
    cancelTask = vi.fn();
    signOut = vi.fn<() => void>();
    updateAppPreferences = vi.fn(async (preferences) => preferences);

    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: {
        query: vi.fn().mockResolvedValue({ state: 'granted' }),
      },
    });
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function close(this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(
      () => undefined,
    );

    const unsubscribe = () => undefined;
    window.tro = {
      cancelTask,
      getAppPreferences: vi.fn().mockResolvedValue({
        appLanguage: 'en',
        classroomPetEnabled: true,
        muteSystemAudioWhileSpeaking: false,
        primaryLanguage: 'en',
        voiceMode: 'dictation',
      }),
      getAppUpdateStatus: vi.fn().mockResolvedValue({
        currentVersion: '0.1.8',
        message: 'Tro is up to date.',
        phase: 'up_to_date',
        targetVersion: null,
      }),
      getCompanionCustomizationStatus: vi.fn().mockResolvedValue({
        appearance: { kind: 'default' },
        candidate: null,
        quota: {
          limit: 5,
          periodEndsAt: '2026-09-01T00:00:00.000Z',
          periodStartsAt: '2026-08-01T00:00:00.000Z',
          remaining: 5,
          used: 0,
        },
        savedCompanions: [],
        state: 'available',
        summary: 'Companion generation is available.',
      }),
      getComputerStatus: vi.fn().mockResolvedValue({
        available: true,
        nextActions: [],
        permissions: { accessibility: true, screenRecording: true },
        platform: 'darwin',
        state: 'ready',
        summary: 'Computer access is ready.',
      }),
      getKnowledgeCapabilities: vi.fn().mockResolvedValue({
        knowledgeSpaces: { enabled: false, contractVersion: 2 },
      }),
      getMembershipStatus: vi.fn().mockResolvedValue({
        expiresAt: null,
        plan: 'free',
        referenceCode: null,
        required: true,
        state: 'active',
        summary: 'Free plan active.',
      }),
      getOrganization: vi.fn().mockResolvedValue({ organization: null }),
      getTeacherClassroom: vi.fn().mockResolvedValue(null),
      listKnowledgeSpaces: vi.fn().mockResolvedValue({
        classroomRole: 'teacher',
        items: [],
      }),
      onTeacherClassroomChanged: vi.fn().mockReturnValue(unsubscribe),
      getTaskHistory: vi.fn().mockResolvedValue({
        events: [],
        persistence: { mode: 'session_only', summary: 'Session only.' },
        snapshots: [],
      }),
      getUsageBudget: vi.fn().mockResolvedValue(null),
      getVoiceStatus: vi.fn().mockResolvedValue({
        model: 'gpt-transcribe',
        provider: 'openai',
        state: 'not_configured',
        summary: 'Voice is not configured.',
      }),
      getWorkspaceRuntimeAvailability: vi.fn().mockResolvedValue({
        available: false,
        runtimeVersion: null,
        summary: 'Workspace runtime is unavailable.',
      }),
      listConnectors: vi.fn().mockResolvedValue({
        catalog: [],
        connections: [],
        enabled: false,
      }),
      onAgentActivity: vi.fn().mockReturnValue(unsubscribe),
      onAppUpdateStatusChanged: vi.fn().mockReturnValue(unsubscribe),
      onTaskComposerFocusRequested: vi.fn().mockReturnValue(unsubscribe),
      onTaskUpdate: vi.fn((listener: (update: TaskUpdate) => void) => {
        taskUpdateListener = listener;
        return unsubscribe;
      }),
      onVoiceModeToggleRequested: vi.fn(
        (listener: (event: VoiceModeToggleEvent) => void) => {
          voiceModeToggleListener = listener;
          return unsubscribe;
        },
      ),
      onVoiceShortcut: vi.fn().mockReturnValue(unsubscribe),
      setCompanionVoiceActivity: vi.fn().mockResolvedValue(undefined),
      setVoiceAudioDucking: vi.fn().mockResolvedValue(undefined),
      updateAppPreferences,
    } as unknown as DesktopApi;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const membership = (state: MembershipStatus['state']): MembershipStatus => ({
    expiresAt: null,
    plan: state === 'active' ? 'pro' : null,
    referenceCode: null,
    required: true,
    state,
    summary: state === 'active' ? 'Pro plan active.' : 'Access required.',
  });

  async function renderApp(): Promise<void> {
    await act(async () => {
      root.render(
        <App
          currentUser={{
            email: 'teacher@example.com',
            id: 'teacher',
            name: 'Teacher',
          }}
          isSigningOut={false}
          onSignOut={signOut}
        />,
      );
    });
  }

  async function focusApp(): Promise<void> {
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
  }

  it.each(['inactive', 'expired', 'error'] as const)(
    'does not request classroom data while membership is checking or %s',
    async (state) => {
      let resolveMembership!: (status: MembershipStatus) => void;
      vi.mocked(window.tro.getMembershipStatus).mockReturnValue(
        new Promise((resolve) => {
          resolveMembership = resolve;
        }),
      );
      vi.mocked(window.tro.getKnowledgeCapabilities).mockResolvedValue({
        knowledgeSpaces: { enabled: true, contractVersion: 2 },
      });

      await renderApp();
      await focusApp();
      expect(window.tro.getTeacherClassroom).not.toHaveBeenCalled();
      expect(window.tro.getKnowledgeCapabilities).not.toHaveBeenCalled();
      expect(window.tro.listKnowledgeSpaces).not.toHaveBeenCalled();

      await act(async () => resolveMembership(membership(state)));
      await focusApp();
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(window.tro.getTeacherClassroom).not.toHaveBeenCalled();
      expect(window.tro.onTeacherClassroomChanged).not.toHaveBeenCalled();
      expect(window.tro.getKnowledgeCapabilities).not.toHaveBeenCalled();
      expect(window.tro.listKnowledgeSpaces).not.toHaveBeenCalled();
    },
  );

  it('loads classroom data immediately after code activation without restarting startup services', async () => {
    vi.mocked(window.tro.getMembershipStatus).mockResolvedValue(
      membership('inactive'),
    );
    vi.mocked(window.tro.getKnowledgeCapabilities).mockResolvedValue({
      knowledgeSpaces: { enabled: true, contractVersion: 2 },
    });
    window.tro.activateMembership = vi
      .fn()
      .mockResolvedValue(membership('active'));
    await renderApp();

    const input = container.querySelector<HTMLTextAreaElement>(
      '#activation-code',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!
        .set!.call(input, 'TRO-TEST-CODE');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const activate = container.querySelector<HTMLButtonElement>(
      '.membership-actions .primary-button',
    )!;
    expect(activate.disabled).toBe(false);
    await act(async () => activate.click());

    expect(window.tro.activateMembership).toHaveBeenCalledWith({
      code: 'TRO-TEST-CODE',
    });
    expect(window.tro.getTeacherClassroom).toHaveBeenCalledOnce();
    expect(window.tro.getKnowledgeCapabilities).toHaveBeenCalledOnce();
    expect(window.tro.listKnowledgeSpaces).toHaveBeenCalledOnce();
    expect(window.tro.getTaskHistory).toHaveBeenCalledOnce();
    expect(window.tro.onTaskUpdate).toHaveBeenCalledOnce();

    vi.mocked(window.tro.getMembershipStatus).mockResolvedValue(
      membership('active'),
    );
    await focusApp();
    expect(window.tro.getTeacherClassroom).toHaveBeenCalledOnce();
    expect(window.tro.listKnowledgeSpaces).toHaveBeenCalledTimes(2);
  });

  it('stops refreshes and ignores delayed capabilities after membership becomes inactive', async () => {
    let resolveCapabilities!: (value: KnowledgeCapabilities) => void;
    vi.mocked(window.tro.getKnowledgeCapabilities).mockReturnValue(
      new Promise((resolve) => {
        resolveCapabilities = resolve;
      }),
    );
    const stopTeacher = vi.fn();
    vi.mocked(window.tro.onTeacherClassroomChanged).mockReturnValue(stopTeacher);
    await renderApp();
    expect(window.tro.getTeacherClassroom).toHaveBeenCalledOnce();
    expect(window.tro.getKnowledgeCapabilities).toHaveBeenCalledOnce();

    vi.mocked(window.tro.getMembershipStatus).mockResolvedValue(
      membership('inactive'),
    );
    await focusApp();
    expect(stopTeacher).toHaveBeenCalledOnce();
    const capabilityCalls = vi.mocked(window.tro.getKnowledgeCapabilities)
      .mock.calls.length;
    await act(async () => {
      resolveCapabilities({
        knowledgeSpaces: { enabled: true, contractVersion: 2 },
      });
    });
    await focusApp();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(window.tro.getKnowledgeCapabilities).toHaveBeenCalledTimes(
      capabilityCalls,
    );
    expect(window.tro.listKnowledgeSpaces).not.toHaveBeenCalled();
    expect(container.querySelector('.membership-screen')).not.toBeNull();

    vi.mocked(window.tro.getKnowledgeCapabilities).mockResolvedValue({
      knowledgeSpaces: { enabled: true, contractVersion: 2 },
    });
    vi.mocked(window.tro.getMembershipStatus).mockResolvedValue(
      membership('active'),
    );
    await focusApp();
    expect(window.tro.getTeacherClassroom).toHaveBeenCalledTimes(2);
    expect(window.tro.listKnowledgeSpaces).toHaveBeenCalledOnce();
  });

  it('keeps an active workspace mounted and isolates Escape while Settings closes', async () => {
    await act(async () => {
      root.render(
        <App
          currentUser={{
            email: 'student@example.com',
            id: 'preview-user',
            name: 'Student',
          }}
          isSigningOut={false}
          onSignOut={signOut}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector('#task')).not.toBeNull();
    const sidebarAccount = container.querySelector('.sidebar-account');
    expect(sidebarAccount?.textContent).toContain('Student');
    expect(sidebarAccount?.textContent).toContain('student@example.com');
    expect(sidebarAccount?.textContent).toContain('Sign out');
    expect(container.querySelector('.topbar .account-chip')).toBeNull();
    expect(container.querySelector('.topbar .sign-out-button')).toBeNull();
    await act(async () =>
      sidebarAccount
        ?.querySelector<HTMLButtonElement>('.sidebar-account__sign-out')
        ?.click(),
    );
    expect(signOut).toHaveBeenCalledOnce();

    await act(async () => taskUpdateListener?.(ACTIVE_TASK_UPDATE));

    const settingsTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    await act(async () => settingsTrigger?.click());

    const dialog = container.querySelector('dialog');
    expect(dialog?.open).toBe(true);
    expect(container.querySelector('#task')).not.toBeNull();

    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Escape',
        }),
      ),
    );
    expect(cancelTask).not.toHaveBeenCalled();

    await act(async () =>
      dialog?.dispatchEvent(new Event('cancel', { cancelable: true })),
    );
    expect(container.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(settingsTrigger);
    expect(container.querySelector('#task')).not.toBeNull();
    expect(cancelTask).not.toHaveBeenCalled();
  });

  it('renders the exact system permission instead of a hardcoded permission pair', async () => {
    await act(async () => {
      root.render(
        <App
          currentUser={{
            email: 'student@example.com',
            id: 'preview-user',
            name: 'Student',
          }}
          isSigningOut={false}
          onSignOut={signOut}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => taskUpdateListener?.(PERMISSION_TASK_UPDATE));

    const permissionCard = container.querySelector('.pending-interaction');
    expect(permissionCard?.textContent).toContain(
      'Accessibility permission required',
    );
    expect(permissionCard?.textContent).toContain(
      'Open system settings to grant access',
    );
    expect(permissionCard?.textContent).not.toContain('Screen Recording');
  });

  it('shows, switches, and persists the top-bar voice mode', async () => {
    await act(async () => {
      root.render(
        <App
          currentUser={{
            email: 'student@example.com',
            id: 'preview-user',
            name: 'Student',
          }}
          isSigningOut={false}
          onSignOut={signOut}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const writeMode = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Write my words"]',
    );
    const askMode = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Ask Tro"]',
    );
    expect(writeMode?.getAttribute('aria-pressed')).toBe('true');
    expect(askMode?.getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('Hold');
    expect(container.textContent).toContain('Switch');

    await act(async () => {
      askMode?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(askMode?.getAttribute('aria-pressed')).toBe('true');
    expect(updateAppPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ voiceMode: 'task' }),
    );

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: '\\',
          metaKey: true,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(writeMode?.getAttribute('aria-pressed')).toBe('true');
    expect(updateAppPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ voiceMode: 'dictation' }),
    );

    await act(async () => {
      voiceModeToggleListener?.({ source: 'global' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(askMode?.getAttribute('aria-pressed')).toBe('true');
    expect(updateAppPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ voiceMode: 'task' }),
    );
    expect(window.tro.setCompanionVoiceActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'task',
        phase: 'mode_selected',
      }),
    );
  });
});
