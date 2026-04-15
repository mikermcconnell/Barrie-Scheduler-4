import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const { toast, saveSystemDraftMock, publishSystemDraftMock } = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
  saveSystemDraftMock: vi.fn(),
  publishSystemDraftMock: vi.fn(),
}));

const initialSystemDraft = {
  id: 'system-draft-1',
  name: 'Weekday System QA',
  dayType: 'Weekday',
  routes: [
    {
      routeNumber: '10',
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
    },
  ],
  status: 'draft',
  createdBy: 'user-1',
  createdAt: new Date('2026-03-11T10:00:00Z'),
  updatedAt: new Date('2026-03-11T11:00:00Z'),
  routeCount: 1,
} as const;

const changedTables = [
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
    <div data-testid="editor-shell" data-status={props.autoSaveStatus} data-unsaved={String(props.hasUnsavedChanges)}>
      <button data-testid="change" onClick={() => props.onSchedulesChange?.(changedTables)}>change</button>
      <button data-testid="rename" onClick={() => props.onRenameDraft?.('Weekday System QA Renamed - Route 10')}>rename</button>
      <button data-testid="save" onClick={() => void props.onSaveVersion?.()}>save</button>
      <button data-testid="publish" onClick={() => void props.onPublish?.()}>publish</button>
    </div>
  ),
}));

vi.mock('../utils/services/systemDraftService', () => ({
  saveSystemDraft: saveSystemDraftMock,
  getSystemDraftRouteNumbers: (routes: Array<{ routeNumber: string }>) => routes.map(route => route.routeNumber),
}));

vi.mock('../utils/services/publishService', () => ({
  publishSystemDraft: publishSystemDraftMock,
}));

import { SystemDraftEditorWorkspace } from '../components/workspaces/SystemDraftEditorWorkspace';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('SystemDraftEditorWorkspace', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    saveSystemDraftMock.mockReset();
    publishSystemDraftMock.mockReset();
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

  const renderWorkspace = (props?: Partial<React.ComponentProps<typeof SystemDraftEditorWorkspace>>) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <SystemDraftEditorWorkspace
          systemDraft={initialSystemDraft as any}
          onClose={() => {}}
          {...props}
        />
      );
    });
  };

  it('saves back into the currently opened system draft id with the renamed base draft name', async () => {
    saveSystemDraftMock.mockResolvedValue('system-draft-1');
    renderWorkspace();

    const renameButton = container?.querySelector('[data-testid="rename"]');
    flushSync(() => {
      renameButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const saveButton = container?.querySelector('[data-testid="save"]');
    saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(saveSystemDraftMock).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        id: 'system-draft-1',
        name: 'Weekday System QA Renamed',
      })
    );
  });

  it('flushes pending autosave work on unmount', async () => {
    vi.useFakeTimers();
    saveSystemDraftMock.mockResolvedValue('system-draft-1');
    renderWorkspace();

    const changeButton = container?.querySelector('[data-testid="change"]');
    flushSync(() => {
      changeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(saveSystemDraftMock).not.toHaveBeenCalled();

    flushSync(() => {
      root?.unmount();
    });
    root = null;

    await flushPromises();

    expect(saveSystemDraftMock).toHaveBeenCalledTimes(1);
  });

  it('returns to a saved, clean state after autosave completes', async () => {
    vi.useFakeTimers();
    saveSystemDraftMock.mockResolvedValue('system-draft-1');
    renderWorkspace();
    await flushPromises();

    const changeButton = container?.querySelector('[data-testid="change"]');
    flushSync(() => {
      changeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    await vi.advanceTimersByTimeAsync(10000);
    await flushPromises();

    expect(saveSystemDraftMock).toHaveBeenCalledTimes(1);
    expect(container?.querySelector('[data-testid="editor-shell"]')?.getAttribute('data-unsaved')).toBe('false');
  });

  it('publishes after saving the latest system draft state', async () => {
    saveSystemDraftMock.mockResolvedValue('system-draft-1');
    publishSystemDraftMock.mockResolvedValue({
      success: true,
      publishedCount: 1,
      failedCount: 0,
      publishedRoutes: [],
      failedRoutes: [],
    });
    renderWorkspace();

    const publishButton = container?.querySelector('[data-testid="publish"]');
    publishButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();

    expect(saveSystemDraftMock).toHaveBeenCalled();
    expect(publishSystemDraftMock).toHaveBeenCalledWith(
      expect.objectContaining({
        systemDraftId: 'system-draft-1',
        dayType: 'Weekday',
      })
    );
  });
});
