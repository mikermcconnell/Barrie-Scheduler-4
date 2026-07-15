import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const { toast, saveDraftMock, publishDraftMock, createScheduleReviewMock } = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
  saveDraftMock: vi.fn(),
  publishDraftMock: vi.fn(),
  createScheduleReviewMock: vi.fn(),
}));

const teamContextState = vi.hoisted(() => ({
  team: { id: 'team-1' },
  canManageTeam: true,
}));

const initialContent = {
  northTable: {
    routeName: '10 (Weekday) (North)',
    stops: ['Stop 1'],
    stopIds: {},
    trips: [],
  },
  southTable: {
    routeName: '10 (Weekday) (South)',
    stops: ['Stop 1'],
    stopIds: {},
    trips: [],
  },
  metadata: {
    routeNumber: '10',
    dayType: 'Weekday',
    uploadedAt: '2026-03-11T10:00:00Z',
  },
} as const;

const changedSchedules = [
  {
    routeName: '10 (Weekday) (North)',
    stops: ['Stop 1', 'Stop 2'],
    stopIds: {},
    trips: [],
  },
  {
    routeName: '10 (Weekday) (South)',
    stops: ['Stop 1'],
    stopIds: {},
    trips: [],
  },
] as any;

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'user-1',
      displayName: 'Test User',
      email: 'test@example.com',
    },
  }),
}));

vi.mock('../components/contexts/TeamContext', () => ({
  useTeam: () => ({
    team: teamContextState.team,
    canManageTeam: teamContextState.canManageTeam,
  }),
}));

vi.mock('../components/contexts/ToastContext', () => ({
  useToast: () => toast,
}));

vi.mock('../components/ScheduleEditor', () => ({
  ScheduleEditor: (props: any) => (
    <div data-testid="editor-shell" data-status={props.autoSaveStatus} data-unsaved={String(props.hasUnsavedChanges)}>
      <button data-testid="change" onClick={() => props.onSchedulesChange?.(changedSchedules)}>change</button>
      <button data-testid="save" onClick={() => void props.onSaveVersion?.()}>save</button>
      <button data-testid="publish" onClick={() => void (props.onReviewChanges ?? props.onPublish)?.()}>publish</button>
    </div>
  ),
}));

vi.mock('../utils/services/draftService', () => ({
  saveDraft: saveDraftMock,
  createDraftCheckpoint: vi.fn(),
  getDraftCheckpoint: vi.fn(),
  listDraftCheckpoints: vi.fn().mockResolvedValue([]),
}));

vi.mock('../utils/services/publishService', () => ({
  publishDraft: publishDraftMock,
  StaleDraftPublishError: class StaleDraftPublishError extends Error {},
}));

vi.mock('../utils/services/scheduleReviewService', () => ({
  createScheduleReview: createScheduleReviewMock,
}));

vi.mock('../utils/services/masterScheduleService', () => ({
  getMasterSchedule: vi.fn(),
  getMasterScheduleEntry: vi.fn(),
  getVersionContent: vi.fn(),
}));

import { ScheduleEditorWorkspace } from '../components/workspaces/ScheduleEditorWorkspace';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ScheduleEditorWorkspace', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveDraftMock.mockReset();
    publishDraftMock.mockReset();
    createScheduleReviewMock.mockReset();
    createScheduleReviewMock.mockResolvedValue({ id: 'review-1' });
    toast.success.mockReset();
    toast.error.mockReset();
    toast.warning.mockReset();
    teamContextState.team = { id: 'team-1' };
    teamContextState.canManageTeam = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleErrorSpy.mockRestore();

    if (root) {
      flushSync(() => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
  });

  const renderWorkspace = (props?: Partial<React.ComponentProps<typeof ScheduleEditorWorkspace>>) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <ScheduleEditorWorkspace
          initialContent={initialContent as any}
          onClose={() => {}}
          currentDraftId="draft-1"
          currentDraftName="Existing Draft"
          currentDraftUpdatedAt={new Date('2026-03-11T09:00:00Z')}
          {...props}
        />
      );
    });
  };

  it('saves back into the currently opened draft id', async () => {
    saveDraftMock.mockResolvedValue('draft-1');
    renderWorkspace();

    const saveButton = container?.querySelector('[data-testid="save"]');
    saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(saveDraftMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        id: 'draft-1',
        name: 'Existing Draft',
      })
    );
  });

  it('flushes pending autosave work on unmount', async () => {
    vi.useFakeTimers();
    saveDraftMock.mockResolvedValue('draft-1');
    renderWorkspace();

    const changeButton = container?.querySelector('[data-testid="change"]');
    flushSync(() => {
      changeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(saveDraftMock).not.toHaveBeenCalled();

    flushSync(() => {
      root?.unmount();
    });
    root = null;

    await flushPromises();

    expect(saveDraftMock).toHaveBeenCalledTimes(1);
  });

  it('returns to a saved, clean state after autosave completes', async () => {
    vi.useFakeTimers();
    saveDraftMock.mockResolvedValue('draft-1');
    renderWorkspace();
    await flushPromises();

    const changeButton = container?.querySelector('[data-testid="change"]');

    flushSync(() => {
      changeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    await vi.advanceTimersByTimeAsync(10000);
    await flushPromises();

    expect(saveDraftMock).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('[data-testid="editor-shell"]')?.getAttribute('data-unsaved')).toBe('false');
  });

  it('blocks publish when the latest draft save fails', async () => {
    saveDraftMock
      .mockResolvedValueOnce('draft-1')
      .mockRejectedValueOnce(new Error('save failed'));
    renderWorkspace();

    const publishButton = container?.querySelector('[data-testid="publish"]');
    publishButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    const note = container?.querySelector('#schedule-review-publish-note') as HTMLTextAreaElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    valueSetter?.call(note, 'Test schedule changes');
    note.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    const readyForReview = Array.from(container?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.includes('Ready for review'));
    readyForReview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    const confirmPublish = container?.querySelector('aside footer button:last-child') as HTMLButtonElement;
    await vi.waitFor(() => {
      expect(confirmPublish.textContent).toContain('Publish new version');
      expect(confirmPublish.disabled).toBe(false);
    });
    confirmPublish?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(publishDraftMock).not.toHaveBeenCalled();
    expect(createScheduleReviewMock).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-1',
      draftId: 'draft-1',
      plannerNote: 'Test schedule changes',
    }));
    expect(toast.error).toHaveBeenCalledWith('Publish Failed', 'Save the draft successfully before publishing.');
  });

  it('blocks publish for team members without manage permissions', async () => {
    teamContextState.canManageTeam = false;
    saveDraftMock.mockResolvedValue('draft-1');
    renderWorkspace();

    const publishButton = container?.querySelector('[data-testid="publish"]');
    publishButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(publishDraftMock).not.toHaveBeenCalled();
    const confirmPublish = Array.from(container?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.includes('Publish new version')) as HTMLButtonElement;
    expect(confirmPublish.disabled).toBe(true);
  });

  it('does not mark edits made during review submission as reviewed', async () => {
    let resolveReview!: (value: { id: string }) => void;
    const reviewPromise = new Promise<{ id: string }>(resolve => { resolveReview = resolve; });
    saveDraftMock.mockResolvedValue('draft-1');
    createScheduleReviewMock.mockReturnValue(reviewPromise);
    renderWorkspace();

    container?.querySelector('[data-testid="publish"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    const readyForReview = Array.from(container?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.includes('Ready for review'));
    readyForReview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(createScheduleReviewMock).toHaveBeenCalledOnce());

    flushSync(() => {
      container?.querySelector('[data-testid="change"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    resolveReview({ id: 'review-1' });

    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      'Review Snapshot Outdated',
      'The schedule changed during submission. Review the latest changes and submit again.',
    ));
    expect(saveDraftMock).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ status: 'draft' }),
    );
    const confirmPublish = container?.querySelector('aside footer button:last-child') as HTMLButtonElement;
    expect(confirmPublish.disabled).toBe(true);
  });
});
