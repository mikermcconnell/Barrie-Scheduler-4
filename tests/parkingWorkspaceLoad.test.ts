import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParkingRevenueSummary, ParkingSummary } from '../utils/parking/parkingTypes';

const firestoreMock = vi.hoisted(() => ({
  doc: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
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

const storedDepartmentSummary: ParkingSummary = {
  schemaVersion: 1,
  months: [],
  departmentSummaries: [],
  platePatterns: [],
  metadata: {
    importedAt: 'stale-department-date',
    importedBy: 'stale-department-user',
    monthCount: 0,
    totalRows: 0,
    totalValue: 0,
  },
};

const storedRevenueSummary: ParkingRevenueSummary = {
  schemaVersion: 1,
  datasets: [],
  metadata: {
    importedAt: 'stale-revenue-date',
    importedBy: 'stale-revenue-user',
    datasetCount: 0,
    monthCount: 0,
    totalRows: 0,
    totalRevenue: 0,
  },
};

describe('consolidated Parking workspace loading', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(firestoreMock).forEach(mock => mock.mockClear());
    Object.values(storageMock).forEach(mock => mock.mockClear());
  });

  it('reads shared metadata once and downloads both stored payloads', async () => {
    const departmentDate = new Date('2026-06-15T12:00:00.000Z');
    const revenueDate = new Date('2026-06-16T12:00:00.000Z');
    firestoreMock.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        storagePath: 'teams/team-1/parking/current.json',
        importedAt: { toDate: () => departmentDate },
        importedBy: 'department-user',
        monthCount: 12,
        totalRows: 1200,
        totalValue: 3456,
        revenueStoragePath: 'teams/team-1/parking/revenue/current.json',
        revenueImportedAt: { toDate: () => revenueDate },
        revenueImportedBy: 'revenue-user',
        revenueDatasetCount: 24,
        revenueMonthCount: 12,
        revenueTotalRows: 2400,
        revenueTotalValue: 7890,
        settings: {
          codeFamilies: [{ familyKey: 'TP', codes: ['TP2026'], department: 'Transit' }],
          spotLocations: [{ spotId: 'A1', locationName: 'City Hall' }],
          flagRules: { plateMonthlyValueDollars: 999 },
        },
      }),
    });
    storageMock.getDownloadURL.mockImplementation(async ({ path }: { path: string }) => `https://storage.example/${path}`);
    const fetchMock = vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input).includes('/revenue/') ? storedRevenueSummary : storedDepartmentSummary,
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const { loadParkingWorkspaceData } = await import('../utils/parking/parkingService');
    const result = await loadParkingWorkspaceData('team-1');

    expect(firestoreMock.getDoc).toHaveBeenCalledTimes(1);
    expect(firestoreMock.getDoc).toHaveBeenCalledWith({ path: 'teams/team-1/parking/default' });
    expect(storageMock.getDownloadURL).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      'https://storage.example/teams/team-1/parking/current.json',
      'https://storage.example/teams/team-1/parking/revenue/current.json',
    ]));
    expect(result.settings.codeFamilies).toEqual(expect.arrayContaining([
      expect.objectContaining({ familyKey: 'TP', department: 'Transit' }),
    ]));
    expect(result.settings.flagRules).toMatchObject({
      plateMonthlyValueDollars: 999,
      longSessionHours: 6,
    });
    expect(result.summary?.metadata).toMatchObject({
      importedAt: departmentDate.toISOString(),
      importedBy: 'department-user',
      monthCount: 12,
      totalRows: 1200,
      totalValue: 3456,
      storagePath: 'teams/team-1/parking/current.json',
    });
    expect(result.revenueSummary?.metadata).toMatchObject({
      importedAt: revenueDate.toISOString(),
      importedBy: 'revenue-user',
      datasetCount: 24,
      monthCount: 12,
      totalRows: 2400,
      totalRevenue: 7890,
      storagePath: 'teams/team-1/parking/revenue/current.json',
    });
  });

  it('skips the revenue payload for Plate Monitor', async () => {
    firestoreMock.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        storagePath: 'teams/team-1/parking/current.json',
        revenueStoragePath: 'teams/team-1/parking/revenue/current.json',
        settings: {},
      }),
    });
    storageMock.getDownloadURL.mockImplementation(async ({ path }: { path: string }) => `https://storage.example/${path}`);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => storedDepartmentSummary,
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const { loadParkingWorkspaceData } = await import('../utils/parking/parkingService');
    const result = await loadParkingWorkspaceData('team-1', 'plate-monitor');

    expect(firestoreMock.getDoc).toHaveBeenCalledTimes(1);
    expect(storageMock.getDownloadURL).toHaveBeenCalledTimes(1);
    expect(storageMock.getDownloadURL).toHaveBeenCalledWith({ path: 'teams/team-1/parking/current.json' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.summary).not.toBeNull();
    expect(result.revenueSummary).toBeNull();
  });
});
