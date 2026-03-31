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

vi.mock('../utils/network-connections/networkConnectionHandoff', () => ({
  consumeNetworkConnectionEditorHandoff: (): null => null,
}));

import { FixedRouteWorkspace } from '../components/workspaces/FixedRouteWorkspace';

describe('FixedRouteWorkspace re-import entry', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.location.hash = '#fixed';
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
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain('Mock Performance Import');
    expect(window.location.hash).toBe('#fixed/performance-import');
  });
});
