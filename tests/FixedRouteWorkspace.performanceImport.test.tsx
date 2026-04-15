import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

vi.mock('../components/NewSchedule/NewScheduleWizard', () => ({
  NewScheduleWizard: (): React.ReactElement => React.createElement('div', null, 'Mock New Schedule Wizard'),
}));

vi.mock('../components/MasterScheduleBrowser', () => ({
  MasterScheduleBrowser: (): React.ReactElement => React.createElement('div', null, 'Mock Master Schedule Browser'),
}));

vi.mock('../components/workspaces/ScheduleEditorWorkspace', () => ({
  ScheduleEditorWorkspace: (): React.ReactElement => React.createElement('div', null, 'Mock Schedule Editor Workspace'),
}));

vi.mock('../components/workspaces/SystemDraftEditorWorkspace', () => ({
  SystemDraftEditorWorkspace: (): React.ReactElement => React.createElement('div', null, 'Mock System Draft Editor Workspace'),
}));

vi.mock('../components/Reports/ReportsDashboard', () => ({
  ReportsDashboard: (): React.ReactElement => React.createElement('div', null, 'Mock Reports Dashboard'),
}));

vi.mock('../components/Analytics/AnalyticsDashboard', () => ({
  AnalyticsDashboard: (): React.ReactElement => React.createElement('div', null, 'Mock Analytics Dashboard'),
}));

vi.mock('../components/GTFSImport', () => ({
  GTFSImportModal: (): null => null,
}));

vi.mock('../components/layout/SystemDraftList', () => ({
  SystemDraftList: (): React.ReactElement => React.createElement('div', null, 'Mock System Draft List'),
}));

vi.mock('../components/Performance/PerformanceImport', () => ({
  PerformanceImport: (): React.ReactElement => React.createElement('div', null, 'Mock Performance Import'),
}));

vi.mock('../components/TeamManagement', () => ({
  TeamManagement: (): React.ReactElement => React.createElement('div', null, 'Mock Team Management'),
}));

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
}));

vi.mock('../components/contexts/TeamContext', () => ({
  useTeam: () => ({
    team: { id: 'team-1', name: 'Team 1' },
    hasTeam: true,
    teamRole: 'owner',
    canManageTeam: true,
    loading: false,
    refreshTeam: async (): Promise<void> => undefined,
  }),
}));

vi.mock('../components/contexts/ToastContext', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../utils/services/draftService', () => ({
  getAllDrafts: vi.fn(),
  getDraft: vi.fn(),
  deleteDraft: vi.fn(),
}));

vi.mock('../utils/services/systemDraftService', () => ({
  getSystemDraft: vi.fn(),
}));

vi.mock('../utils/workspaces/fixedRouteDraftState', () => ({
  buildOpenDraftEditorState: vi.fn(),
  buildInitialSiblingEditorState: vi.fn(),
  getRemainingDraftsAfterBulkDelete: vi.fn(),
}));

const {
  loadFixedRouteResumeStateMock,
  saveFixedRouteResumeStateMock,
} = vi.hoisted(() => ({
  loadFixedRouteResumeStateMock: vi.fn(() => null),
  saveFixedRouteResumeStateMock: vi.fn(),
}));

vi.mock('../utils/workspaces/fixedRouteResumeState', () => ({
  loadFixedRouteResumeState: loadFixedRouteResumeStateMock,
  saveFixedRouteResumeState: saveFixedRouteResumeStateMock,
}));

vi.mock('../utils/network-connections/networkConnectionHandoff', () => ({
  consumeNetworkConnectionEditorHandoff: (): null => null,
}));

import { FixedRouteWorkspace } from '../components/workspaces/FixedRouteWorkspace';
import { getDraft } from '../utils/services/draftService';
import { buildOpenDraftEditorState } from '../utils/workspaces/fixedRouteDraftState';

async function flushLazyRender(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('FixedRouteWorkspace re-import entry', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.location.hash = '#fixed';
    loadFixedRouteResumeStateMock.mockReset();
    saveFixedRouteResumeStateMock.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
    window.location.hash = '';
  });

  it('shows a re-import data button on the fixed-route dashboard and opens the shared performance import flow', async () => {
    flushSync(() => {
      root.render(<FixedRouteWorkspace />);
    });

    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('Re-import Data'),
    ) as HTMLButtonElement | undefined;

    expect(button).toBeTruthy();

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushLazyRender();

    expect(container.textContent).toContain('Loading Performance Import...');
    expect(window.location.hash).toBe('#fixed/performance-import');
  });

  it('restores the last editor draft when returning through a saved fixed-route hash', async () => {
    window.location.hash = '#fixed/editor';
    loadFixedRouteResumeStateMock.mockReturnValue({
      hash: '#fixed/editor',
      label: 'Scheduled Transit · Draft 400',
      draftId: 'draft-400',
      updatedAt: '2026-04-10T12:00:00.000Z',
    });
    vi.mocked(getDraft).mockResolvedValue({
      id: 'draft-400',
      name: 'Draft 400',
      updatedAt: new Date('2026-04-10T12:00:00.000Z'),
      basedOn: { type: 'master', id: '400-Weekday' },
      content: {
        northTable: { routeName: '400 (Weekday) (North)', stops: ['A'], stopIds: {}, trips: [] },
        southTable: { routeName: '400 (Weekday) (South)', stops: ['A'], stopIds: {}, trips: [] },
        metadata: { routeNumber: '400', dayType: 'Weekday' },
      },
    } as any);
    vi.mocked(buildOpenDraftEditorState).mockReturnValue({
      initialContent: {
        northTable: { routeName: '400 (Weekday) (North)', stops: ['A'], stopIds: {}, trips: [] },
        southTable: { routeName: '400 (Weekday) (South)', stops: ['A'], stopIds: {}, trips: [] },
        metadata: { routeNumber: '400', dayType: 'Weekday' },
      } as any,
      basedOn: { type: 'master', id: '400-Weekday' },
      currentEditorDraftId: 'draft-400',
      currentEditorDraftName: 'Draft 400',
      currentEditorDraftUpdatedAt: new Date('2026-04-10T12:00:00.000Z'),
    });

    flushSync(() => {
      root.render(<FixedRouteWorkspace />);
    });

    await flushLazyRender();

    expect(getDraft).toHaveBeenCalledWith('user-1', 'draft-400');
    expect(container.textContent).toContain('Loading Schedule Editor...');
  });
});
