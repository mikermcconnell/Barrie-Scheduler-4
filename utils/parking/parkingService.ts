import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { db, storage } from '../firebase';
import { buildParkingMonthAnalysis, buildParkingReplacementSummaryForMonths, buildParkingSummary, mergeParkingSettings } from './parkingAggregation';
import { buildParkingRevenueReplacementSummary } from './parkingRevenue';
import {
  DEFAULT_PARKING_SETTINGS,
  type ParkingMonthlyDataset,
  type ParkingRevenueDataset,
  type ParkingRevenueSummary,
  type ParkingRevenueSummaryMetadata,
  type ParkingSettings,
  type ParkingSummary,
  type ParkingSummaryMetadata,
} from './parkingTypes';

function getParkingDefaultRef(teamId: string) {
  return doc(db, 'teams', teamId, 'parking', 'default');
}

function getParkingMonthRef(teamId: string, month: string) {
  return doc(db, 'teams', teamId, 'parking', 'default', 'months', month);
}

function getStoragePath(teamId: string, timestamp: string): string {
  return `teams/${teamId}/parking/${timestamp}.json`;
}

function getRevenueStoragePath(teamId: string, timestamp: string): string {
  return `teams/${teamId}/parking/revenue/${timestamp}.json`;
}

function getImportStorageKey(datasets: ParkingMonthlyDataset[]): string {
  const months = datasets.map(dataset => dataset.month).sort();
  const prefix = months.length === 1
    ? months[0]
    : `${months[0]}_to_${months.at(-1)}_${months.length}months`;
  return `${prefix}_${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getRevenueImportStorageKey(datasets: ParkingRevenueDataset[]): string {
  const keys = datasets.map(dataset => `${dataset.month}_${dataset.source}`).sort();
  const prefix = keys.length === 1
    ? keys[0]
    : `${keys[0]}_to_${keys.at(-1)}_${keys.length}datasets`;
  return `${prefix}_${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildUploadPayload(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function normalizeParkingStoragePath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function assertParkingStoragePathUnchanged(expectedPath: string | null, actualPath: string | null): void {
  if (expectedPath !== actualPath) {
    throw new Error('Parking data changed while importing. Refresh and try again.');
  }
}

function readDepartmentLegendSort(value: unknown): ParkingSettings['departmentLegendSort'] {
  if (!value || typeof value !== 'object') return DEFAULT_PARKING_SETTINGS.departmentLegendSort;
  const raw = value as Record<string, unknown>;
  const key = raw.key;
  const direction = raw.direction;
  const validKey = key === 'color' || key === 'code' || key === 'department' || key === 'ignoreData' || key === 'ignoreFlags';
  const validDirection = direction === 'asc' || direction === 'desc';
  return {
    key: validKey ? key : 'color',
    direction: validDirection ? direction : 'asc',
  };
}

export function readParkingSettingsFromDocument(data: Record<string, unknown> | undefined): ParkingSettings {
  const settingsValue = data?.settings;
  if (!settingsValue || typeof settingsValue !== 'object') {
    return mergeParkingSettings(DEFAULT_PARKING_SETTINGS, DEFAULT_PARKING_SETTINGS);
  }

  const rawSettings = settingsValue as Partial<ParkingSettings>;
  return mergeParkingSettings(DEFAULT_PARKING_SETTINGS, {
    codeFamilies: Array.isArray(rawSettings.codeFamilies) ? rawSettings.codeFamilies : DEFAULT_PARKING_SETTINGS.codeFamilies,
    spotLocations: Array.isArray(rawSettings.spotLocations) ? rawSettings.spotLocations : DEFAULT_PARKING_SETTINGS.spotLocations,
    revenueLocations: Array.isArray(rawSettings.revenueLocations) ? rawSettings.revenueLocations : DEFAULT_PARKING_SETTINGS.revenueLocations,
    revenueLocationCategories: Array.isArray(rawSettings.revenueLocationCategories) ? rawSettings.revenueLocationCategories : DEFAULT_PARKING_SETTINGS.revenueLocationCategories,
    flagRules: {
      ...DEFAULT_PARKING_SETTINGS.flagRules,
      ...(typeof rawSettings.flagRules === 'object' && rawSettings.flagRules ? rawSettings.flagRules : {}),
    },
    departmentLegendSort: readDepartmentLegendSort(rawSettings.departmentLegendSort),
    updatedAt: typeof rawSettings.updatedAt === 'string' ? rawSettings.updatedAt : undefined,
    updatedBy: typeof rawSettings.updatedBy === 'string' ? rawSettings.updatedBy : undefined,
  });
}

function readRevenueMetadata(data: Record<string, unknown> | undefined): ParkingRevenueSummaryMetadata | null {
  const storagePath = normalizeParkingStoragePath(data?.revenueStoragePath);
  if (!storagePath) return null;
  return {
    importedAt: data?.revenueImportedAt && typeof (data.revenueImportedAt as { toDate?: () => Date }).toDate === 'function'
      ? (data.revenueImportedAt as { toDate: () => Date }).toDate().toISOString()
      : typeof data?.revenueImportedAt === 'string'
        ? data.revenueImportedAt
        : '',
    importedBy: typeof data?.revenueImportedBy === 'string' ? data.revenueImportedBy : '',
    datasetCount: Number(data?.revenueDatasetCount || 0),
    monthCount: Number(data?.revenueMonthCount || 0),
    totalRows: Number(data?.revenueTotalRows || 0),
    totalRevenue: Number(data?.revenueTotalValue || 0),
    storagePath,
  };
}

function readMetadata(data: Record<string, unknown> | undefined): ParkingSummaryMetadata | null {
  const storagePath = normalizeParkingStoragePath(data?.storagePath);
  if (!storagePath) return null;
  return {
    importedAt: data?.importedAt && typeof (data.importedAt as { toDate?: () => Date }).toDate === 'function'
      ? (data.importedAt as { toDate: () => Date }).toDate().toISOString()
      : typeof data?.importedAt === 'string'
        ? data.importedAt
        : '',
    importedBy: typeof data?.importedBy === 'string' ? data.importedBy : '',
    monthCount: Number(data?.monthCount || 0),
    totalRows: Number(data?.totalRows || 0),
    totalValue: Number(data?.totalValue || 0),
    storagePath,
  };
}

export async function getParkingSettings(teamId: string): Promise<ParkingSettings> {
  const snap = await getDoc(getParkingDefaultRef(teamId));
  return readParkingSettingsFromDocument(snap.exists() ? snap.data() : undefined);
}

export async function saveParkingSettings(teamId: string, userId: string, settings: ParkingSettings): Promise<ParkingSettings> {
  const nextSettings: ParkingSettings = {
    ...mergeParkingSettings(DEFAULT_PARKING_SETTINGS, settings),
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };
  await setDoc(getParkingDefaultRef(teamId), {
    settings: nextSettings,
    settingsUpdatedAt: serverTimestamp(),
    settingsUpdatedBy: userId,
  }, { merge: true });
  return nextSettings;
}

async function loadParkingDataFromDocument(data: Record<string, unknown> | undefined): Promise<ParkingSummary | null> {
  const metadata = readMetadata(data);
  if (!metadata?.storagePath) return null;

  const url = await getDownloadURL(ref(storage, metadata.storagePath));
  const response = await fetch(url);
  if (!response.ok) return null;
  const summary = await response.json() as ParkingSummary;
  return {
    ...summary,
    metadata: {
      ...summary.metadata,
      ...metadata,
    },
  };
}

async function loadParkingRevenueDataFromDocument(data: Record<string, unknown> | undefined): Promise<ParkingRevenueSummary | null> {
  const metadata = readRevenueMetadata(data);
  if (!metadata?.storagePath) return null;

  const url = await getDownloadURL(ref(storage, metadata.storagePath));
  const response = await fetch(url);
  if (!response.ok) return null;
  const summary = await response.json() as ParkingRevenueSummary;
  return {
    ...summary,
    metadata: {
      ...summary.metadata,
      ...metadata,
    },
  };
}

export async function getParkingData(teamId: string): Promise<ParkingSummary | null> {
  const snap = await getDoc(getParkingDefaultRef(teamId));
  return loadParkingDataFromDocument(snap.exists() ? snap.data() : undefined);
}

export async function getParkingRevenueData(teamId: string): Promise<ParkingRevenueSummary | null> {
  const snap = await getDoc(getParkingDefaultRef(teamId));
  return loadParkingRevenueDataFromDocument(snap.exists() ? snap.data() : undefined);
}

export interface ParkingWorkspaceData {
  settings: ParkingSettings;
  summary: ParkingSummary | null;
  revenueSummary: ParkingRevenueSummary | null;
}

export async function loadParkingWorkspaceData(teamId: string): Promise<ParkingWorkspaceData> {
  const snap = await getDoc(getParkingDefaultRef(teamId));
  const data = snap.exists() ? snap.data() : undefined;
  const [summary, revenueSummary] = await Promise.all([
    loadParkingDataFromDocument(data),
    loadParkingRevenueDataFromDocument(data),
  ]);

  return {
    settings: readParkingSettingsFromDocument(data),
    summary,
    revenueSummary,
  };
}

export function rebuildParkingSummaryWithRules(
  summary: ParkingSummary,
  importedBy: string,
  storagePath: string | undefined,
  settings: ParkingSettings,
): ParkingSummary {
  const months = summary.months.map(month => {
    const analysis = buildParkingMonthAnalysis(month.rows, settings);
    return {
      ...month,
      departmentSummaries: analysis.departmentSummaries,
      platePatterns: analysis.platePatterns,
    };
  });
  return buildParkingSummary(months, importedBy, storagePath, settings);
}

export async function saveParkingMonthData(
  teamId: string,
  userId: string,
  dataset: ParkingMonthlyDataset,
  settings: ParkingSettings,
): Promise<ParkingSummary> {
  return saveParkingMonthsData(teamId, userId, [dataset], settings);
}

export async function saveParkingMonthsData(
  teamId: string,
  userId: string,
  datasets: ParkingMonthlyDataset[],
  settings: ParkingSettings,
): Promise<ParkingSummary> {
  if (datasets.length === 0) {
    throw new Error('Select at least one Parking month to save.');
  }
  const months = new Set<string>();
  for (const dataset of datasets) {
    if (months.has(dataset.month)) {
      throw new Error('Parking batch imports must contain different months.');
    }
    months.add(dataset.month);
  }

  const storagePath = getStoragePath(teamId, getImportStorageKey(datasets));
  const defaultRef = getParkingDefaultRef(teamId);
  const existing = await getDoc(defaultRef);
  const oldPath = existing.exists() ? normalizeParkingStoragePath(existing.data().storagePath) : null;

  let oldSummary: ParkingSummary | null = null;
  if (oldPath) {
    const oldUrl = await getDownloadURL(ref(storage, oldPath));
    const response = await fetch(oldUrl);
    if (!response.ok) throw new Error('Existing Parking data could not be downloaded.');
    oldSummary = await response.json() as ParkingSummary;
  }

  const summary = buildParkingReplacementSummaryForMonths(oldSummary, datasets, userId, storagePath, settings);
  let uploadedNewFile = false;
  try {
    await uploadBytes(ref(storage, storagePath), buildUploadPayload(summary), { contentType: 'application/json' });
    uploadedNewFile = true;

    await runTransaction(db, async transaction => {
      const fresh = await transaction.get(defaultRef);
      const freshPath = fresh.exists() ? normalizeParkingStoragePath(fresh.data().storagePath) : null;
      assertParkingStoragePathUnchanged(oldPath, freshPath);
      transaction.set(defaultRef, {
        importedAt: serverTimestamp(),
        importedBy: userId,
        monthCount: summary.metadata.monthCount,
        totalRows: summary.metadata.totalRows,
        totalValue: summary.metadata.totalValue,
        storagePath,
      }, { merge: true });
      // Every month document points at the active composite payload. Refresh all
      // pointers before the previous object is removed, not only replaced months.
      for (const dataset of summary.months) {
        transaction.set(getParkingMonthRef(teamId, dataset.month), {
          month: dataset.month,
          importedAt: dataset.importedAt || serverTimestamp(),
          importedBy: dataset.importedBy || userId,
          sourceFileName: dataset.sourceFileName,
          rowCount: dataset.rowCount,
          totalValue: dataset.totalValue,
          storagePath,
        });
      }
    });
  } catch (error) {
    if (uploadedNewFile) {
      try { await deleteObject(ref(storage, storagePath)); } catch { /* ignore cleanup failure */ }
    }
    throw error;
  }

  if (oldPath && oldPath !== storagePath) {
    try { await deleteObject(ref(storage, oldPath)); } catch { /* ignore stale cleanup failure */ }
  }

  return summary;
}

export async function saveParkingRevenueDatasets(
  teamId: string,
  userId: string,
  datasets: ParkingRevenueDataset[],
  _settings: ParkingSettings,
): Promise<ParkingRevenueSummary> {
  if (datasets.length === 0) {
    throw new Error('Select at least one Parking revenue file to save.');
  }
  const keys = new Set<string>();
  for (const dataset of datasets) {
    const key = `${dataset.month}|${dataset.source}`;
    if (keys.has(key)) {
      throw new Error('Parking revenue batch imports must contain different source/month combinations.');
    }
    keys.add(key);
  }

  const storagePath = getRevenueStoragePath(teamId, getRevenueImportStorageKey(datasets));
  const defaultRef = getParkingDefaultRef(teamId);
  const existing = await getDoc(defaultRef);
  const oldPath = existing.exists() ? normalizeParkingStoragePath(existing.data().revenueStoragePath) : null;

  let oldSummary: ParkingRevenueSummary | null = null;
  if (oldPath) {
    const oldUrl = await getDownloadURL(ref(storage, oldPath));
    const response = await fetch(oldUrl);
    if (!response.ok) throw new Error('Existing Parking revenue data could not be downloaded.');
    oldSummary = await response.json() as ParkingRevenueSummary;
  }

  const summary = buildParkingRevenueReplacementSummary(oldSummary, datasets, userId, storagePath);
  let uploadedNewFile = false;
  try {
    await uploadBytes(ref(storage, storagePath), buildUploadPayload(summary), { contentType: 'application/json' });
    uploadedNewFile = true;

    await runTransaction(db, async transaction => {
      const fresh = await transaction.get(defaultRef);
      const freshPath = fresh.exists() ? normalizeParkingStoragePath(fresh.data().revenueStoragePath) : null;
      assertParkingStoragePathUnchanged(oldPath, freshPath);
      transaction.set(defaultRef, {
        revenueImportedAt: serverTimestamp(),
        revenueImportedBy: userId,
        revenueDatasetCount: summary.metadata.datasetCount,
        revenueMonthCount: summary.metadata.monthCount,
        revenueTotalRows: summary.metadata.totalRows,
        revenueTotalValue: summary.metadata.totalRevenue,
        revenueStoragePath: storagePath,
      }, { merge: true });
      // Revenue month metadata also references the active composite payload.
      for (const dataset of summary.datasets) {
        transaction.set(getParkingMonthRef(teamId, `revenue_${dataset.source}_${dataset.month}`), {
          month: dataset.month,
          source: dataset.source,
          importedAt: dataset.importedAt || serverTimestamp(),
          importedBy: dataset.importedBy || userId,
          sourceFileName: dataset.sourceFileName,
          rowCount: dataset.rowCount,
          totalValue: dataset.totalRevenue,
          storagePath,
          kind: 'revenue',
        });
      }
    });
  } catch (error) {
    if (uploadedNewFile) {
      try { await deleteObject(ref(storage, storagePath)); } catch { /* ignore cleanup failure */ }
    }
    throw error;
  }

  if (oldPath && oldPath !== storagePath) {
    try { await deleteObject(ref(storage, oldPath)); } catch { /* ignore stale cleanup failure */ }
  }

  return summary;
}

