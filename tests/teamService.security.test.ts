import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  collectionMock,
  docMock,
  setDocMock,
  getDocMock,
  getDocsMock,
  deleteDocMock,
  queryMock,
  whereMock,
  updateDocMock,
  writeBatchMock,
  serverTimestampMock,
} = vi.hoisted(() => ({
  collectionMock: vi.fn(),
  docMock: vi.fn(),
  setDocMock: vi.fn(),
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  deleteDocMock: vi.fn(),
  queryMock: vi.fn(),
  whereMock: vi.fn(),
  updateDocMock: vi.fn(),
  writeBatchMock: vi.fn(),
  serverTimestampMock: vi.fn(() => 'server-timestamp'),
}));

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  doc: docMock,
  setDoc: setDocMock,
  getDoc: getDocMock,
  getDocs: getDocsMock,
  deleteDoc: deleteDocMock,
  query: queryMock,
  where: whereMock,
  serverTimestamp: serverTimestampMock,
  updateDoc: updateDocMock,
  writeBatch: writeBatchMock,
  Timestamp: class {},
}));

vi.mock('../utils/firebase', () => ({
  db: { name: 'db' },
}));

import {
  createTeam,
  createPartnerTeam,
  deleteTeam,
  getUserTeam,
  joinTeamByInviteCode,
  removeMember,
  updateTeamDefaultMemberAccessLevel,
} from '../utils/services/teamService';

describe('teamService security-sensitive flows', () => {
  beforeEach(() => {
    collectionMock.mockReset();
    docMock.mockReset();
    setDocMock.mockReset();
    getDocMock.mockReset();
    getDocsMock.mockReset();
    deleteDocMock.mockReset();
    queryMock.mockReset();
    whereMock.mockReset();
    updateDocMock.mockReset();
    writeBatchMock.mockReset();
    serverTimestampMock.mockClear();

    setDocMock.mockResolvedValue(undefined);
    updateDocMock.mockResolvedValue(undefined);
    getDocMock.mockResolvedValue({
      exists: () => false,
    });
    getDocsMock.mockResolvedValue({ docs: [], empty: true });
    collectionMock.mockImplementation((_db: unknown, ...segments: string[]) => ({
      path: segments.join('/'),
    }));
    docMock.mockImplementation((parent: unknown, ...segments: string[]) => {
      if (typeof parent === 'object' && parent && 'path' in parent && segments.length === 0) {
        return { id: 'generated-team', path: `${(parent as { path: string }).path}/generated-team` };
      }
      return {
        id: segments[segments.length - 1] ?? 'generated-id',
        path: [typeof parent === 'string' ? parent : '', ...segments].filter(Boolean).join('/'),
      };
    });
  });

  it('creates a public invite lookup document when creating a team', async () => {
    await createTeam('user-1', 'Ops Team', 'Owner', 'owner@example.com');

    expect(setDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringMatching(/^teamInvites\//) }),
      expect.objectContaining({
        teamId: 'generated-team',
        teamName: 'Ops Team',
      })
    );
  });

  it('treats a stale user.teamId without a membership doc as no active team', async () => {
    getDocMock
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ teamId: 'team-1' }),
      })
      .mockResolvedValueOnce({
        exists: () => false,
      });

    const result = await getUserTeam('user-1');

    expect(result).toBeNull();
    expect(updateDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/user-1' }),
      { teamId: null }
    );
  });

  it('treats a stale user.teamId with a missing team doc as no active team', async () => {
    getDocMock
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ teamId: 'team-1' }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ userId: 'user-1' }),
      })
      .mockResolvedValueOnce({
        exists: () => false,
      });

    const result = await getUserTeam('user-1');

    expect(result).toBeNull();
    expect(updateDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/user-1' }),
      { teamId: null }
    );
  });

  it('deletes the invite lookup when deleting a team', async () => {
    const batchDeleteMock = vi.fn();
    const batchCommitMock = vi.fn().mockResolvedValue(undefined);
    writeBatchMock.mockReturnValue({
      delete: batchDeleteMock,
      commit: batchCommitMock,
    });

    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ inviteCode: 'ABC123' }),
    });
    getDocsMock.mockResolvedValue({ docs: [] });

    await deleteTeam('team-1');

    expect(batchDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teamInvites/ABC123' })
    );
  });

  it('defaults newly joined members to planner workspace access', async () => {
    getDocMock
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ teamId: 'team-1', teamName: 'Ops Team' }),
      })
      .mockResolvedValueOnce({
        exists: () => false,
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ name: 'Ops Team' }),
      });

    await joinTeamByInviteCode('user-2', 'ABC123', 'New User', 'new@example.com');

    expect(setDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/team-1/members/user-2' }),
      expect.objectContaining({
        role: 'member',
        accessLevel: 'planner',
      })
    );
  });

  it('rejects malformed invite codes before reading Firestore paths', async () => {
    await expect(
      joinTeamByInviteCode('user-2', 'BAD/01', 'New User', 'new@example.com')
    ).rejects.toThrow('Invalid invite code');

    expect(getDocMock).not.toHaveBeenCalled();
  });

  it('uses the team default access level for newly joined members', async () => {
    getDocMock
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ teamId: 'lane-transit', teamName: 'Lane Transit' }),
      })
      .mockResolvedValueOnce({
        exists: () => false,
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ name: 'Lane Transit', defaultMemberAccessLevel: 'external-planner' }),
      });

    await joinTeamByInviteCode('lane-user', 'LANE01', 'Lane User', 'lane@example.com');

    expect(setDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/lane-transit/members/lane-user' }),
      expect.objectContaining({
        role: 'member',
        accessLevel: 'external-planner',
      })
    );
  });

  it('does not give newly created team owners internal workspace access by default', async () => {
    await createTeam('user-1', 'Lane Transit', 'Owner', 'owner@example.com');

    expect(setDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/generated-team/members/user-1' }),
      expect.objectContaining({
        role: 'owner',
        accessLevel: 'planner',
      })
    );
  });

  it('allows changing the team default member access level', async () => {
    await updateTeamDefaultMemberAccessLevel('lane-transit', 'external-planner');

    expect(updateDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/lane-transit' }),
      { defaultMemberAccessLevel: 'external-planner' }
    );
  });

  it('creates a partner team without moving the current admin into that team', async () => {
    const batchSetMock = vi.fn();
    const batchCommitMock = vi.fn().mockResolvedValue(undefined);
    writeBatchMock.mockReturnValue({
      set: batchSetMock,
      commit: batchCommitMock,
    });
    getDocMock.mockResolvedValue({
      exists: () => false,
    });

    const result = await createPartnerTeam({
      createdBy: 'admin-user',
      teamName: 'Lane Transit',
      inviteCode: 'LANE01',
      defaultMemberAccessLevel: 'external-planner',
    });

    expect(result).toEqual({
      teamId: 'generated-team',
      inviteCode: 'LANE01',
    });
    expect(batchSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/generated-team' }),
      expect.objectContaining({
        name: 'Lane Transit',
        createdBy: 'admin-user',
        inviteCode: 'LANE01',
        defaultMemberAccessLevel: 'external-planner',
      })
    );
    expect(batchSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teamInvites/LANE01' }),
      expect.objectContaining({
        teamId: 'generated-team',
        teamName: 'Lane Transit',
      })
    );
    expect(batchCommitMock).toHaveBeenCalledOnce();
    expect(setDocMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users/admin-user' }),
      expect.anything(),
      expect.anything()
    );
    expect(setDocMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/generated-team/members/admin-user' }),
      expect.anything()
    );
  });

  it('removes membership without trying to edit another user profile', async () => {
    await removeMember('team-1', 'user-2');

    expect(deleteDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/team-1/members/user-2' })
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });
});
