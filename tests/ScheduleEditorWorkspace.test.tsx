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
    <div
      data-testid="editor-shell"
      data-status={props.autoSaveStatus}
      data-unsaved={String(props.hasUnsavedChanges)}
      data-include-removed={String(props.includeRemovedMasterTripsWhenFiltered)}
      data-draft-name={props.draftName}
    >
      <button data-testid="change" onClick={() => props.onSchedulesChange?.(changedSchedules)}>change</button>
      <button data-testid="save" onClick={() => void props.onSaveVersion?.()}>save</button>
      <button data-testid="publish" onClick={() => void (props.onReviewChanges ?? props.onPublish)?.()}>publish</button>
      <button data-testid="close" onClick={() => void props.onClose?.()}>close</button>
      <button data-testid="duplicate" onClick={() => void props.onDuplicateDraft?.()}>duplicate</button>
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
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Publish Failed',
      'Save the draft successfully before publishing.',
    ));
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

  it('serializes overlapping saves and reuses the ID created by the first save', async () => {
    let resolveFirstSave!: (draftId: string) => void;
    saveDraftMock
      .mockReturnValueOnce(new Promise<string>(resolve => { resolveFirstSave = resolve; }))
      .mockResolvedValueOnce('created-draft');
    renderWorkspace({
      currentDraftId: undefined,
      currentDraftName: undefined,
      basedOn: { type: 'master', id: '10-Weekday', sourceVersion: 1 },
    });

    await vi.waitFor(() => expect(saveDraftMock).toHaveBeenCalledTimes(1));
    container?.querySelector('[data-testid="save"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(saveDraftMock).toHaveBeenCalledTimes(1);

    resolveFirstSave('created-draft');
    await vi.waitFor(() => expect(saveDraftMock).toHaveBeenCalledTimes(2));
    expect(saveDraftMock).toHaveBeenNthCalledWith(
      2,
      'user-1',
      expect.objectContaining({ id: 'created-draft' }),
    );
  });

  it('does not rename the current draft when duplicate creation fails', async () => {
    saveDraftMock.mockRejectedValueOnce(new Error('duplicate failed'));
    renderWorkspace();

    container?.querySelector('[data-testid="duplicate"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Duplicate Failed',
      'Unable to duplicate the current draft.',
    ));

    expect(saveDraftMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ id: undefined, name: 'Existing Draft (Copy)' }),
    );
    expect(container?.querySelector('[data-testid="editor-shell"]')?.getAttribute('data-draft-name'))
      .toBe('Existing Draft');
  });

  it('does not persist ready-for-review status when snapshot creation fails', async () => {
    saveDraftMock.mockResolvedValue('draft-1');
    createScheduleReviewMock.mockRejectedValueOnce(new Error('snapshot failed'));
    renderWorkspace();

    container?.querySelector('[data-testid="publish"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    const readyForReview = Array.from(container?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.includes('Ready for review'));
    readyForReview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(
      'Review Submission Failed',
      'Unable to create the team review snapshot.',
    ));
    expect(saveDraftMock).toHaveBeenCalledTimes(1);
    expect(saveDraftMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ status: 'draft' }),
    );
  });

  it('guards review submission against double clicks before the save finishes', async () => {
    let resolveSave!: (draftId: string) => void;
    saveDraftMock.mockReturnValueOnce(new Promise<string>(resolve => { resolveSave = resolve; }));
    renderWorkspace();
    container?.querySelector('[data-testid="publish"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    const readyForReview = Array.from(container?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.includes('Ready for review'));
    readyForReview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    readyForReview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(saveDraftMock).toHaveBeenCalledTimes(1);
    resolveSave('draft-1');
    await flushPromises();
  });

  it('guards publishing against double clicks while the pre-publish save is pending', async () => {
    let resolvePublishSave!: (draftId: string) => void;
    saveDraftMock
      .mockResolvedValueOnce('draft-1')
      .mockResolvedValueOnce('draft-1')
      .mockReturnValueOnce(new Promise<string>(resolve => { resolvePublishSave = resolve; }))
      .mockResolvedValueOnce('draft-1');
    publishDraftMock.mockResolvedValue({ routeIdentity: '10-Weekday' });
    renderWorkspace();

    container?.querySelector('[data-testid="publish"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    const note = container?.querySelector('#schedule-review-publish-note') as HTMLTextAreaElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    valueSetter?.call(note, 'Reviewed PM change');
    note.dispatchEvent(new Event('input', { bubbles: true }));
    const readyForReview = Array.from(container?.querySelectorAll('button') ?? [])
      .find(button => button.textContent?.includes('Ready for review'));
    readyForReview?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const confirmPublish = container?.querySelector('aside footer button:last-child') as HTMLButtonElement;
    await vi.waitFor(() => expect(confirmPublish.disabled).toBe(false));
    confirmPublish.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    confirmPublish.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(saveDraftMock).toHaveBeenCalledTimes(3);
    expect(publishDraftMock).not.toHaveBeenCalled();

    resolvePublishSave('draft-1');
    await vi.waitFor(() => expect(publishDraftMock).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(saveDraftMock).toHaveBeenCalledTimes(4));
    expect(saveDraftMock).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ status: 'draft' }),
    );
  });

  it('waits for a successful save before closing the editor', async () => {
    let resolveSave!: (draftId: string) => void;
    const onClose = vi.fn();
    saveDraftMock.mockReturnValueOnce(new Promise<string>(resolve => { resolveSave = resolve; }));
    renderWorkspace({ onClose });

    container?.querySelector('[data-testid="close"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    expect(onClose).not.toHaveBeenCalled();

    resolveSave('draft-1');
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('saves edits made during the first navigation save before closing', async () => {
    let resolveFirstSave!: (draftId: string) => void;
    let resolveSecondSave!: (draftId: string) => void;
    const onClose = vi.fn();
    saveDraftMock
      .mockReturnValueOnce(new Promise<string>(resolve => { resolveFirstSave = resolve; }))
      .mockReturnValueOnce(new Promise<string>(resolve => { resolveSecondSave = resolve; }));
    renderWorkspace({ onClose });

    container?.querySelector('[data-testid="close"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(saveDraftMock).toHaveBeenCalledTimes(1));
    flushSync(() => {
      container?.querySelector('[data-testid="change"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    resolveFirstSave('draft-1');

    await vi.waitFor(() => expect(saveDraftMock).toHaveBeenCalledTimes(2));
    expect(onClose).not.toHaveBeenCalled();
    resolveSecondSave('draft-1');
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('preserves source metadata and a stable uploaded timestamp across saves', async () => {
    saveDraftMock.mockResolvedValue('draft-1');
    renderWorkspace({
      initialContent: {
        ...initialContent,
        metadata: {
          ...initialContent.metadata,
          cycleMode: 'Floating',
          effectiveDate: '2026-09-01',
          notes: 'Fall service',
        },
      } as any,
    });

    const saveButton = container?.querySelector('[data-testid="save"]');
    saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(saveDraftMock).toHaveBeenCalledTimes(2));

    const firstMetadata = saveDraftMock.mock.calls[0][1].content.metadata;
    const secondMetadata = saveDraftMock.mock.calls[1][1].content.metadata;
    expect(firstMetadata).toMatchObject({
      uploadedAt: '2026-03-11T10:00:00Z',
      cycleMode: 'Floating',
      effectiveDate: '2026-09-01',
      notes: 'Fall service',
    });
    expect(secondMetadata).toEqual(firstMetadata);
  });

  it('warns on browser or tab close while schedule changes are unsaved', async () => {
    vi.useFakeTimers();
    saveDraftMock.mockResolvedValue('draft-1');
    renderWorkspace();
    await flushPromises();
    flushSync(() => {
      container?.querySelector('[data-testid="change"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    const dirtyUnload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(dirtyUnload)).toBe(false);
    expect(dirtyUnload.defaultPrevented).toBe(true);

    await vi.advanceTimersByTimeAsync(10000);
    await flushPromises();
    const savedUnload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(savedUnload)).toBe(true);
    expect(savedUnload.defaultPrevented).toBe(false);
  });

  it('includes removed master rows when the changed-only filter is active', async () => {
    saveDraftMock.mockResolvedValue('draft-1');
    renderWorkspace({
      currentDraftId: undefined,
      basedOn: { type: 'master', id: '10-Weekday', sourceVersion: 1 },
      initialContent: {
        ...initialContent,
        northTable: {
          ...initialContent.northTable,
          trips: [{
            id: 'removed-trip', blockId: '10-1', direction: 'North', tripNumber: 1, rowId: 1,
            startTime: 360, endTime: 390, recoveryTime: 5, travelTime: 30, cycleTime: 35,
            stops: { 'Stop 1': '6:00 AM' }, stopMinutes: { 'Stop 1': 360 },
          }],
        },
      } as any,
    });
    flushSync(() => {
      container?.querySelector('[data-testid="change"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    container?.querySelector('[data-testid="publish"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    let changedOnlyButton: Element | undefined;
    await vi.waitFor(() => {
      changedOnlyButton = Array.from(container?.querySelectorAll('button') ?? [])
        .find(button => button.textContent?.includes('Changed rows only'));
      expect(changedOnlyButton).toBeTruthy();
    });
    changedOnlyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(container?.querySelector('[data-testid="editor-shell"]')?.getAttribute('data-include-removed'))
      .toBe('true');
  });
});
