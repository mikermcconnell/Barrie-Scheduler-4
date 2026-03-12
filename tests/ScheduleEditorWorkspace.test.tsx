import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const { toast, saveDraftMock, publishDraftMock } = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
  saveDraftMock: vi.fn(),
  publishDraftMock: vi.fn(),
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
    team: {
      id: 'team-1',
    },
  }),
}));

vi.mock('../components/contexts/ToastContext', () => ({
  useToast: () => toast,
}));

vi.mock('../components/ScheduleEditor', () => ({
  ScheduleEditor: (props: any) => (
    <div>
      <button data-testid="change" onClick={() => props.onSchedulesChange?.(changedSchedules)}>change</button>
      <button data-testid="save" onClick={() => void props.onSaveVersion?.()}>save</button>
      <button data-testid="publish" onClick={() => void props.onPublish?.()}>publish</button>
    </div>
  ),
}));

vi.mock('../utils/services/draftService', () => ({
  saveDraft: saveDraftMock,
}));

vi.mock('../utils/services/publishService', () => ({
  publishDraft: publishDraftMock,
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
    toast.success.mockReset();
    toast.error.mockReset();
    toast.warning.mockReset();
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

  it('blocks publish when the latest draft save fails', async () => {
    saveDraftMock.mockRejectedValue(new Error('save failed'));
    renderWorkspace();

    const publishButton = container?.querySelector('[data-testid="publish"]');
    publishButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(publishDraftMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Publish Failed', 'Save the draft successfully before publishing.');
  });
});
