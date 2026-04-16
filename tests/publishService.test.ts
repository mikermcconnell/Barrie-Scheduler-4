import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const {
  docMock,
  setDocMock,
  serverTimestampMock,
  uploadToMasterScheduleMock,
  buildRouteIdentityMock,
} = vi.hoisted(() => ({
  docMock: vi.fn(),
  setDocMock: vi.fn(),
  serverTimestampMock: vi.fn(() => 'server-timestamp'),
  uploadToMasterScheduleMock: vi.fn(),
  buildRouteIdentityMock: vi.fn((routeNumber: string, dayType: string) => `${routeNumber}-${dayType}`),
}));

vi.mock('firebase/firestore', () => ({
  doc: docMock,
  setDoc: setDocMock,
  serverTimestamp: serverTimestampMock,
}));

vi.mock('../utils/firebase', () => ({
  db: { name: 'db' },
}));

vi.mock('../utils/services/masterScheduleService', () => ({
  uploadToMasterSchedule: uploadToMasterScheduleMock,
}));

vi.mock('../utils/masterScheduleTypes', () => ({
  buildRouteIdentity: buildRouteIdentityMock,
}));

import { publishDraft, publishSystemDraft } from '../utils/services/publishService';

const makeTable = (routeName: string): MasterRouteTable => ({
  routeName,
  stops: ['Stop 1', 'Stop 2'],
  stopIds: { 'Stop 1': '1', 'Stop 2': '2' },
  trips: [],
});

beforeEach(() => {
  docMock.mockReset();
  setDocMock.mockReset();
  serverTimestampMock.mockClear();
  uploadToMasterScheduleMock.mockReset();
  buildRouteIdentityMock.mockClear();

  docMock.mockImplementation((_db: unknown, ...pathParts: string[]) => ({
    path: pathParts.join('/'),
  }));
  setDocMock.mockResolvedValue(undefined);
  uploadToMasterScheduleMock.mockResolvedValue({
    id: 'entry-1',
    routeNumber: '10',
    dayType: 'Weekday',
    currentVersion: 3,
    storagePath: 'teams/team-1/masterSchedules/10-Weekday_v3.json',
    tripCount: 2,
    northStopCount: 2,
    southStopCount: 2,
    updatedAt: new Date('2026-04-08T12:00:00Z'),
    updatedBy: 'user-1',
    uploaderName: 'Tester',
    source: 'draft',
  });
});

describe('publishDraft', () => {
  it('publishes using draft metadata when top-level fields are missing and writes published metadata', async () => {
    const result = await publishDraft({
      teamId: 'team-1',
      userId: 'user-1',
      publisherName: 'Tester',
      draft: {
        id: 'draft-123',
        routeNumber: '',
        dayType: '' as any,
        content: {
          northTable: makeTable('10 (Weekday) (North)'),
          southTable: makeTable('10 (Weekday) (South)'),
          metadata: {
            routeNumber: '10',
            dayType: 'Weekday',
            uploadedAt: '2026-04-08T10:00:00Z',
            cycleMode: 'Floating',
          },
        },
      } as any,
    });

    expect(uploadToMasterScheduleMock).toHaveBeenCalledWith(
      'team-1',
      'user-1',
      'Tester',
      expect.objectContaining({ routeName: '10 (Weekday) (North)' }),
      expect.objectContaining({ routeName: '10 (Weekday) (South)' }),
      '10',
      'Weekday',
      'draft',
      { cycleMode: 'Floating' }
    );
    expect(buildRouteIdentityMock).toHaveBeenCalledWith('10', 'Weekday');
    expect(docMock).toHaveBeenCalledWith({ name: 'db' }, 'teams', 'team-1', 'masterSchedules', '10-Weekday');
    expect(setDocMock).toHaveBeenCalledWith(
      { path: 'teams/team-1/masterSchedules/10-Weekday' },
      {
        publishedAt: 'server-timestamp',
        publishedBy: 'user-1',
        publishedFromDraft: 'draft-123',
        status: 'published',
      },
      { merge: true }
    );
    expect(result.routeIdentity).toBe('10-Weekday');
    expect(result.entry.id).toBe('entry-1');
    expect(result.publishedAt).toBeInstanceOf(Date);
  });

  it('throws when the draft has no content', async () => {
    await expect(
      publishDraft({
        teamId: 'team-1',
        userId: 'user-1',
        publisherName: 'Tester',
        draft: {
          id: 'draft-123',
          routeNumber: '10',
          dayType: 'Weekday',
        } as any,
      })
    ).rejects.toThrow('Draft content is required to publish.');

    expect(uploadToMasterScheduleMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('throws when it cannot resolve routeNumber and dayType', async () => {
    await expect(
      publishDraft({
        teamId: 'team-1',
        userId: 'user-1',
        publisherName: 'Tester',
        draft: {
          id: 'draft-123',
          routeNumber: '',
          dayType: '' as any,
          content: {
            northTable: makeTable('10 (Weekday) (North)'),
            southTable: makeTable('10 (Weekday) (South)'),
            metadata: {
              uploadedAt: '2026-04-08T10:00:00Z',
            },
          },
        } as any,
      })
    ).rejects.toThrow('Draft routeNumber and dayType are required to publish.');

    expect(uploadToMasterScheduleMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
  });
});

describe('publishSystemDraft', () => {
  it('returns a no-routes failure without publishing anything', async () => {
    const result = await publishSystemDraft({
      teamId: 'team-1',
      userId: 'user-1',
      publisherName: 'Tester',
      systemDraftId: 'system-draft-1',
      routes: [],
      dayType: 'Weekday',
    });

    expect(result).toEqual({
      success: false,
      publishedCount: 0,
      failedCount: 0,
      publishedRoutes: [],
      failedRoutes: [],
      error: 'No routes to publish',
    });
    expect(uploadToMasterScheduleMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('publishes successful routes and reports failed ones without stopping the batch', async () => {
    uploadToMasterScheduleMock
      .mockResolvedValueOnce({
        id: 'entry-1',
        routeNumber: '10',
        dayType: 'Weekday',
        currentVersion: 3,
        storagePath: 'teams/team-1/masterSchedules/10-Weekday_v3.json',
        tripCount: 2,
        northStopCount: 2,
        southStopCount: 2,
        updatedAt: new Date('2026-04-08T12:00:00Z'),
        updatedBy: 'user-1',
        uploaderName: 'Tester',
        source: 'draft',
      })
      .mockRejectedValueOnce(new Error('upload failed'));

    const result = await publishSystemDraft({
      teamId: 'team-1',
      userId: 'user-1',
      publisherName: 'Tester',
      systemDraftId: 'system-draft-1',
      routes: [
        {
          routeNumber: '10',
          northTable: makeTable('10 (Weekday) (North)'),
          southTable: makeTable('10 (Weekday) (South)'),
        },
        {
          routeNumber: '11',
          northTable: makeTable('11 (Weekday) (North)'),
          southTable: makeTable('11 (Weekday) (South)'),
        },
      ] as any,
      dayType: 'Weekday',
    });

    expect(uploadToMasterScheduleMock).toHaveBeenNthCalledWith(
      1,
      'team-1',
      'user-1',
      'Tester',
      expect.objectContaining({ routeName: '10 (Weekday) (North)' }),
      expect.objectContaining({ routeName: '10 (Weekday) (South)' }),
      '10',
      'Weekday',
      'draft'
    );
    expect(uploadToMasterScheduleMock).toHaveBeenNthCalledWith(
      2,
      'team-1',
      'user-1',
      'Tester',
      expect.objectContaining({ routeName: '11 (Weekday) (North)' }),
      expect.objectContaining({ routeName: '11 (Weekday) (South)' }),
      '11',
      'Weekday',
      'draft'
    );
    expect(result).toEqual({
      success: false,
      publishedCount: 1,
      failedCount: 1,
      publishedRoutes: [
        {
          routeNumber: '10',
          routeIdentity: '10-Weekday',
          entry: expect.objectContaining({ id: 'entry-1' }),
        },
      ],
      failedRoutes: [
        {
          routeNumber: '11',
          error: 'upload failed',
        },
      ],
      error: 'Failed to publish 1 route(s): 11',
    });
    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(setDocMock).toHaveBeenCalledWith(
      { path: 'teams/team-1/masterSchedules/10-Weekday' },
      {
        publishedAt: 'server-timestamp',
        publishedBy: 'user-1',
        publishedFromDraft: 'system-draft-1',
        status: 'published',
      },
      { merge: true }
    );
  });
});
