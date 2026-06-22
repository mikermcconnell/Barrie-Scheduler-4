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
import { buildParkingMonthAnalysis, buildParkingReplacementSummary, buildParkingSummary, mergeParkingSettings } from './parkingAggregation';
import {
  DEFAULT_PARKING_SETTINGS,
  type ParkingMonthlyDataset,
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

export function readParkingSettingsFromDocument(data: Record<string, unknown> | undefined): ParkingSettings {
  const settingsValue = data?.settings;
  if (!settingsValue || typeof settingsValue !== 'object') {
    return mergeParkingSettings(DEFAULT_PARKING_SETTINGS, DEFAULT_PARKING_SETTINGS);
  }

  const rawSettings = settingsValue as Partial<ParkingSettings>;
  return mergeParkingSettings(DEFAULT_PARKING_SETTINGS, {
    codeFamilies: Array.isArray(rawSettings.codeFamilies) ? rawSettings.codeFamilies : DEFAULT_PARKING_SETTINGS.codeFamilies,
    spotLocations: Array.isArray(rawSettings.spotLocations) ? rawSettings.spotLocations : DEFAULT_PARKING_SETTINGS.spotLocations,
    flagRules: {
      ...DEFAULT_PARKING_SETTINGS.flagRules,
      ...(typeof rawSettings.flagRules === 'object' && rawSettings.flagRules ? rawSettings.flagRules : {}),
    },
    updatedAt: typeof rawSettings.updatedAt === 'string' ? rawSettings.updatedAt : undefined,
    updatedBy: typeof rawSettings.updatedBy === 'string' ? rawSettings.updatedBy : undefined,
  });
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

export async function getParkingData(teamId: string): Promise<ParkingSummary | null> {
  const snap = await getDoc(getParkingDefaultRef(teamId));
  if (!snap.exists()) return null;
  const metadata = readMetadata(snap.data());
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

export function rebuildParkingSummaryWithRules(
  summary: ParkingSummary,
  importedBy: string,
  storagePath: string | undefined,
  settings: ParkingSettings,
): ParkingSummary {
  const months = summary.months.map(month => {
    const analysis = buildParkingMonthAnalysis(month.rows, settings.flagRules);
    return {
      ...month,
      departmentSummaries: analysis.departmentSummaries,
      platePatterns: analysis.platePatterns,
    };
  });
  return buildParkingSummary(months, importedBy, storagePath, settings.flagRules);
}

export async function saveParkingMonthData(
  teamId: string,
  userId: string,
  dataset: ParkingMonthlyDataset,
  settings: ParkingSettings,
): Promise<ParkingSummary> {
  const timestamp = `${dataset.month}_${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const storagePath = getStoragePath(teamId, timestamp);
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

  const summary = buildParkingReplacementSummary(oldSummary, dataset, userId, storagePath, settings.flagRules);
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
        settings: {
          ...settings,
          updatedAt: settings.updatedAt || new Date().toISOString(),
          updatedBy: settings.updatedBy || userId,
        },
      }, { merge: true });
      transaction.set(getParkingMonthRef(teamId, dataset.month), {
        month: dataset.month,
        importedAt: serverTimestamp(),
        importedBy: userId,
        sourceFileName: dataset.sourceFileName,
        rowCount: dataset.rowCount,
        totalValue: dataset.totalValue,
        storagePath,
      });
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

