import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParkingRevenueSummary, ParkingSettings, ParkingSummary } from '../utils/parking/parkingTypes';

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
    const settingsWithIgnoreData: ParkingSettings = {
      ...strictSettings,
      codeFamilies: strictSettings.codeFamilies.map(mapping => (
        mapping.familyKey === 'IF' ? { ...mapping, ignoreData: true } : mapping
      )),
    };

    const saved = await saveParkingSettings('team-1', 'user-1', settingsWithIgnoreData);

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
          codeFamilies: expect.arrayContaining([
            expect.objectContaining({
              familyKey: 'IF',
              ignoreData: true,
            }),
          ]),
          flagRules: expect.objectContaining({
            plateMonthlyValueDollars: 999,
            multipleDailySessions: 3,
            departmentIncreasePercent: 200,
          }),
        }),
        settingsUpdatedAt: { __serverTimestamp: true },
        settingsUpdatedBy: 'user-1',
      }),
      { merge: true },
    );
    expect(saved.flagRules).toMatchObject(strictSettings.flagRules);
    expect(saved.codeFamilies.find(mapping => mapping.familyKey === 'IF')?.ignoreData).toBe(true);
  });

  it('saves imported month data with active thresholds without overwriting shared settings', async () => {
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

    const defaultWrite = transactionSet.mock.calls.find(([target]) => target.path === 'teams/team-1/parking/default');
    expect(defaultWrite?.[1]).toEqual(expect.objectContaining({
      importedBy: 'user-1',
      monthCount: 1,
      totalRows: 4,
      totalValue: 112,
    }));
    expect(defaultWrite?.[1]).not.toHaveProperty('settings');
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

  it('saves Parking revenue data separately from department-code usage data', async () => {
    const { parseParkingRevenueWorkbook } = await import('../utils/parking/parkingRevenue');
    const { saveParkingRevenueDatasets } = await import('../utils/parking/parkingService');
    const dataset = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'COLLIER PARKADE', '2026-01-31 09:00:00', 'ABC123', '10.00', '1.30', '11.30', '1', 'Wallet Transaction'],
    ]), {
      fileName: 'Hotspot Parking Revenue_Jan 2026.xlsx',
      importedBy: 'user-1',
      settings: strictSettings,
    }).dataset;
    const transactionSet = vi.fn();

    firestoreMock.getDoc.mockResolvedValue({ exists: () => false });
    firestoreMock.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn().mockResolvedValue({ exists: () => false }),
      set: transactionSet,
    }));
    vi.spyOn(Date, 'now').mockReturnValue(223456789);
    vi.spyOn(Math, 'random').mockReturnValue(0.4);

    const summary = await saveParkingRevenueDatasets('team-1', 'user-1', [dataset], strictSettings);

    expect(storageMock.uploadBytes).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringMatching(/^teams\/team-1\/parking\/revenue\/2026-01_hotspot_223456789-/) }),
      expect.anything(),
      { contentType: 'application/json' },
    );
    const defaultWrite = transactionSet.mock.calls.find(([target]) => target.path === 'teams/team-1/parking/default');
    expect(defaultWrite?.[1]).toEqual(expect.objectContaining({
      revenueImportedBy: 'user-1',
      revenueDatasetCount: 1,
      revenueMonthCount: 1,
      revenueTotalRows: 1,
      revenueTotalValue: 10,
      revenueStoragePath: expect.stringMatching(/^teams\/team-1\/parking\/revenue\/2026-01_hotspot_223456789-/),
    }));
    expect(defaultWrite?.[1]).not.toHaveProperty('settings');
    expect(transactionSet).toHaveBeenCalledWith(
      { path: 'teams/team-1/parking/default/months/revenue_hotspot_2026-01' },
      expect.objectContaining({
        month: '2026-01',
        source: 'hotspot',
        kind: 'revenue',
        totalValue: 10,
      }),
    );
    expect(summary.metadata).toMatchObject({ datasetCount: 1, totalRows: 1, totalRevenue: 10 });
  });

  it('auto-save persistence preserves other revenue source/month datasets when replacing one import', async () => {
    const { buildParkingRevenueReplacementSummary, parseParkingRevenueWorkbook } = await import('../utils/parking/parkingRevenue');
    const { saveParkingRevenueDatasets } = await import('../utils/parking/parkingService');
    const replacementHotspot = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'COLLIER PARKADE', '2026-01-31 09:00:00', 'ABC123', '10.00', '1.30', '11.30', '1', 'Wallet Transaction'],
    ]), { fileName: 'Hotspot Parking Revenue_Jan 2026.xlsx', importedBy: 'user-1', settings: strictSettings }).dataset;
    const oldHotspot = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'HotSpot #', 'City #', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'COLLIER PARKADE', '2025-12-31 09:00:00', 'OLD111', '7.00', '0.91', '7.91', '1', 'Wallet Transaction'],
    ]), { fileName: 'Hotspot Parking Revenue_Dec 2025.xlsx', importedBy: 'user-1', settings: strictSettings }).dataset;
    const oldQr = parseParkingRevenueWorkbook(workbookBuffer([
      ['HotSpot'],
      ['', 'Meter #', 'Tap Sign', 'Start Time', 'Plate', 'Amount', 'Tax', 'Total', 'Length', 'Card Type'],
      ['', '1322', 'Collier Parkade', '2026-01-31 10:00:00', 'QR999', '5.00', '0.65', '5.65', '2', 'visa'],
    ]), { fileName: 'Hotsport QR Code Revenue_Jan 2026.xlsx', importedBy: 'user-1', settings: strictSettings }).dataset;
    const oldSummary = buildParkingRevenueReplacementSummary(null, [oldHotspot, oldQr], 'user-1', 'old-revenue.json');

    firestoreMock.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ revenueStoragePath: 'old-revenue.json' }) });
    storageMock.getDownloadURL.mockResolvedValue('https://storage.example/old-revenue.json');
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => oldSummary } as Response);
    firestoreMock.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn().mockResolvedValue({ exists: () => true, data: () => ({ revenueStoragePath: 'old-revenue.json' }) }),
      set: vi.fn(),
    }));
    vi.spyOn(Date, 'now').mockReturnValue(223456790);
    vi.spyOn(Math, 'random').mockReturnValue(0.6);

    const summary = await saveParkingRevenueDatasets('team-1', 'user-1', [replacementHotspot], strictSettings);

    expect(summary.datasets.map(dataset => `${dataset.month}:${dataset.source}:${dataset.totalRevenue}`)).toEqual([
      '2025-12:hotspot:7',
      '2026-01:hotspot:10',
      '2026-01:qr:5',
    ]);
    expect(summary.metadata).toMatchObject({ datasetCount: 3, monthCount: 2, totalRows: 3, totalRevenue: 22 });
    expect(storageMock.deleteObject).toHaveBeenCalledWith({ path: 'old-revenue.json' });
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
          codeFamilies: strictSettings.codeFamilies.map(mapping => (
            mapping.familyKey === 'IF' ? { ...mapping, ignoreData: true } : mapping
          )),
          spotLocations: strictSettings.spotLocations,
          flagRules: { plateMonthlyValueDollars: 999, multipleDailySessions: 4 },
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
    expect(settings.flagRules.multipleDailySessions).toBe(4);
    expect(settings.flagRules.longSessionHours).toBe(6);
    expect(settings.codeFamilies.find(mapping => mapping.familyKey === 'IF')?.ignoreData).toBe(true);
    expect(summary?.metadata).toMatchObject({
      importedAt: importedDate.toISOString(),
      importedBy: 'user-1',
      monthCount: 1,
      totalRows: 4,
      totalValue: 112,
      storagePath: 'teams/team-1/parking/current.json',
    });
  });

  it('loads saved Parking revenue imports from Storage using Firestore metadata', async () => {
    const { getParkingRevenueData } = await import('../utils/parking/parkingService');
    const importedDate = new Date('2026-01-31T20:00:00.000Z');
    const storedRevenueSummary: ParkingRevenueSummary = {
      schemaVersion: 1,
      datasets: [
        {
          month: '2026-01',
          source: 'hotspot',
          importedAt: 'older',
          importedBy: 'older-user',
          sourceFileName: 'Hotspot Parking Revenue_Jan 2026.xlsx',
          rowCount: 1,
          skippedRows: 0,
          totalRevenue: 10,
          totalTax: 1.3,
          totalPaid: 11.3,
          rows: [],
        },
      ],
      metadata: {
        importedAt: 'older',
        importedBy: 'older-user',
        datasetCount: 1,
        monthCount: 1,
        totalRows: 1,
        totalRevenue: 10,
      },
    };

    firestoreMock.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        revenueStoragePath: 'teams/team-1/parking/revenue/current.json',
        revenueImportedAt: { toDate: () => importedDate },
        revenueImportedBy: 'user-1',
        revenueDatasetCount: 1,
        revenueMonthCount: 1,
        revenueTotalRows: 1,
        revenueTotalValue: 10,
      }),
    });
    storageMock.getDownloadURL.mockResolvedValue('https://storage.example/parking-revenue.json');
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => storedRevenueSummary,
    } as Response);

    const summary = await getParkingRevenueData('team-1');

    expect(storageMock.getDownloadURL).toHaveBeenCalledWith({
      path: 'teams/team-1/parking/revenue/current.json',
    });
    expect(fetch).toHaveBeenCalledWith('https://storage.example/parking-revenue.json');
    expect(summary?.datasets).toHaveLength(1);
    expect(summary?.metadata).toMatchObject({
      importedAt: importedDate.toISOString(),
      importedBy: 'user-1',
      datasetCount: 1,
      monthCount: 1,
      totalRows: 1,
      totalRevenue: 10,
      storagePath: 'teams/team-1/parking/revenue/current.json',
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
    const transactionSet = vi.fn();
    firestoreMock.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn().mockResolvedValue({ exists: () => true, data: () => ({ storagePath: 'old.json' }) }),
      set: transactionSet,
    }));
    vi.spyOn(Date, 'now').mockReturnValue(123456790);
    vi.spyOn(Math, 'random').mockReturnValue(0.25);

    const summary = await saveParkingMonthData('team-1', 'user-1', newDataset, strictSettings);

    expect(summary.months.map(month => month.month)).toEqual(['2026-05', '2026-06']);
    expect(transactionSet).toHaveBeenCalledWith(
      { path: 'teams/team-1/parking/default/months/2026-05' },
      expect.objectContaining({
        month: '2026-05',
        storagePath: summary.metadata.storagePath,
      }),
    );
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
