import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { DesktopObservation, SurfaceActionOutcome } from '../agent/execution-contracts';

import { desktopLessonFixture } from './classroom-desktop-teaching.fixture';
import { LessonBlockedError } from './classroom-lesson-errors';
import { ClassroomLessonOpeningService } from './classroom-lesson-opening-service';
import type { ClassroomLessonSurfaceService } from './classroom-lesson-surface-service';
import { isMaterialAppChooser, materialChooserAction } from './classroom-material-chooser-policy';

function chooser(): DesktopObservation {
  return { ...desktopLessonFixture().observation, observationId: randomUUID(),
    surface: { kind: 'native_app', application: 'OpenWith.exe', title: 'Select an app to open this .md file' },
    text: 'Select an app to open this .md file',
    elements: [{ ref: 'e1', role: 'list item', name: 'Notepad' }, { ref: 'e2', role: 'button', name: 'Just once' }, { ref: 'e3', role: 'button', name: 'Always' }],
  };
}
type Probe = Awaited<ReturnType<ClassroomLessonSurfaceService['inspectOpening']>>;
const pending = (observation?: DesktopObservation): Probe => ({ ready: false, observation, error: new LessonBlockedError('surface_unverified', 'Not yet visible.') });

function fixture() {
  const f = desktopLessonFixture();
  const inspectOpening = vi.fn<() => Promise<Probe>>().mockResolvedValue(pending());
  const executeSurfaceCommand = vi.fn<(...args: unknown[]) => Promise<SurfaceActionOutcome>>().mockResolvedValue({ status: 'confirmed', summary: 'Clicked.' });
  const authorize = vi.fn(async () => undefined);
  const consume = vi.fn(async () => undefined);
  const recordEffect = vi.fn(async (effect: typeof f.state.effect) => { void effect; });
  const wait = vi.fn(async () => undefined);
  const service = new ClassroomLessonOpeningService({ surfaces: { inspectOpening }, cua: { executeSurfaceCommand }, authorize, consume, wait });
  return { ...f, service, inspectOpening, executeSurfaceCommand, authorize, consume, recordEffect, wait };
}

describe('computer-use material opening', () => {
  it('selects Notepad, clicks Just once and waits for verified material before completing', async () => {
    const f = fixture();
    const first = chooser();
    const next = { ...first, observationId: randomUUID() };
    f.inspectOpening.mockResolvedValueOnce(pending(first)).mockResolvedValueOnce(pending(next))
      .mockResolvedValueOnce(pending()).mockResolvedValueOnce({ ready: true, observation: f.observation });
    await f.service.complete(f.state, 'python.md', new AbortController().signal, f.recordEffect);
    expect(f.executeSurfaceCommand.mock.calls.map((args) => [args[1], args[2]])).toEqual([
      [first.observationId, { kind: 'click_element', ref: 'e1', button: 'left', count: 1 }],
      [next.observationId, { kind: 'click_element', ref: 'e2', button: 'left', count: 1 }],
    ]);
    expect(f.recordEffect.mock.calls.flat()).toEqual(['dispatching', 'confirmed', 'dispatching', 'confirmed']);
    expect(f.recordEffect.mock.invocationCallOrder[0]).toBeLessThan(f.executeSurfaceCommand.mock.invocationCallOrder[0]!);
    expect(f.inspectOpening).toHaveBeenCalledTimes(4);
    expect(f.state.desktopControlConsent).toBeFalsy(); // opening is covered by accepting the lesson, independently of navigation
  });

  it('re-observes after a stale target and uses the new element reference', async () => {
    const f = fixture();
    const first = chooser();
    const next = chooser(); next.elements![0]!.ref = 'e9';
    f.inspectOpening.mockResolvedValueOnce(pending(first)).mockResolvedValueOnce(pending(next))
      .mockResolvedValueOnce({ ready: true, observation: f.observation });
    f.executeSurfaceCommand.mockResolvedValueOnce({ status: 'not_executed', summary: 'Target changed.' });
    await f.service.complete(f.state, 'python.md', new AbortController().signal, f.recordEffect);
    expect(f.executeSurfaceCommand.mock.calls[1]?.[2]).toMatchObject({ ref: 'e9' });
  });

  it.each(['unknown', 'throw'] as const)('journals an %s click and never retries it', async (failure) => {
    const f = fixture();
    f.inspectOpening.mockResolvedValue(pending(chooser()));
    if (failure === 'unknown') f.executeSurfaceCommand.mockResolvedValueOnce({ status: 'unknown', summary: 'Lost acknowledgement.' });
    else f.executeSurfaceCommand.mockRejectedValueOnce(new Error('Lost connection.'));
    await expect(f.service.complete(f.state, 'python.md', new AbortController().signal, f.recordEffect)).rejects.toThrow('uncertain');
    expect(f.executeSurfaceCommand).toHaveBeenCalledOnce();
    expect(f.recordEffect).toHaveBeenLastCalledWith('unknown');
  });

  it('does not finish just because clicks succeeded or repeat a confirmed click', async () => {
    const f = fixture();
    f.inspectOpening.mockResolvedValue(pending(chooser()));
    await expect(f.service.complete(f.state, 'python.md', new AbortController().signal, f.recordEffect)).rejects.toMatchObject({ reason: 'surface_unverified' });
    expect(f.executeSurfaceCommand).toHaveBeenCalledTimes(2);
    expect(f.inspectOpening).toHaveBeenCalledTimes(8);
    expect(f.wait.mock.calls.length).toBe(7);
  });

  it('stops before dispatch when consent is revoked after observation', async () => {
    const f = fixture();
    f.inspectOpening.mockResolvedValue(pending(chooser()));
    f.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Lesson stopped.'));
    await expect(f.service.complete(f.state, 'python.md', new AbortController().signal, f.recordEffect)).rejects.toThrow('stopped');
    expect(f.executeSurfaceCommand).not.toHaveBeenCalled();
  });

  it('cancels while waiting for a slow app without another observation or action', async () => {
    const f = fixture(); const abort = new AbortController();
    f.wait.mockImplementationOnce(async () => { abort.abort(); });
    await expect(f.service.complete(f.state, 'python.md', abort.signal, f.recordEffect)).rejects.toThrow();
    expect(f.inspectOpening).toHaveBeenCalledOnce();
    expect(f.executeSurfaceCommand).not.toHaveBeenCalled();
  });

  it('does not select apps for an already-open-window lesson or a web URL', async () => {
    const f = fixture();
    f.inspectOpening.mockResolvedValueOnce(pending(chooser())).mockResolvedValueOnce({ ready: true, observation: f.observation });
    await f.service.complete(f.state, undefined, new AbortController().signal, f.recordEffect);
    expect(f.executeSurfaceCommand).not.toHaveBeenCalled();
  });
});

describe('observed app chooser policy', () => {
  it('clears Windows 10 Always use before selecting or confirming an app', () => {
    const screen = chooser();
    screen.surface!.title = 'How do you want to open this file?';
    screen.elements!.push({ ref: 'e4', role: 'checkbox', name: 'Always use this app to open .md files', selected: true });
    expect(materialChooserAction(screen, 'python.md')).toMatchObject({ kind: 'unset_default', element: { ref: 'e4' } });
    screen.elements![3]!.selected = false;
    expect(materialChooserAction(screen, 'python.md')).toMatchObject({ kind: 'select_app' });
    delete screen.elements![3]!.selected;
    expect(materialChooserAction(screen, 'python.md')).toBeUndefined();
  });

  it('supports an observed macOS application picker and a PDF viewer', () => {
    const screen = chooser();
    screen.surface = { kind: 'native_app', application: 'CoreServicesUIAgent', title: 'Choose Application for lesson.pdf' };
    screen.text = 'Choose Application for lesson.pdf';
    screen.elements = [{ ref: 'e1', role: 'AXRow', name: 'Preview.app', selected: true }, { ref: 'e2', role: 'AXButton', name: 'Open' }];
    expect(materialChooserAction(screen, 'lesson.pdf')).toMatchObject({ kind: 'open_once', element: { ref: 'e2' } });
  });

  it('can reveal more installed apps but never searches the store or changes the default', () => {
    const screen = chooser();
    screen.elements = [{ ref: 'e1', role: 'button', name: 'More apps' }, { ref: 'e2', role: 'button', name: 'Search the Microsoft Store' }];
    expect(materialChooserAction(screen, 'python.md')).toMatchObject({ kind: 'more_apps' });
    screen.elements = [screen.elements[1]!];
    expect(materialChooserAction(screen, 'python.md')).toBeUndefined();
    screen.elements = [{ ref: 'e1', role: 'list item', name: 'Notepad', selected: true }, { ref: 'e2', role: 'button', name: 'Always' }];
    expect(materialChooserAction(screen, 'python.md')).toBeUndefined();
  });

  it('rejects unrelated apps, files, disabled targets and executable formats', () => {
    const screen = chooser();
    expect(materialChooserAction(screen, 'lesson.pdf')).toBeUndefined();
    expect(materialChooserAction(screen, 'program.exe')).toBeUndefined();
    screen.elements![0]!.disabled = true;
    expect(materialChooserAction(screen, 'python.md')).toBeUndefined();
    screen.surface!.application = 'Google Chrome';
    expect(isMaterialAppChooser(screen)).toBe(false);
    expect(materialChooserAction(screen, 'python.md')).toBeUndefined();
  });
});
