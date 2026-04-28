import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetPlanWorkbook } from '../utils/fleet-plan/types';

const {
  docMock,
  getDocMock,
  runTransactionMock,
  serverTimestampMock,
  refMock,
  uploadBytesMock,
  getBytesMock,
  deleteObjectMock,
  transactionGetMock,
  transactionSetMock,
} = vi.hoisted(() => ({
  docMock: vi.fn(),
  getDocMock: vi.fn(),
  runTransactionMock: vi.fn(),
  serverTimestampMock: vi.fn(() => 'server-timestamp'),
  refMock: vi.fn(),
  uploadBytesMock: vi.fn(),
  getBytesMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  transactionGetMock: vi.fn(),
  transactionSetMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: docMock,
  getDoc: getDocMock,
  runTransaction: runTransactionMock,
  serverTimestamp: serverTimestampMock,
}));

vi.mock('firebase/storage', () => ({
  ref: refMock,
  uploadBytes: uploadBytesMock,
  getBytes: getBytesMock,
  deleteObject: deleteObjectMock,
}));

vi.mock('../utils/firebase', () => ({
  db: { name: 'db' },
  storage: { name: 'storage' },
}));

import { getFleetPlanWorkbook, saveFleetPlanWorkbook } from '../utils/fleet-plan/fleetPlanService';

function makeWorkbook(currentVersion?: number): FleetPlanWorkbook {
  return {
    schemaVersion: 1,
    metadata: {
      templateVersion: '2026-04-08-fleet-plan-v1',
      sourceFileName: 'Fleet_Plan.xlsx',
      importedAt: '2026-04-21T10:00:00.000Z',
      importedBy: 'user-1',
      updatedAt: '2026-04-21T10:00:00.000Z',
      updatedBy: 'user-1',
      ...(currentVersion === undefined ? {} : { currentVersion }),
    },
    sheets: [
      {
        key: 'diesel-12m',
        name: '12m Buses',
        title: '12m Diesel Buses',
        rows: [
          {
            id: 'row-1',
            unitNumber: '1101',
            makeModel: 'NF - Xcelsior',
            year: '2012',
            timeline: { '2026': '1101' },
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  docMock.mockReset();
  getDocMock.mockReset();
  runTransactionMock.mockReset();
  serverTimestampMock.mockClear();
  refMock.mockReset();
  uploadBytesMock.mockReset();
  getBytesMock.mockReset();
  deleteObjectMock.mockReset();
  transactionGetMock.mockReset();
  transactionSetMock.mockReset();

  docMock.mockImplementation((_db: unknown, ...segments: string[]) => ({
    id: segments[segments.length - 1] ?? 'default',
    path: segments.join('/'),
  }));
  refMock.mockImplementation((_storage: unknown, path: string) => ({ path }));
  uploadBytesMock.mockResolvedValue(undefined);
  deleteObjectMock.mockResolvedValue(undefined);
  runTransactionMock.mockImplementation(async (_db: unknown, callback: (transaction: { get: typeof transactionGetMock; set: typeof transactionSetMock }) => Promise<unknown>) => {
    return callback({
      get: transactionGetMock,
      set: transactionSetMock,
    });
  });
});

describe('fleetPlanService', () => {
  it('saves a new immutable version and leaves previous storage intact', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(12345);
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        currentVersion: 2,
        storagePath: 'teams/team-1/fleetPlan/v2_111.json',
      }),
    });
    transactionGetMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ currentVersion: 2 }),
    });

    const result = await saveFleetPlanWorkbook('team-1', makeWorkbook(2));

    expect(result.metadata.currentVersion).toBe(3);
    expect(result.metadata.storagePath).toBe('teams/team-1/fleetPlan/v3_12345.json');
    expect(uploadBytesMock).toHaveBeenCalledWith(
      { path: 'teams/team-1/fleetPlan/v3_12345.json' },
      expect.anything(),
      { contentType: 'application/json' },
    );
    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/team-1/fleetPlan/default/versions/3' }),
      expect.objectContaining({
        currentVersion: 3,
        versionNumber: 3,
        storagePath: 'teams/team-1/fleetPlan/v3_12345.json',
        createdBy: 'user-1',
      }),
    );
    expect(transactionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'teams/team-1/fleetPlan/default' }),
      expect.objectContaining({
        currentVersion: 3,
        storagePath: 'teams/team-1/fleetPlan/v3_12345.json',
        updatedBy: 'user-1',
      }),
      { merge: true },
    );
    expect(deleteObjectMock).not.toHaveBeenCalledWith({ path: 'teams/team-1/fleetPlan/v2_111.json' });
  });

  it('rejects a stale loaded version before uploading', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ currentVersion: 3 }),
    });

    await expect(saveFleetPlanWorkbook('team-1', makeWorkbook(2))).rejects.toThrow(
      'Fleet Plan was updated by someone else',
    );

    expect(uploadBytesMock).not.toHaveBeenCalled();
    expect(deleteObjectMock).not.toHaveBeenCalled();
  });

  it('cleans up an uploaded object when a transaction detects a conflict', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(22222);
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ currentVersion: 2 }),
    });
    transactionGetMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ currentVersion: 3 }),
    });

    await expect(saveFleetPlanWorkbook('team-1', makeWorkbook(2))).rejects.toThrow(
      'Fleet Plan was updated by someone else',
    );

    expect(uploadBytesMock).toHaveBeenCalledTimes(1);
    expect(deleteObjectMock).toHaveBeenCalledWith({ path: 'teams/team-1/fleetPlan/v3_22222.json' });
  });

  it('attaches document version metadata when loading a workbook', async () => {
    const workbook = makeWorkbook();
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        currentVersion: 7,
        storagePath: 'teams/team-1/fleetPlan/v7_777.json',
      }),
    });
    getBytesMock.mockResolvedValueOnce(new TextEncoder().encode(JSON.stringify(workbook)));

    const result = await getFleetPlanWorkbook('team-1');

    expect(result?.metadata.currentVersion).toBe(7);
    expect(result?.metadata.storagePath).toBe('teams/team-1/fleetPlan/v7_777.json');
  });
});
