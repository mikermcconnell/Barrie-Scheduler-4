import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParkingSettings, ParkingSummary } from '../utils/parking/parkingTypes';

const firestoreMock = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
  setDoc: vi.fn(),
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

function workbookBuffer(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

const strictSettings: ParkingSettings = {
  codeFamilies: [
    { familyKey: 'RS', codes: ['RS2026'], department: 'Recreation Services' },
    { familyKey: 'IF', codes: ['IF2026'], department: 'Infrastructure' },
  ],
  spotLocations: [
    { spotId: '7100', locationName: 'Waterfront Lot' },
  ],
  flagRules: {
    plateMonthlyValueDollars: 999,
    plateActiveDaysPerMonth: 10,
    longSessionHours: 12,
    longSessionCount: 3,
    sameLocationDays: 10,
    consecutiveWeekdays: 5,
    workdayStartHour: 7,
    workdayEndHour: 18,
    multipleDailySessions: 3,
    departmentMonthlyValueDollars: 9999,
    departmentIncreasePercent: 200,
  },
};

function parkingRows(): unknown[][] {
  return [
    ['HotSpot'],
    ['Licence Plate', 'Start Time', 'Spot Id/Tap Token', 'Length', 'Tap Signs/Spot', 'Discount Code', 'Description', 'Discount Amount'],
    ['ABC123', '2026-06-01 09:00:00 EDT', '7100', '6h0m', 'Spot', 'RS2026', 'Recreation Services', '50.00 $'],
    ['ABC123', '2026-06-02 09:00:00 EDT', '7100', '6h0m', 'Spot', 'RS2026', 'Recreation Services', '50.00 $'],
    ['ABC123', '2026-06-03 09:00:00 EDT', '7100', '1h0m', 'Spot', 'RS2026', 'Recreation Services', '10.00 $'],
    ['XYZ999', '2026-06-08 18:30:00 EDT', '7100', '1h0m', 'Spot', 'IF2026', 'Infrastructure', '2.00 $'],
  ];
}

describe('parking Firebase service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(firestoreMock).forEach(mock => mock.mockClear());
    Object.values(storageMock).forEach(mock => mock.mockClear());
    vi.stubGlobal('fetch', vi.fn());
  });

  it('saves Parking settings to the team parking document, including flag thresholds', async () => {
    const { saveParkingSettings } = await import('../utils/parking/parkingService');

    const saved = await saveParkingSettings('team-1', 'user-1', strictSettings);

    expect(firestoreMock.doc).toHaveBeenCalledWith(
      { name: 'mock-db' },
      'teams',
      'team-1',
      'parking',
      'default',
    );
    expect(firestoreMock.setDoc).toHaveBeenCalledWith(
      { path: 'teams/team-1/parking/default' },
      expect.objectContaining({
        settings: expect.objectContaining({
          updatedBy: 'user-1',
          flagRules: expect.objectContaining({
            plateMonthlyValueDollars: 999,
            departmentIncreasePercent: 200,
          }),
        }),
        settingsUpdatedAt: { __serverTimestamp: true },
        settingsUpdatedBy: 'user-1',
      }),
      { merge: true },
    );
    expect(saved.flagRules).toMatchObject(strictSettings.flagRules);
  });

  it('saves imported month data to Storage and Firestore with the active flag thresholds', async () => {
    const { parseParkingWorkbook } = await import('../utils/parking/parkingParser');
    const { saveParkingMonthData } = await import('../utils/parking/parkingService');
    const dataset = parseParkingWorkbook(workbookBuffer(parkingRows()), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings: strictSettings,
    }).dataset;
    const transactionSet = vi.fn();

    firestoreMock.getDoc.mockResolvedValue({ exists: () => false });
    firestoreMock.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn().mockResolvedValue({ exists: () => false }),
      set: transactionSet,
    }));
    vi.spyOn(Date, 'now').mockReturnValue(123456789);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const summary = await saveParkingMonthData('team-1', 'user-1', dataset, strictSettings);

    expect(storageMock.uploadBytes).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringMatching(/^teams\/team-1\/parking\/2026-06_123456789-/) }),
      expect.anything(),
      { contentType: 'application/json' },
    );
    const uploadedPayload = storageMock.uploadBytes.mock.calls[0][1] as Blob | Uint8Array | ArrayBuffer;
    let uploadedText = '';
    if (ArrayBuffer.isView(uploadedPayload)) {
      uploadedText = new TextDecoder().decode(uploadedPayload);
    } else if (uploadedPayload instanceof ArrayBuffer) {
      uploadedText = new TextDecoder().decode(uploadedPayload);
    } else if (typeof (uploadedPayload as Blob).text === 'function') {
      uploadedText = await (uploadedPayload as Blob).text();
    } else if (typeof (uploadedPayload as Blob).arrayBuffer === 'function') {
      uploadedText = new TextDecoder().decode(await (uploadedPayload as Blob).arrayBuffer());
    }
    const uploadedSummary = JSON.parse(uploadedText);
    const uploadedPattern = uploadedSummary.platePatterns.find((pattern: { plate: string }) => pattern.plate === 'ABC123');
    expect(uploadedPattern.flags).not.toContain('high_value');
    expect(uploadedSummary.metadata.storagePath).toMatch(/^teams\/team-1\/parking\/2026-06_123456789-/);

    expect(transactionSet).toHaveBeenCalledWith(
      { path: 'teams/team-1/parking/default' },
      expect.objectContaining({
        importedBy: 'user-1',
        monthCount: 1,
        totalRows: 4,
        totalValue: 112,
        settings: expect.objectContaining({
          flagRules: expect.objectContaining({
            plateMonthlyValueDollars: 999,
            departmentMonthlyValueDollars: 9999,
          }),
          updatedBy: 'user-1',
        }),
      }),
      { merge: true },
    );
    expect(transactionSet).toHaveBeenCalledWith(
      { path: 'teams/team-1/parking/default/months/2026-06' },
      expect.objectContaining({
        month: '2026-06',
        importedBy: 'user-1',
        rowCount: 4,
        totalValue: 112,
      }),
    );
    expect(summary.platePatterns.find(pattern => pattern.plate === 'ABC123')?.flags).not.toContain('high_value');
  });

  it('loads Parking settings and stored summaries from Firebase metadata', async () => {
    const { getParkingData, getParkingSettings } = await import('../utils/parking/parkingService');
    const importedDate = new Date('2026-06-15T12:00:00.000Z');
    const storedSummary: ParkingSummary = {
      schemaVersion: 1,
      months: [],
      departmentSummaries: [],
      platePatterns: [],
      metadata: {
        importedAt: 'older',
        importedBy: 'older-user',
        monthCount: 0,
        totalRows: 0,
        totalValue: 0,
      },
    };

    firestoreMock.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        storagePath: 'teams/team-1/parking/current.json',
        importedAt: { toDate: () => importedDate },
        importedBy: 'user-1',
        monthCount: 1,
        totalRows: 4,
        totalValue: 112,
        settings: {
          codeFamilies: strictSettings.codeFamilies,
          spotLocations: strictSettings.spotLocations,
          flagRules: { plateMonthlyValueDollars: 999 },
          updatedAt: '2026-06-01T00:00:00.000Z',
          updatedBy: 'user-1',
        },
      }),
    });
    storageMock.getDownloadURL.mockResolvedValue('https://storage.example/parking.json');
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => storedSummary,
    } as Response);

    const settings = await getParkingSettings('team-1');
    const summary = await getParkingData('team-1');

    expect(settings.flagRules.plateMonthlyValueDollars).toBe(999);
    expect(settings.flagRules.longSessionHours).toBe(6);
    expect(summary?.metadata).toMatchObject({
      importedAt: importedDate.toISOString(),
      importedBy: 'user-1',
      monthCount: 1,
      totalRows: 4,
      totalValue: 112,
      storagePath: 'teams/team-1/parking/current.json',
    });
  });

  it('returns no Parking data when metadata or Storage content is unavailable', async () => {
    const { getParkingData } = await import('../utils/parking/parkingService');

    firestoreMock.getDoc.mockResolvedValueOnce({ exists: () => false });
    await expect(getParkingData('team-1')).resolves.toBeNull();

    firestoreMock.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ storagePath: '' }) });
    await expect(getParkingData('team-1')).resolves.toBeNull();

    firestoreMock.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ storagePath: 'teams/team-1/parking/current.json' }) });
    storageMock.getDownloadURL.mockResolvedValueOnce('https://storage.example/missing.json');
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await expect(getParkingData('team-1')).resolves.toBeNull();
  });

  it('preserves existing months and deletes the previous Storage object after a replacement save', async () => {
    const { parseParkingWorkbook } = await import('../utils/parking/parkingParser');
    const { buildParkingReplacementSummary } = await import('../utils/parking/parkingAggregation');
    const { saveParkingMonthData } = await import('../utils/parking/parkingService');
    const newDataset = parseParkingWorkbook(workbookBuffer(parkingRows()), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings: strictSettings,
    }).dataset;
    const oldDataset = {
      ...newDataset,
      month: '2026-05',
      rows: newDataset.rows.map(row => ({ ...row, startMonth: '2026-05', startDate: row.startDate.replace('2026-06', '2026-05') })),
      departmentSummaries: newDataset.departmentSummaries.map(row => ({ ...row, month: '2026-05' })),
      platePatterns: newDataset.platePatterns.map(row => ({ ...row, month: '2026-05' })),
    };
    const oldSummary = buildParkingReplacementSummary(null, oldDataset, 'user-1', 'old.json', strictSettings.flagRules);

    firestoreMock.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ storagePath: 'old.json' }) });
    storageMock.getDownloadURL.mockResolvedValue('https://storage.example/old.json');
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => oldSummary } as Response);
    firestoreMock.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn().mockResolvedValue({ exists: () => true, data: () => ({ storagePath: 'old.json' }) }),
      set: vi.fn(),
    }));
    vi.spyOn(Date, 'now').mockReturnValue(123456790);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);

    const summary = await saveParkingMonthData('team-1', 'user-1', newDataset, strictSettings);

    expect(summary.months.map(month => month.month)).toEqual(['2026-05', '2026-06']);
    expect(storageMock.deleteObject).toHaveBeenCalledWith({ path: 'old.json' });
  });

  it('cleans up the uploaded Parking file when Firestore transaction detects a stale import', async () => {
    const { parseParkingWorkbook } = await import('../utils/parking/parkingParser');
    const { saveParkingMonthData } = await import('../utils/parking/parkingService');
    const dataset = parseParkingWorkbook(workbookBuffer(parkingRows()), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings: strictSettings,
    }).dataset;

    firestoreMock.getDoc.mockResolvedValue({ exists: () => false });
    firestoreMock.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn().mockResolvedValue({ exists: () => true, data: () => ({ storagePath: 'newer.json' }) }),
      set: vi.fn(),
    }));
    vi.spyOn(Date, 'now').mockReturnValue(123456791);
    vi.spyOn(Math, 'random').mockReturnValue(0.75);

    await expect(saveParkingMonthData('team-1', 'user-1', dataset, strictSettings)).rejects.toThrow('Parking data changed while importing');
    expect(storageMock.deleteObject).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringMatching(/^teams\/team-1\/parking\/2026-06_123456791-/),
    }));
  });

  it('stops saving when existing Parking data cannot be downloaded', async () => {
    const { parseParkingWorkbook } = await import('../utils/parking/parkingParser');
    const { saveParkingMonthData } = await import('../utils/parking/parkingService');
    const dataset = parseParkingWorkbook(workbookBuffer(parkingRows()), {
      fileName: 'HotSpot.xlsx',
      importedBy: 'user-1',
      settings: strictSettings,
    }).dataset;

    firestoreMock.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ storagePath: 'old.json' }) });
    storageMock.getDownloadURL.mockResolvedValue('https://storage.example/old.json');
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);

    await expect(saveParkingMonthData('team-1', 'user-1', dataset, strictSettings)).rejects.toThrow('Existing Parking data could not be downloaded.');
    expect(storageMock.uploadBytes).not.toHaveBeenCalled();
  });
});
