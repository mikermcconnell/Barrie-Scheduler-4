import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PARKING_LOCOMOBI_FINANCIAL_BASIS,
  PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION,
  PARKING_LOCOMOBI_VENDOR,
  type ParkingLocoMobiHistoryRow,
  type ParkingLocoMobiParseResult,
} from '../utils/parking/parkingLocoMobiTypes';

const transactionSet = vi.hoisted(() => vi.fn());
const firestoreMock = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
}));
const storageMock = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  getDownloadURL: vi.fn(),
  ref: vi.fn((_storage: unknown, path: string) => ({ path })),
  uploadBytes: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestoreMock);
vi.mock('firebase/storage', () => storageMock);
vi.mock('../utils/firebase', () => ({
  db: { name: 'mock-db' },
  storage: { name: 'mock-storage' },
}));

function missingDocument() {
  return { exists: () => false, data: (): undefined => undefined };
}

function existingDocument(data: Record<string, unknown>) {
  return { exists: () => true, data: () => data };
}

function parsedHistory(): ParkingLocoMobiParseResult {
  const rows: ParkingLocoMobiHistoryRow[] = [
    {
      vendor: PARKING_LOCOMOBI_VENDOR,
      financialBasis: PARKING_LOCOMOBI_FINANCIAL_BASIS,
      domain: 'Waterfront',
      meterId: 'M-1',
      locationLabel: 'Spirit Catcher',
      activityDate: '2024-03-28',
      activityMonth: '2024-03',
      activityMinutes: 720,
      weekday: 4,
      isWeekend: false,
      reportedAmount: 12,
      paymentChannel: 'visa' as const,
      paymentChannelLabel: 'Visa',
      qualityFlags: [],
    },
    {
      vendor: PARKING_LOCOMOBI_VENDOR,
      financialBasis: PARKING_LOCOMOBI_FINANCIAL_BASIS,
      domain: 'Waterfront',
      meterId: 'M-2',
      locationLabel: 'Heritage East',
      activityDate: '2024-04-01',
      activityMonth: '2024-04',
      activityMinutes: 600,
      weekday: 1,
      isWeekend: false,
      reportedAmount: 0,
      paymentChannel: 'cash' as const,
      paymentChannelLabel: 'Cash',
      qualityFlags: ['zero_amount' as const],
    },
  ];
  return {
    schemaVersion: PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION,
    vendor: PARKING_LOCOMOBI_VENDOR,
    financialBasis: PARKING_LOCOMOBI_FINANCIAL_BASIS,
    rows,
    sourceTables: [{
      fileName: 'history.xlsx',
      sheetName: 'All',
      profile: 'consolidated_all',
      headerRowNumber: 1,
      sourceColumnCount: 22,
      sourceRowCount: 2,
      acceptedRowCount: 2,
      duplicateRowCount: 0,
      skippedRowCount: 0,
    }],
    ignoredSheets: [],
    coverage: {
      observedStartDate: '2024-03-28',
      observedEndDate: '2024-04-01',
      observedMonths: ['2024-03', '2024-04'],
      observedYears: [2024],
      activeDateCount: 2,
    },
    reconciliation: {
      sourceRowCount: 2,
      acceptedRowCount: 2,
      duplicateRowCount: 0,
      skippedRowCount: 0,
      zeroAmountRowCount: 1,
      negativeAmountRowCount: 0,
      missingPaymentChannelRowCount: 0,
      uniqueMeterCount: 2,
      uniqueMeterLocationCount: 2,
      totalReportedAmount: 12,
    },
    warnings: ['1 zero-dollar payment was retained and quality-flagged.'],
  };
}

describe('Parking strategy history persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(firestoreMock).forEach(mock => mock.mockClear());
    Object.values(storageMock).forEach(mock => mock.mockClear());
    transactionSet.mockClear();
    firestoreMock.getDoc.mockResolvedValue(missingDocument());
    firestoreMock.runTransaction.mockImplementation(async (_db: unknown, callback: (transaction: unknown) => Promise<void>) => callback({
      get: vi.fn().mockResolvedValue(missingDocument()),
      set: transactionSet,
    }));
    storageMock.uploadBytes.mockResolvedValue({});
    storageMock.deleteObject.mockResolvedValue(undefined);
  });

  it('writes an aggregate first-load payload and privacy-safe monthly partitions', async () => {
    const { saveParkingStrategyHistory } = await import('../utils/parking/parkingStrategyHistoryService');
    const result = await saveParkingStrategyHistory('team-1', 'user-1', parsedHistory());

    expect(result.manifest.revision).toBe(1);
    expect(result.manifest.partitions.map(partition => partition.month)).toEqual(['2024-03', '2024-04']);
    expect(storageMock.uploadBytes).toHaveBeenCalledTimes(3);
    expect(transactionSet).toHaveBeenCalledWith(
      { path: 'teams/team-1/parking/history' },
      expect.objectContaining({
        revision: 1,
        importedBy: 'user-1',
        financialBasis: 'source_reported_amount',
      }),
    );

    const payloads = storageMock.uploadBytes.mock.calls.map(call => new TextDecoder().decode(call[1] as Uint8Array));
    const aggregate = JSON.parse(payloads[0]) as Record<string, unknown>;
    expect(aggregate).not.toHaveProperty('rows');
    expect(payloads.join('\n')).not.toMatch(/lpn|licen[cs]e|receipt|ticket|permit|username|transactionnumber/i);
    expect(payloads.some(payload => payload.includes('"month":"2024-03"'))).toBe(true);
  });

  it('returns the existing revision without uploading when the safe content is unchanged', async () => {
    const { saveParkingStrategyHistory } = await import('../utils/parking/parkingStrategyHistoryService');
    const first = await saveParkingStrategyHistory('team-1', 'user-1', parsedHistory());
    storageMock.uploadBytes.mockClear();
    firestoreMock.runTransaction.mockClear();
    firestoreMock.getDoc.mockResolvedValue(existingDocument(first.manifest as unknown as Record<string, unknown>));

    const second = await saveParkingStrategyHistory('team-1', 'user-1', parsedHistory());

    expect(second.manifest.revision).toBe(1);
    expect(storageMock.uploadBytes).not.toHaveBeenCalled();
    expect(firestoreMock.runTransaction).not.toHaveBeenCalled();
  });

  it('cleans newly uploaded history when a concurrent revision wins', async () => {
    const { saveParkingStrategyHistory } = await import('../utils/parking/parkingStrategyHistoryService');
    firestoreMock.runTransaction.mockImplementation(async (_db: unknown, callback: (transaction: unknown) => Promise<void>) => callback({
      get: vi.fn().mockResolvedValue(existingDocument({
        schemaVersion: 1,
        historySchemaVersion: 1,
        revision: 2,
        vendor: 'locomobi',
        financialBasis: 'source_reported_amount',
        importFingerprint: 'other',
        importedAt: '2026-09-03T12:00:00.000Z',
        importedBy: 'other-user',
        aggregateStoragePath: 'teams/team-1/parking/history/other/aggregate.json',
        partitions: [],
        coverage: {},
        reconciliation: {},
      })),
      set: transactionSet,
    }));

    await expect(saveParkingStrategyHistory('team-1', 'user-1', parsedHistory())).rejects.toThrow(
      'Parking strategy history changed while importing',
    );
    expect(storageMock.deleteObject).toHaveBeenCalledTimes(3);
    expect(transactionSet).not.toHaveBeenCalled();
  });

  it('treats reordered normalized rows and renamed source workbooks as the same content', async () => {
    const { saveParkingStrategyHistory } = await import('../utils/parking/parkingStrategyHistoryService');
    const first = await saveParkingStrategyHistory('team-1', 'user-1', parsedHistory());
    firestoreMock.getDoc.mockResolvedValue(existingDocument(first.manifest as unknown as Record<string, unknown>));
    storageMock.uploadBytes.mockClear();
    const reordered = parsedHistory();
    reordered.rows.reverse();
    reordered.sourceTables[0].fileName = 'renamed.xlsx';
    const result = await saveParkingStrategyHistory('team-1', 'user-1', reordered, 1);
    expect(result.manifest.revision).toBe(1);
    expect(storageMock.uploadBytes).not.toHaveBeenCalled();
  });

  it('rejects malformed downloaded aggregates before returning render data', async () => {
    const { getParkingStrategyHistory, saveParkingStrategyHistory } = await import('../utils/parking/parkingStrategyHistoryService');
    const saved = await saveParkingStrategyHistory('team-1', 'user-1', parsedHistory());
    firestoreMock.getDoc.mockResolvedValue(existingDocument(saved.manifest as unknown as Record<string, unknown>));
    storageMock.getDownloadURL.mockResolvedValue('https://storage.example/aggregate.json');
    for (const aggregate of [null, { ...saved.snapshot, monthly: null }, { ...saved.snapshot, financialBasis: 'tax_inclusive' },
      { ...saved.snapshot, locationMonths: [{ ...saved.snapshot.locationMonths![0], hourlyCounts: [1] }] },
      { ...saved.snapshot, locationMonths: [] }]) {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => aggregate })));
      await expect(getParkingStrategyHistory('team-1')).rejects.toThrow('aggregate is invalid');
    }
    const legacy = { ...saved.snapshot };
    delete legacy.locationMonths;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => legacy })));
    expect((await getParkingStrategyHistory('team-1'))?.snapshot.locationMonths).toBeUndefined();
  });

  it('loads the aggregate first and a requested month independently', async () => {
    const {
      getParkingStrategyHistory,
      getParkingStrategyHistoryMonth,
      saveParkingStrategyHistory,
    } = await import('../utils/parking/parkingStrategyHistoryService');
    const saved = await saveParkingStrategyHistory('team-1', 'user-1', parsedHistory());
    const marchPath = saved.manifest.partitions[0].storagePath;
    firestoreMock.getDoc.mockResolvedValue(existingDocument(saved.manifest as unknown as Record<string, unknown>));
    storageMock.getDownloadURL.mockImplementation(async (target: { path: string }) => `https://storage.example/${target.path}`);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith('/aggregate.json')
        ? saved.snapshot
        : {
            schemaVersion: 1,
            vendor: 'locomobi',
            financialBasis: 'source_reported_amount',
            month: '2024-03',
            rows: parsedHistory().rows.slice(0, 1),
          },
    })));

    const history = await getParkingStrategyHistory('team-1');
    const march = await getParkingStrategyHistoryMonth('team-1', '2024-03');

    expect(history?.snapshot.reconciliation.acceptedRowCount).toBe(2);
    expect(march?.rows).toHaveLength(1);
    expect(storageMock.getDownloadURL).toHaveBeenCalledWith({ path: saved.manifest.aggregateStoragePath });
    expect(storageMock.getDownloadURL).toHaveBeenCalledWith({ path: marchPath });
  });

  it('rejects cross-team history pointers and malformed existing manifests without treating them as empty', async () => {
    const { getParkingStrategyHistory, saveParkingStrategyHistory } = await import('../utils/parking/parkingStrategyHistoryService');
    const saved = await saveParkingStrategyHistory('team-1', 'user-1', parsedHistory());
    firestoreMock.getDoc.mockResolvedValue(existingDocument({ ...saved.manifest, aggregateStoragePath: 'teams/team-2/parking/history/revision-1/aggregate.json' }));
    storageMock.uploadBytes.mockClear();
    await expect(getParkingStrategyHistory('team-1')).rejects.toThrow('manifest is invalid');
    await expect(saveParkingStrategyHistory('team-1', 'user-1', parsedHistory(), 0)).rejects.toThrow('manifest is invalid');
    expect(storageMock.uploadBytes).not.toHaveBeenCalled();
    firestoreMock.getDoc.mockRejectedValue(new Error('permission denied'));
    await expect(getParkingStrategyHistory('team-1')).rejects.toThrow('permission denied');
  });

  it('upgrades an older aggregate fingerprint by persisting the new cross-filter index', async () => {
    const { saveParkingStrategyHistory } = await import('../utils/parking/parkingStrategyHistoryService');
    const saved = await saveParkingStrategyHistory('team-1', 'user-1', parsedHistory());
    const legacy = { ...saved.manifest, importFingerprint: 'fnv1a-legacy-fingerprint' };
    firestoreMock.getDoc.mockResolvedValue(existingDocument(legacy));
    firestoreMock.runTransaction.mockImplementation(async (_db: unknown, callback: (transaction: unknown) => Promise<void>) => callback({ get: vi.fn().mockResolvedValue(existingDocument(legacy)), set: transactionSet }));
    storageMock.uploadBytes.mockClear();
    const upgraded = await saveParkingStrategyHistory('team-1', 'user-1', parsedHistory(), 1);
    expect(upgraded.manifest.revision).toBe(2);
    expect(JSON.parse(new TextDecoder().decode(storageMock.uploadBytes.mock.calls[0][1])).locationMonths).toHaveLength(2);
  });
});
