import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

const {
  authState,
  teamState,
  toastMock,
  getTeamWithMembersMock,
  getTeamsMock,
  updateTeamWorkspaceAccessMock,
  updateMemberWorkspaceAccessMock,
} = vi.hoisted(() => ({
  authState: {
    user: { uid: 'owner-1', displayName: 'Owner', email: 'owner@example.com', getIdToken: vi.fn() },
    isGlobalAdmin: false,
  },
  teamState: {
    team: { id: 'barrie', name: 'Barrie Transit' } as unknown,
    actualTeam: { id: 'barrie', name: 'Barrie Transit' } as unknown,
    developerPreview: null as unknown,
    refreshTeam: vi.fn().mockResolvedValue(undefined),
    startDeveloperPreview: vi.fn(),
    stopDeveloperPreview: vi.fn(),
  },
  toastMock: { success: vi.fn(), error: vi.fn() },
  getTeamWithMembersMock: vi.fn(),
  getTeamsMock: vi.fn(),
  updateTeamWorkspaceAccessMock: vi.fn(),
  updateMemberWorkspaceAccessMock: vi.fn(),
}));

vi.mock('../components/contexts/AuthContext', () => ({ useAuth: () => authState }));
vi.mock('../components/contexts/TeamContext', () => ({ useTeam: () => teamState }));
vi.mock('../components/contexts/ToastContext', () => ({ useToast: () => toastMock }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../utils/services/dataService', () => ({
  getAllFiles: vi.fn().mockResolvedValue([]),
  getAllUploadedFilesForAdmin: vi.fn().mockResolvedValue([]),
}));
vi.mock('../utils/services/teamService', () => ({
  getTeamWithMembers: getTeamWithMembersMock,
  getTeamsForPermissionManagement: getTeamsMock,
  updateTeamWorkspaceAccess: updateTeamWorkspaceAccessMock,
  updateMemberWorkspaceAccess: updateMemberWorkspaceAccessMock,
  updateTeamDataSourceTeamIds: vi.fn(),
  createTeam: vi.fn(),
  createPartnerTeam: vi.fn(),
  joinTeamByInviteCode: vi.fn(),
  leaveTeam: vi.fn(),
  removeMember: vi.fn(),
  renameTeam: vi.fn(),
  deleteTeam: vi.fn(),
  regenerateInviteCode: vi.fn(),
  setInviteCode: vi.fn(),
}));

import { TeamManagement } from '../components/TeamManagement';

const member = (id: string, accessLevel: string, role = 'member', extra: Record<string, unknown> = {}) => ({
  id,
  userId: id,
  role,
  accessLevel,
  joinedAt: new Date(0),
  displayName: `User ${id}`,
  email: `${id}@example.com`,
  ...extra,
});

const buildTeam = (overrides: Record<string, unknown> = {}) => ({
  id: 'barrie',
  name: 'Barrie Transit',
  createdAt: new Date(0),
  createdBy: 'owner-1',
  inviteCode: 'BARRIE',
  defaultMemberAccessLevel: 'planner',
  members: [
    member('owner-1', 'planner', 'owner'),
    member('analyst', 'planner'),
    member('clerk', 'parking'),
  ],
  memberCount: 3,
  ...overrides,
});

describe('TeamManagement', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (): Promise<void> => {
    await act(async () => {
      root.render(<TeamManagement fullScreen onClose={vi.fn()} />);
    });
  };

  const click = async (element: Element | null | undefined): Promise<void> => {
    if (!element) throw new Error('Element not found');
    await act(async () => {
      (element as HTMLElement).click();
    });
  };

  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.trim() === label);

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    authState.isGlobalAdmin = false;
    authState.user.email = 'owner@example.com';
    teamState.startDeveloperPreview.mockClear();
    teamState.team = { id: 'barrie', name: 'Barrie Transit' };
    teamState.actualTeam = { id: 'barrie', name: 'Barrie Transit' };
    teamState.developerPreview = null;
    getTeamWithMembersMock.mockReset().mockResolvedValue(buildTeam());
    getTeamsMock.mockReset().mockResolvedValue([]);
    updateTeamWorkspaceAccessMock.mockReset().mockResolvedValue({ updatedMemberIds: ['owner-1', 'analyst'], exceptionMemberIds: ['clerk'] });
    updateMemberWorkspaceAccessMock.mockReset().mockResolvedValue(undefined);
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows team owners members but no workspace access controls, with exceptions labelled', async () => {
    await render();

    const tabLabels = Array.from(container.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(tabLabels).not.toContain('Access');
    expect(tabLabels).not.toContain('Set exception…');
    expect(tabLabels).not.toContain('Files');
    expect(tabLabels).not.toContain('Developer Tools');
    expect(container.textContent).not.toContain('Support');
    expect(container.textContent).toContain('Custom: Parking only');
    // the two followers carry no badge
    expect(container.textContent?.match(/Custom:/g)).toHaveLength(1);
  });

  it('saves a new team package and reports how many members followed', async () => {
    authState.isGlobalAdmin = true;
    authState.user.email = 'mike.mcconnell@barrie.ca';
    await render();
    await click(button('Access'));

    const select = container.querySelector('#team-access-package') as HTMLSelectElement;
    expect(select.value).toBe('barrie-planner');

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(select, 'transit-app-streets');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.textContent).toContain('Unsaved change.');
    expect(container.textContent).toContain('Applies immediately to 2 members.');
    expect(container.textContent).toContain('1 with an exception is not affected.');

    await click(button('Save access'));

    expect(updateTeamWorkspaceAccessMock).toHaveBeenCalledWith(
      'barrie',
      'transit-app-only',
      { workspaceOperations: true },
    );
    expect(toastMock.success).toHaveBeenCalledWith('Team access saved. 2 members updated.');
  });

  it('sets a member exception to a package without touching the team default', async () => {
    authState.isGlobalAdmin = true;
    authState.user.email = 'mike.mcconnell@barrie.ca';
    await render();

    // owner row is first, analyst second; the clerk already has an exception
    const setException = Array.from(container.querySelectorAll('button'))
      .filter(candidate => candidate.textContent?.trim() === 'Set exception…')[1];
    await click(setException);

    const parkingOption = Array.from(document.body.querySelectorAll('label'))
      .find(label => label.textContent?.includes('Parking only'));
    await click(parkingOption?.querySelector('input'));
    await click(Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Save'));

    expect(updateMemberWorkspaceAccessMock).toHaveBeenCalledWith('barrie', 'analyst', 'parking', undefined);
    expect(updateTeamWorkspaceAccessMock).not.toHaveBeenCalled();
  });

  it('gives global admins the directory, Support menu, and Files tab', async () => {
    authState.isGlobalAdmin = true;
    getTeamsMock.mockResolvedValue([
      { id: 'barrie', name: 'Barrie Transit', inviteCode: 'BARRIE' },
      { id: 'lane', name: 'Lane Transit', inviteCode: 'JGKEM9' },
    ]);
    await render();

    const labels = Array.from(container.querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(labels).toContain('Files');
    expect(labels).toContain('Support');
    expect(labels).toContain('New team');
    expect(container.textContent).toContain('Lane Transit');
    expect(labels).not.toContain('Developer Tools');
    expect(labels).not.toContain('Data Sources');
  });

  it('keeps other scheduler admins read-only for access and edit sessions', async () => {
    authState.isGlobalAdmin = true;
    await render();

    expect(button('Set exception…')).toBeUndefined();
    await click(button('Access'));
    expect((container.querySelector('#team-access-package') as HTMLSelectElement).disabled).toBe(true);

    await click(button('Support'));
    expect(container.textContent).toContain('Inspect');
    expect(container.textContent).not.toContain('Start edit session');
  });

  it('starts an edit session for the primary developer without asking for a reason', async () => {
    authState.isGlobalAdmin = true;
    authState.user.email = 'mike.mcconnell@barrie.ca';
    const promptSpy = vi.spyOn(window, 'prompt');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await render();

    await click(button('Support'));
    await click(Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Start edit session')));

    expect(promptSpy).not.toHaveBeenCalled();
    expect(teamState.startDeveloperPreview).toHaveBeenCalledWith(expect.objectContaining({ mode: 'edit' }));
    expect(teamState.startDeveloperPreview.mock.calls[0][0]).not.toHaveProperty('reason');
    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it('hides the access overview from team owners', async () => {
    await render();

    expect(button('Access overview')).toBeUndefined();
  });

  it('gives global admins an access overview of every team that can open a team', async () => {
    authState.isGlobalAdmin = true;
    getTeamsMock.mockResolvedValue([
      { id: 'barrie', name: 'Barrie Transit', inviteCode: 'BARRIE' },
      { id: 'lane', name: 'Lane Transit', inviteCode: 'JGKEM9' },
    ]);
    getTeamWithMembersMock.mockImplementation(async (teamId: string) => teamId === 'lane'
      ? buildTeam({ id: 'lane', name: 'Lane Transit', inviteCode: 'JGKEM9', defaultMemberAccessLevel: 'external-planner', members: [], memberCount: 0 })
      : buildTeam());
    await render();

    await click(button('Access overview'));

    expect(container.textContent).toContain('Who sees what');
    expect(container.textContent).toContain('Lane Transit');
    expect(container.textContent).toContain('1 team has no members');
    expect(container.textContent).toContain('User clerk');

    const openButtons = Array.from(container.querySelectorAll('button')).filter(b => b.textContent?.trim() === 'Open');
    await click(openButtons[1]);

    expect(container.textContent).not.toContain('Who sees what');
    expect(container.querySelector('h2')?.textContent).toBe('Lane Transit');
  });

  it('renders every assignable workspace with a label in the unlock list', async () => {
    authState.isGlobalAdmin = true;
    getTeamWithMembersMock.mockResolvedValue(buildTeam({ defaultMemberAccessLevel: 'internal' }));
    await render();
    await click(button('Access'));

    expect(container.textContent).toContain('Street Design Studio');
    expect(container.textContent).not.toContain('analyticsStreetDesignStudio');
  });
});
