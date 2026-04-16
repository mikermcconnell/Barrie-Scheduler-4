import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const {
  collectionMock,
  docMock,
  setDocMock,
  getDocMock,
  getDocsMock,
  deleteDocMock,
  queryMock,
  orderByMock,
  limitMock,
  serverTimestampMock,
  runTransactionMock,
  transactionGetMock,
  transactionSetMock,
  refMock,
  uploadBytesMock,
  getDownloadURLMock,
  deleteObjectMock,
  getBytesMock,
} = vi.hoisted(() => ({
  collectionMock: vi.fn(),
  docMock: vi.fn(),
  setDocMock: vi.fn(),
  getDocMock: vi.fn(),
  getDocsMock: vi.fn(),
  deleteDocMock: vi.fn(),
  queryMock: vi.fn(),
  orderByMock: vi.fn(),
  limitMock: vi.fn(),
  serverTimestampMock: vi.fn(() => 'server-timestamp'),
  runTransactionMock: vi.fn(),
  transactionGetMock: vi.fn(),
  transactionSetMock: vi.fn(),
  refMock: vi.fn(),
  uploadBytesMock: vi.fn(),
  getDownloadURLMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  getBytesMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  doc: docMock,
  setDoc: setDocMock,
  getDoc: getDocMock,
  getDocs: getDocsMock,
  deleteDoc: deleteDocMock,
  query: queryMock,
  orderBy: orderByMock,
  limit: limitMock,
  serverTimestamp: serverTimestampMock,
  runTransaction: runTransactionMock,
  Timestamp: class {},
}));

vi.mock('firebase/storage', () => ({
  ref: refMock,
  uploadBytes: uploadBytesMock,
  getDownloadURL: getDownloadURLMock,
  deleteObject: deleteObjectMock,
  getBytes: getBytesMock,
}));

vi.mock('../utils/firebase', () => ({
  db: { name: 'db' },
  storage: { name: 'storage' },
}));

import { buildRouteIdentity } from '../utils/masterScheduleTypes';
import {
  prepareUpload,
  uploadToMasterSchedule,
} from '../utils/services/masterScheduleService';

const northTable: MasterRouteTable = {
  routeName: '2 Weekday North',
  stops: ['Park Place', 'Downtown Hub'],
  stopIds: {
    'Park Place': '777',
    'Downtown Hub': '2',
  },
  trips: [],
};

const southTable: MasterRouteTable = {
  routeName: '2 Weekday South',
  stops: ['Downtown Hub', 'Park Place'],
  stopIds: {
    'Downtown Hub': '2',
    'Park Place': '777',
  },
  trips: [],
};

function makeEntryData(currentVersion: number) {
  return {
    routeNumber: '2',
    dayType: 'Weekday',
    cycleMode: 'Floating',
    currentVersion,
    storagePath: `teams/team-1/masterSchedules/2-Weekday_v${currentVersion}.json`,
    tripCount: 4,
    northStopCount: 2,
    southStopCount: 2,
    updatedAt: new Date('2026-04-08T12:00:00Z'),
    updatedBy: 'user-1',
    uploaderName: 'Planner',
    source: 'draft',
  };
}

beforeEach(() => {
  collectionMock.mockReset();
  docMock.mockReset();
  setDocMock.mockReset();
  getDocMock.mockReset();
  getDocsMock.mockReset();
  deleteDocMock.mockReset();
  queryMock.mockReset();
  orderByMock.mockReset();
  limitMock.mockReset();
  serverTimestampMock.mockClear();
  runTransactionMock.mockReset();
  transactionGetMock.mockReset();
  transactionSetMock.mockReset();
  refMock.mockReset();
  uploadBytesMock.mockReset();
  getDownloadURLMock.mockReset();
  deleteObjectMock.mockReset();
  getBytesMock.mockReset();

  collectionMock.mockReturnValue({ path: 'teams/team-1/masterSchedules' });
  docMock.mockImplementation((_db: unknown, ...segments: string[]) => ({
    id: segments[segments.length - 1] ?? 'generated',
    path: segments.join('/'),
  }));
  refMock.mockImplementation((_storage: unknown, path: string) => ({ path }));
  uploadBytesMock.mockResolvedValue(undefined);
  setDocMock.mockResolvedValue(undefined);
  deleteObjectMock.mockResolvedValue(undefined);
  runTransactionMock.mockImplementation(async (_db: unknown, callback: (transaction: { get: typeof getDocMock; set: typeof setDocMock }) => Promise<unknown>) => {
    const transaction = {
      get: transactionGetMock,
      set: transactionSetMock,
    };
    return callback(transaction);
  });
});

describe('prepareUpload', () => {
  it('returns the next version number and counts existing versions', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: '2-Weekday',
      data: () => makeEntryData(3),
    });
    getDocsMock.mockResolvedValueOnce({ size: 3 });

    const result = await prepareUpload(
      'team-1',
      northTable as any,
      southTable as any,
      '2',
      'Weekday'
    );

    expect(result).toEqual({
      routeIdentity: buildRouteIdentity('2', 'Weekday'),
      routeNumber: '2',
      dayType: 'Weekday',
      existingEntry: expect.objectContaining({
        id: '2-Weekday',
        currentVersion: 3,
      }),
      existingVersionCount: 3,
      willBumpVersion: true,
      newVersionNumber: 4,
      tripCount: 0,
      northStopCount: 2,
      southStopCount: 2,
    });
  });
});

describe('uploadToMasterSchedule', () => {
  it('increments the version, uploads the content, and writes the master entry', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => makeEntryData(4),
    });
    transactionGetMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => makeEntryData(4),
    });
    getBytesMock.mockResolvedValueOnce(new TextEncoder().encode('{}'));

    const result = await uploadToMasterSchedule(
      'team-1',
      'user-1',
      'Planner',
      northTable as any,
      southTable as any,
      '2',
      'Weekday',
      'draft',
      { cycleMode: 'Floating' }
    );

    expect(result.currentVersion).toBe(5);
    expect(result.routeNumber).toBe('2');
    expect(result.dayType).toBe('Weekday');

    expect(uploadBytesMock).toHaveBeenCalledTimes(1);
    const [storageRefArg, contentBytes, options] = uploadBytesMock.mock.calls[0];
    expect(storageRefArg).toEqual({
      path: 'teams/team-1/masterSchedules/2-Weekday_v5.json',
    });
    expect(options).toEqual({ contentType: 'application/json' });

    const uploadedJson = new TextDecoder().decode(contentBytes as Uint8Array);
    expect(JSON.parse(uploadedJson)).toEqual({
      northTable,
      southTable,
      metadata: {
        routeNumber: '2',
        dayType: 'Weekday',
        uploadedAt: expect.any(String),
        cycleMode: 'Floating',
      },
    });

    expect(runTransactionMock).toHaveBeenCalledTimes(1);
    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'teams/team-1/masterSchedules/2-Weekday/versions/5',
      }),
      expect.objectContaining({
        versionNumber: 5,
        storagePath: 'teams/team-1/masterSchedules/2-Weekday_v5.json',
        createdBy: 'user-1',
        uploaderName: 'Planner',
        source: 'draft',
        tripCount: 0,
      })
    );
    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'teams/team-1/masterSchedules/2-Weekday',
      }),
      expect.objectContaining({
        routeNumber: '2',
        dayType: 'Weekday',
        currentVersion: 5,
        storagePath: 'teams/team-1/masterSchedules/2-Weekday_v5.json',
        tripCount: 0,
        northStopCount: 2,
        southStopCount: 2,
        updatedBy: 'user-1',
        uploaderName: 'Planner',
        source: 'draft',
      })
    );
  });

  it('omits cycleMode from Firestore writes when no cycle mode is provided', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => false,
      data: (): undefined => undefined,
    });
    transactionGetMock.mockResolvedValueOnce({
      exists: () => false,
      data: (): undefined => undefined,
    });

    const result = await uploadToMasterSchedule(
      'team-1',
      'user-1',
      'Planner',
      northTable as any,
      southTable as any,
      '2',
      'Weekday',
      'draft'
    );

    expect(result.currentVersion).toBe(1);
    expect(result.cycleMode).toBeUndefined();

    const entryWrite = transactionSetMock.mock.calls.find(([ref]) =>
      ref.path === 'teams/team-1/masterSchedules/2-Weekday'
    );

    expect(entryWrite).toBeDefined();
    expect(entryWrite?.[1]).not.toHaveProperty('cycleMode');

    const uploadedJson = new TextDecoder().decode(uploadBytesMock.mock.calls[0][1] as Uint8Array);
    expect(JSON.parse(uploadedJson)).toEqual({
      northTable,
      southTable,
      metadata: {
        routeNumber: '2',
        dayType: 'Weekday',
        uploadedAt: expect.any(String),
      },
    });
  });

  it('cleans up the orphaned storage blob when the transaction fails', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => false,
      data: (): undefined => undefined,
    });
    transactionGetMock.mockResolvedValueOnce({
      exists: () => false,
      data: (): undefined => undefined,
    });
    runTransactionMock.mockRejectedValueOnce(new Error('transaction failed'));

    await expect(
      uploadToMasterSchedule(
        'team-1',
        'user-1',
        'Planner',
        northTable as any,
        southTable as any,
        '2',
        'Weekday',
        'draft'
      )
    ).rejects.toThrow('transaction failed');

    expect(deleteObjectMock).toHaveBeenCalledWith({
      path: 'teams/team-1/masterSchedules/2-Weekday_v1.json',
    });
  });

  it('still succeeds when old-version cleanup fails after upload', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => makeEntryData(5),
    });
    transactionGetMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => makeEntryData(5),
    });
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        storagePath: 'teams/team-1/masterSchedules/2-Weekday_v1.json',
      }),
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    deleteObjectMock.mockRejectedValueOnce(new Error('cleanup failed'));

    const result = await uploadToMasterSchedule(
      'team-1',
      'user-1',
      'Planner',
      northTable as any,
      southTable as any,
      '2',
      'Weekday',
      'draft'
    );

    expect(result.currentVersion).toBe(6);
    expect(deleteObjectMock).toHaveBeenCalledWith({
      path: 'teams/team-1/masterSchedules/2-Weekday_v1.json',
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Error deleting old version from storage:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});
