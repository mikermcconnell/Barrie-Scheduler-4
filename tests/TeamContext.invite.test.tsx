import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const {
  authState,
  getUserTeamMock,
  joinTeamByInviteCodeMock,
  getTeamMemberMock,
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
  joinTeamByInviteCodeMock: vi.fn(),
  getTeamMemberMock: vi.fn(),
  getPendingInviteCodeMock: vi.fn(),
  clearPendingInviteCodeFromUrlMock: vi.fn(),
}));

vi.mock('../components/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('../utils/services/teamService', () => ({
  getUserTeam: getUserTeamMock,
  joinTeamByInviteCode: joinTeamByInviteCodeMock,
  getTeamMember: getTeamMemberMock,
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
  const { team, accessLevel, loading } = useTeam();
  return (
    <div
      data-loading={String(loading)}
      data-team={team?.id ?? 'none'}
      data-access={accessLevel}
    />
  );
}

describe('TeamContext invite links', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    getUserTeamMock.mockReset();
    joinTeamByInviteCodeMock.mockReset();
    getTeamMemberMock.mockReset();
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

  it('applies a pending invite even when the signed-in user already has another active team', async () => {
    getPendingInviteCodeMock.mockReturnValue('JGKEM9');
    getUserTeamMock
      .mockResolvedValueOnce({
        id: 'barrie-transit',
        name: 'Barrie Transit',
        inviteCode: 'BARRIE',
      })
      .mockResolvedValueOnce({
        id: 'lane-transit',
        name: 'Lane Transit',
        inviteCode: 'JGKEM9',
      });
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
    );
    expect(clearPendingInviteCodeFromUrlMock).toHaveBeenCalledOnce();
    expect(container.firstElementChild?.getAttribute('data-team')).toBe('lane-transit');
    expect(container.firstElementChild?.getAttribute('data-access')).toBe('external-planner');
  });
});
