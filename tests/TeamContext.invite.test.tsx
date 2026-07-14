import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const {
  authState,
  getUserTeamMock,
  getUserTeamsMock,
  joinTeamByInviteCodeMock,
  getTeamMemberMock,
  switchUserTeamMock,
  getPendingInviteCodeMock,
  clearPendingInviteCodeFromUrlMock,
} = vi.hoisted(() => ({
  authState: {
    user: {
      uid: 'user-1',
      displayName: 'Lane User',
      email: 'lane.user@example.com',
    },
  },
  getUserTeamMock: vi.fn(),
  getUserTeamsMock: vi.fn(),
  joinTeamByInviteCodeMock: vi.fn(),
  getTeamMemberMock: vi.fn(),
  switchUserTeamMock: vi.fn(),
  getPendingInviteCodeMock: vi.fn(),
  clearPendingInviteCodeFromUrlMock: vi.fn(),
}));

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../utils/services/teamService', () => ({
  getUserTeam: getUserTeamMock,
  getUserTeams: getUserTeamsMock,
  joinTeamByInviteCode: joinTeamByInviteCodeMock,
  getTeamMember: getTeamMemberMock,
  switchUserTeam: switchUserTeamMock,
}));

vi.mock('../utils/inviteLinks', () => ({
  getPendingInviteCode: getPendingInviteCodeMock,
  clearPendingInviteCodeFromUrl: clearPendingInviteCodeFromUrlMock,
}));

vi.mock('../utils/dev/devAuth', () => ({
  getDevAuthConfig: () => ({
    enabled: false,
    teamInviteCode: null as string | null,
  }),
}));

import { TeamProvider, useTeam } from '../components/contexts/TeamContext';

function TeamProbe() {
  const { team, availableTeams, switchTeam, accessLevel, loading } = useTeam();
  return (
    <div
      data-loading={String(loading)}
      data-team={team?.id ?? 'none'}
      data-access={accessLevel}
      data-team-count={String(availableTeams.length)}
    >
      <button type="button" onClick={() => void switchTeam('developer')}>Switch team</button>
    </div>
  );
}

describe('TeamContext invite links', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    getUserTeamMock.mockReset();
    getUserTeamsMock.mockReset();
    joinTeamByInviteCodeMock.mockReset();
    getTeamMemberMock.mockReset();
    switchUserTeamMock.mockReset();
    getPendingInviteCodeMock.mockReset();
    clearPendingInviteCodeFromUrlMock.mockReset();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  });

  it('joins from a pending invite without replacing an existing active team', async () => {
    getPendingInviteCodeMock.mockReturnValue('JGKEM9');
    const barrieTeam = {
      id: 'barrie-transit',
      name: 'Barrie Transit',
      inviteCode: 'BARRIE',
    };
    const laneTeam = {
        id: 'lane-transit',
        name: 'Lane Transit',
        inviteCode: 'JGKEM9',
    };
    getUserTeamMock.mockResolvedValueOnce(barrieTeam);
    getUserTeamsMock.mockResolvedValueOnce([barrieTeam, laneTeam]);
    joinTeamByInviteCodeMock.mockResolvedValue('lane-transit');
    getTeamMemberMock.mockResolvedValue({
      id: 'user-1',
      userId: 'user-1',
      role: 'member',
      accessLevel: 'planner',
      joinedAt: new Date(),
      displayName: 'Lane User',
      email: 'lane.user@example.com',
    });

    await act(async () => {
      root.render(
        <TeamProvider>
          <TeamProbe />
        </TeamProvider>,
      );
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(joinTeamByInviteCodeMock).toHaveBeenCalledWith(
      'user-1',
      'JGKEM9',
      'Lane User',
      'lane.user@example.com',
      { activate: false },
    );
    expect(clearPendingInviteCodeFromUrlMock).toHaveBeenCalledOnce();
    expect(container.firstElementChild?.getAttribute('data-team')).toBe('barrie-transit');
    expect(container.firstElementChild?.getAttribute('data-access')).toBe('planner');
    expect(container.firstElementChild?.getAttribute('data-team-count')).toBe('2');
  });

  it('activates the invited team when the user has no active team yet', async () => {
    const laneTeam = {
      id: 'lane-transit',
      name: 'Lane Transit',
      inviteCode: 'JGKEM9',
    };
    getPendingInviteCodeMock.mockReturnValue('JGKEM9');
    getUserTeamMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(laneTeam);
    getUserTeamsMock.mockResolvedValueOnce([laneTeam]);
    joinTeamByInviteCodeMock.mockResolvedValue('lane-transit');
    getTeamMemberMock.mockResolvedValue({
      id: 'user-1',
      userId: 'user-1',
      role: 'member',
      accessLevel: 'external-planner',
      joinedAt: new Date(),
      displayName: 'Lane User',
      email: 'lane.user@example.com',
    });

    await act(async () => {
      root.render(
        <TeamProvider>
          <TeamProbe />
        </TeamProvider>,
      );
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(joinTeamByInviteCodeMock).toHaveBeenCalledWith(
      'user-1',
      'JGKEM9',
      'Lane User',
      'lane.user@example.com',
      { activate: true },
    );
    expect(container.firstElementChild?.getAttribute('data-team')).toBe('lane-transit');
    expect(container.firstElementChild?.getAttribute('data-access')).toBe('external-planner');
  });

  it('switches among available memberships and reloads the active team', async () => {
    const barrieTeam = { id: 'barrie-transit', name: 'Barrie Transit', inviteCode: 'BARRIE' };
    const developerTeam = { id: 'developer', name: 'Developer', inviteCode: 'DEV123' };
    getPendingInviteCodeMock.mockReturnValue(null);
    getUserTeamMock
      .mockResolvedValueOnce(barrieTeam)
      .mockResolvedValueOnce(developerTeam);
    getUserTeamsMock.mockResolvedValue([barrieTeam, developerTeam]);
    getTeamMemberMock
      .mockResolvedValueOnce({
        id: 'user-1', userId: 'user-1', role: 'member', accessLevel: 'planner',
        joinedAt: new Date(), displayName: 'Lane User', email: 'lane.user@example.com',
      })
      .mockResolvedValueOnce({
        id: 'user-1', userId: 'user-1', role: 'member', accessLevel: 'none',
        joinedAt: new Date(), displayName: 'Lane User', email: 'lane.user@example.com',
      });
    switchUserTeamMock.mockResolvedValue(undefined);

    await act(async () => {
      root.render(<TeamProvider><TeamProbe /></TeamProvider>);
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(switchUserTeamMock).toHaveBeenCalledWith('user-1', 'developer');
    expect(container.firstElementChild?.getAttribute('data-team')).toBe('developer');
    expect(container.firstElementChild?.getAttribute('data-access')).toBe('none');
  });
});
