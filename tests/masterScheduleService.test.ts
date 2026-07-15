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
  downloadFileContentMock,
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
  downloadFileContentMock: vi.fn(),
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
  auth: { currentUser: null },
  db: { name: 'db' },
  storage: { name: 'storage' },
}));

vi.mock('../utils/services/dataService', () => ({
  downloadFileContent: downloadFileContentMock,
}));

import { buildRouteIdentity } from '../utils/masterScheduleTypes';
import {
  deleteRouteMap,
  getMasterScheduleEntry,
  getMasterSchedule,
  getRouteMapUrl,
  normalizePublishNote,
  prepareUpload,
  uploadRouteMap,
  uploadToMasterSchedule,
} from '../utils/services/masterScheduleService';

describe('normalizePublishNote', () => {
  it('removes markup, normalizes whitespace, and caps the stored note', () => {
    expect(normalizePublishNote('  Peak <b>update</b>\n reviewed  ')).toBe('Peak update reviewed');
    expect(normalizePublishNote('x'.repeat(550))).toHaveLength(500);
  });
});

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
  downloadFileContentMock.mockReset();

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

describe('getMasterScheduleEntry', () => {
  it('loads metadata without downloading schedule content', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: '2-Weekday',
      data: () => makeEntryData(4),
    });

    await expect(getMasterScheduleEntry('team-1', '2-Weekday')).resolves.toMatchObject({
      id: '2-Weekday', currentVersion: 4, routeNumber: '2', dayType: 'Weekday',
    });
    expect(getBytesMock).not.toHaveBeenCalled();
    expect(getDownloadURLMock).not.toHaveBeenCalled();
  });
});

describe('uploadToMasterSchedule', () => {
  it('rejects a source-version race before uploading a payload', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => makeEntryData(5),
    });

    await expect(uploadToMasterSchedule(
      'team-1', 'user-1', 'Planner', northTable as any, southTable as any,
      '2', 'Weekday', 'draft', { expectedCurrentVersion: 4 },
    )).rejects.toThrow('expected master v4, found v5');

    expect(uploadBytesMock).not.toHaveBeenCalled();
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it('rechecks a cross-team source version inside the target publish transaction', async () => {
    getDocMock.mockResolvedValueOnce({ exists: () => false, data: (): undefined => undefined });
    transactionGetMock
      .mockResolvedValueOnce({ exists: () => false, data: (): undefined => undefined })
      .mockResolvedValueOnce({ exists: () => true, data: () => makeEntryData(6) });

    await expect(uploadToMasterSchedule(
      'team-1', 'user-1', 'Planner', northTable as any, southTable as any,
      '2', 'Weekday', 'draft', {
        expectedCurrentVersion: 0,
        expectedSource: { teamId: 'source-team', routeIdentity: '2-Weekday', version: 5 },
      },
    )).rejects.toThrow('Source version conflict: expected v5, found v6');

    expect(uploadBytesMock).toHaveBeenCalledOnce();
    expect(deleteObjectMock).toHaveBeenCalledOnce();
    expect(transactionSetMock).not.toHaveBeenCalled();
  });

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
      {
        cycleMode: 'Floating',
        publishNote: '  <b>Peak</b> update  ',
        expectedCurrentVersion: 4,
        publishedBy: 'user-1',
        publishedFromDraft: 'draft-1',
      }
    );

    expect(result.currentVersion).toBe(5);
    expect(result.routeNumber).toBe('2');
    expect(result.dayType).toBe('Weekday');

    expect(uploadBytesMock).toHaveBeenCalledTimes(1);
    const [storageRefArg, contentBytes, options] = uploadBytesMock.mock.calls[0];
    expect(storageRefArg).toEqual({
      path: expect.stringMatching(/^teams\/team-1\/masterSchedules\/2-Weekday_v5_[a-z0-9-]+\.json$/),
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
        storagePath: expect.stringMatching(/^teams\/team-1\/masterSchedules\/2-Weekday_v5_[a-z0-9-]+\.json$/),
        createdBy: 'user-1',
        uploaderName: 'Planner',
        source: 'draft',
        tripCount: 0,
        publishNote: 'Peak update',
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
        storagePath: expect.stringMatching(/^teams\/team-1\/masterSchedules\/2-Weekday_v5_[a-z0-9-]+\.json$/),
        tripCount: 0,
        northStopCount: 2,
        southStopCount: 2,
        updatedBy: 'user-1',
        uploaderName: 'Planner',
        source: 'draft',
        publishNote: 'Peak update',
        publishedAt: 'server-timestamp',
        publishedBy: 'user-1',
        publishedFromDraft: 'draft-1',
        status: 'published',
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
      path: expect.stringMatching(/^teams\/team-1\/masterSchedules\/2-Weekday_v1_[a-z0-9-]+\.json$/),
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

describe('route map operations', () => {
  it('uploads route maps to the canonical extensionless path and clears legacy files', async () => {
    getDownloadURLMock.mockResolvedValueOnce('https://example.com/maps/2');
    deleteObjectMock.mockRejectedValue({ code: 'storage/object-not-found' });

    const file = new File(['image-data'], 'route-map.PNG', { type: 'image/png' });
    const url = await uploadRouteMap('team-1', '2', file);

    expect(url).toBe('https://example.com/maps/2');
    expect(uploadBytesMock).toHaveBeenCalledWith(
      { path: 'teams/team-1/routeMaps/2' },
      file,
      { contentType: 'image/png' },
    );
    expect(deleteObjectMock).toHaveBeenCalledWith({ path: 'teams/team-1/routeMaps/2.png' });
    expect(deleteObjectMock).toHaveBeenCalledWith({ path: 'teams/team-1/routeMaps/2.PNG' });
  });

  it('prefers the canonical route map path before falling back to legacy extensions', async () => {
    getDownloadURLMock
      .mockResolvedValueOnce('https://example.com/maps/2');

    await expect(getRouteMapUrl('team-1', '2')).resolves.toBe('https://example.com/maps/2');
    expect(getDownloadURLMock).toHaveBeenCalledTimes(1);
    expect(getDownloadURLMock).toHaveBeenCalledWith({ path: 'teams/team-1/routeMaps/2' });
  });

  it('deletes the canonical route map and all legacy variants', async () => {
    deleteObjectMock.mockRejectedValue({ code: 'storage/object-not-found' });

    await expect(deleteRouteMap('team-1', '2')).resolves.toBeUndefined();

    expect(deleteObjectMock).toHaveBeenCalledWith({ path: 'teams/team-1/routeMaps/2' });
    expect(deleteObjectMock).toHaveBeenCalledWith({ path: 'teams/team-1/routeMaps/2.png' });
    expect(deleteObjectMock).toHaveBeenCalledWith({ path: 'teams/team-1/routeMaps/2.WEBP' });
  });
});

describe('master schedule reads', () => {
  it('falls back to the download URL path when direct storage bytes are unauthorized', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: '2-Weekday',
      data: () => makeEntryData(4),
    });
    getBytesMock.mockRejectedValueOnce({ code: 'storage/unauthorized' });
    getDownloadURLMock.mockResolvedValueOnce('https://example.com/master-schedule.json');
    downloadFileContentMock.mockResolvedValueOnce(JSON.stringify({
      northTable,
      southTable,
      metadata: {
        routeNumber: '2',
        dayType: 'Weekday',
        uploadedAt: '2026-04-21T12:00:00.000Z',
      },
    }));

    const result = await getMasterSchedule('team-1', '2-Weekday');

    expect(result?.entry.id).toBe('2-Weekday');
    expect(result?.content.northTable).toEqual(northTable);
    expect(getDownloadURLMock).toHaveBeenCalledWith({
      path: 'teams/team-1/masterSchedules/2-Weekday_v4.json',
    });
    expect(downloadFileContentMock).toHaveBeenCalledWith('https://example.com/master-schedule.json');
  });
});
