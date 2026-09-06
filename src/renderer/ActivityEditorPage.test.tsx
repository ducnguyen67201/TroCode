// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KnowledgeSourceList, PreparedKnowledgeActivity } from '../shared/contracts';
import type { DesktopApi } from '../shared/desktop-api';

import { ActivityEditorPage } from './ActivityEditorPage';

const SPACE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const prepared: PreparedKnowledgeActivity = {
  title: 'Welcome a customer', objective: 'Listen and respond with empathy.',
  instructions: 'Role-play greeting a customer. Ask how you can help.',
  criteria: [{ id: 'check-1', title: 'Listen first', description: 'Respond to what the customer says.', tags: [] }],
};
const source: KnowledgeSourceList['items'][number] = {
  id: SOURCE, displayName: 'Customer service guide', relativePath: 'guide.md', role: 'reference',
  createdAt: '2026-09-06T00:00:00Z',
  latestVersion: { id: VERSION, state: 'ready', mediaType: 'text/markdown', byteSize: 400,
    createdAt: '2026-09-06T00:00:00Z', errorCode: null },
};

describe('Activity authoring', () => {
  let root: Root;
  let container: HTMLDivElement;
  let onPublished: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    onPublished = vi.fn();
    window.tro = {
      prepareKnowledgeActivity: vi.fn().mockResolvedValue(prepared),
      saveKnowledgeActivity: vi.fn().mockResolvedValue({ id: SPACE }),
      publishKnowledgeActivity: vi.fn().mockResolvedValue({ id: VERSION }),
    } as unknown as DesktopApi;
    await act(async () => root.render(<ActivityEditorPage appLanguage="en" spaceId={SPACE}
      sources={[source, { ...source, id: 'processing', displayName: 'Still processing',
        latestVersion: { ...source.latestVersion!, id: 'pending', state: 'processing' } },
      { ...source, id: 'private', displayName: 'Learner submission', role: 'submission' }]}
      onPublished={onPublished} />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  const button = (text: string) => Array.from(container.querySelectorAll('button'))
    .find((item) => item.textContent?.includes(text))!;
  const input = (label: string) => Array.from(container.querySelectorAll('label'))
    .find((item) => item.textContent?.trim().startsWith(label))!
    .querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')!;
  async function type(label: string, value: string) {
    await act(async () => {
      const element = input(label);
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function prepare() {
    await type('Describe the activity', 'Practice greeting a customer and listening carefully.');
    await act(async () => button('Prepare activity').click());
  }

  it('starts with a description and optional collapsed settings, not internal fields', () => {
    expect(button('Prepare activity').disabled).toBe(true);
    expect(container.textContent).not.toContain('criterion-id');
    expect(container.textContent).not.toContain('Guided debugging');
    expect(container.textContent).not.toContain('Pinned source versions');
    expect(Array.from(container.querySelectorAll('details')).every((item) => !item.open)).toBe(true);
    expect(container.textContent).not.toContain('Still processing');
    expect(container.textContent).not.toContain('Learner submission');
  });

  it('prepares an editable preview with selected materials without saving or publishing', async () => {
    await act(async () => input('Customer service guide').click());
    await prepare();
    expect(window.tro.prepareKnowledgeActivity).toHaveBeenCalledWith(expect.objectContaining({
      spaceId: SPACE, sourceVersionIds: [VERSION], language: 'en',
      description: 'Practice greeting a customer and listening carefully.',
    }));
    expect(container.querySelector('article')?.textContent).toContain('Listen first');
    expect(window.tro.saveKnowledgeActivity).not.toHaveBeenCalled();
    expect(window.tro.publishKnowledgeActivity).not.toHaveBeenCalled();
    expect(onPublished).not.toHaveBeenCalled();
    await act(async () => button('Edit content').click());
    await type('Activity name', 'A friendly first impression');
    await act(async () => button('Publish Activity').click());
    expect(window.tro.saveKnowledgeActivity).toHaveBeenCalledWith(expect.objectContaining({
      sourceVersionIds: [VERSION], definition: expect.objectContaining({
        title: 'A friendly first impression', launchTarget: 'none',
        guidancePolicy: { hintMode: 'guided', answerReveal: 'after_attempt', maxHintLevel: 3 },
        sessionPolicy: { allowRoomJoin: true, allowedOrigins: [] },
      }),
    }));
    expect(onPublished).toHaveBeenCalledOnce();
  });

  it('preserves custom help and completion choices through preparation and publication', async () => {
    await act(async () => {
      input('Ask learners to submit a file').click();
    });
    await act(async () => {
      const help = Array.from(container.querySelectorAll('select'))[1];
      help.value = 'socratic';
      help.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await prepare();
    await act(async () => button('Publish Activity').click());
    expect(window.tro.saveKnowledgeActivity).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({
        guidancePolicy: expect.objectContaining({ hintMode: 'socratic' }),
        completionPolicy: { requiresSubmission: true, requiresFacilitatorConfirmation: true },
      }),
    }));
  });

  it('keeps edited draft content when returning to the description', async () => {
    await prepare();
    await act(async () => button('Edit content').click());
    await type('Activity name', 'My edited activity');
    await act(async () => button('Back to description').click());
    await type('Describe the activity', '');
    expect(button('Return to draft').disabled).toBe(false);
    await act(async () => button('Return to draft').click());
    expect(container.querySelector('article')?.textContent).toContain('My edited activity');
    expect(window.tro.prepareKnowledgeActivity).toHaveBeenCalledOnce();
  });

  it('keeps the description on generation failure and supports writing without generation', async () => {
    vi.mocked(window.tro.prepareKnowledgeActivity).mockRejectedValue(new Error('Drafting unavailable'));
    await prepare();
    expect(input('Describe the activity').value).toContain('Practice greeting');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Drafting unavailable');
    await act(async () => button('Write it myself').click());
    await type('Activity name', 'Customer practice');
    await act(async () => button('Save draft').click());
    expect(window.tro.saveKnowledgeActivity).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({ title: 'Customer practice',
        instructions: 'Practice greeting a customer and listening carefully.' }),
    }));
    expect(window.tro.prepareKnowledgeActivity).toHaveBeenCalledOnce();
    expect(window.tro.publishKnowledgeActivity).not.toHaveBeenCalled();
  });

  it('prevents overlapping prepares and keeps publishing busy through both network calls', async () => {
    let resolvePrepare!: (value: PreparedKnowledgeActivity) => void;
    vi.mocked(window.tro.prepareKnowledgeActivity).mockReturnValue(new Promise((resolve) => { resolvePrepare = resolve; }));
    await type('Describe the activity', 'Practice a skill.');
    const prepareButton = button('Prepare activity');
    await act(async () => { prepareButton.click(); prepareButton.click(); });
    expect(window.tro.prepareKnowledgeActivity).toHaveBeenCalledOnce();
    await act(async () => resolvePrepare(prepared));
    let resolvePublish!: (value: Awaited<ReturnType<DesktopApi['publishKnowledgeActivity']>>) => void;
    vi.mocked(window.tro.publishKnowledgeActivity).mockReturnValue(new Promise((resolve) => { resolvePublish = resolve; }));
    await act(async () => button('Publish Activity').click());
    expect(container.querySelector<HTMLFieldSetElement>('.activity-authoring__body')?.disabled).toBe(true);
    expect(window.tro.saveKnowledgeActivity).toHaveBeenCalledOnce();
    await act(async () => resolvePublish({ id: VERSION, versionNumber: 1,
      newlyCreated: true, publishedAt: '2026-09-06T00:00:00Z' }));
    expect(onPublished).toHaveBeenCalledOnce();
  });

  it('rejects unsafe automatic website choices before saving', async () => {
    await type('Websites Tro may open automatically', 'http://localhost:8080');
    await prepare();
    await act(async () => button('Publish Activity').click());
    expect(window.tro.saveKnowledgeActivity).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('public HTTPS');
  });
});
