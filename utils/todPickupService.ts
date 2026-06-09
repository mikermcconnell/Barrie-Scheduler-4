import {
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { db, storage } from './firebase';
import type { TodPickupMetadata, TodPickupMonthlyDataset, TodPickupSummary } from './todPickupTypes';
import { TOD_PICKUP_SCHEMA_VERSION } from './todPickupTypes';

function getMetadataRef(teamId: string) {
  return doc(db, 'teams', teamId, 'todPickupData', 'metadata');
}

function getStoragePath(teamId: string, timestamp: string): string {
  return `teams/${teamId}/todPickupData/${timestamp}.json`;
}

function buildUploadPayload(value: unknown): Blob | Uint8Array {
  const json = JSON.stringify(value);
  if (typeof Blob !== 'undefined') {
    return new Blob([json], { type: 'application/json' });
  }
  return new TextEncoder().encode(json);
}

function buildMetadata(months: TodPickupMonthlyDataset[], importedBy: string): TodPickupMetadata {
  return {
    importedAt: new Date().toISOString(),
    importedBy,
    monthCount: months.length,
    totalRows: months.reduce((sum, month) => sum + month.rowCount, 0),
    totalPickups: months.reduce((sum, month) => sum + month.totalPickups, 0),
  };
}

export function buildTodPickupReplacementSummary(
  existingSummary: TodPickupSummary | null,
  dataset: TodPickupMonthlyDataset,
  importedBy: string,
  storagePath: string,
): TodPickupSummary {
  const keptMonths = (existingSummary?.months || []).filter(month => month.month !== dataset.month);
  const months = [...keptMonths, dataset].sort((a, b) => a.month.localeCompare(b.month));
  const metadata = buildMetadata(months, importedBy);
  return {
    months,
    metadata: {
      ...metadata,
      storagePath,
    },
    schemaVersion: TOD_PICKUP_SCHEMA_VERSION,
  };
}

function mergeSummaryMetadata(summary: TodPickupSummary, metadata: TodPickupMetadata): TodPickupSummary {
  return {
    ...summary,
    metadata: {
      ...summary.metadata,
      importedAt: metadata.importedAt || summary.metadata.importedAt,
      importedBy: metadata.importedBy || summary.metadata.importedBy,
      monthCount: metadata.monthCount || summary.metadata.monthCount,
      totalRows: metadata.totalRows || summary.metadata.totalRows,
      totalPickups: metadata.totalPickups || summary.metadata.totalPickups,
      storagePath: metadata.storagePath || summary.metadata.storagePath,
    },
  };
}

export function normalizeTodPickupStoragePath(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function assertTodPickupStoragePathUnchanged(
  expectedPath: string | null,
  actualPath: string | null,
): void {
  if (expectedPath !== actualPath) {
    throw new Error('TOD pickup data changed while importing. Refresh and try again.');
  }
}

export async function getTodPickupMetadata(teamId: string): Promise<TodPickupMetadata | null> {
  try {
    const snap = await getDoc(getMetadataRef(teamId));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      importedAt: data.importedAt?.toDate?.()?.toISOString?.() || new Date().toISOString(),
      importedBy: data.importedBy || '',
      monthCount: Number(data.monthCount || 0),
      totalRows: Number(data.totalRows || 0),
      totalPickups: Number(data.totalPickups || 0),
      storagePath: data.storagePath || '',
    };
  } catch (error) {
    console.error('Error getting TOD pickup metadata:', error);
    return null;
  }
}

export async function getTodPickupData(
  teamId: string,
  metadataOverride?: TodPickupMetadata | null,
): Promise<TodPickupSummary | null> {
  try {
    const metadata = metadataOverride ?? await getTodPickupMetadata(teamId);
    if (!metadata?.storagePath) return null;

    const url = await getDownloadURL(ref(storage, metadata.storagePath));
    const response = await fetch(url);
    if (!response.ok) return null;

    const summary = await response.json() as TodPickupSummary;
    return mergeSummaryMetadata(summary, metadata);
  } catch (error) {
    console.error('Error getting TOD pickup data:', error);
    return null;
  }
}

export async function saveTodPickupMonthData(
  teamId: string,
  userId: string,
  dataset: TodPickupMonthlyDataset,
): Promise<void> {
  const timestamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const storagePath = getStoragePath(teamId, timestamp);
  const metadataRef = getMetadataRef(teamId);
  const existing = await getDoc(metadataRef);
  const oldPath = existing.exists() ? normalizeTodPickupStoragePath(existing.data().storagePath) : null;

  let oldSummary: TodPickupSummary | null = null;
  if (oldPath) {
    try {
      const oldUrl = await getDownloadURL(ref(storage, oldPath));
      const response = await fetch(oldUrl);
      if (!response.ok) {
        throw new Error('Existing TOD pickup data could not be downloaded.');
      }
      oldSummary = await response.json() as TodPickupSummary;
    } catch (error) {
      console.error('Could not load existing TOD pickup data before replacement:', error);
      throw new Error('Could not load existing TOD pickup data before import. Refresh and try again.');
    }
  }

  const summary = buildTodPickupReplacementSummary(oldSummary, dataset, userId, storagePath);
  const metadata = summary.metadata;

  let uploadedNewFile = false;
  try {
    await uploadBytes(ref(storage, storagePath), buildUploadPayload(summary), {
      contentType: 'application/json',
    });
    uploadedNewFile = true;

    await runTransaction(db, async transaction => {
      const fresh = await transaction.get(metadataRef);
      const freshPath = fresh.exists() ? normalizeTodPickupStoragePath(fresh.data().storagePath) : null;
      assertTodPickupStoragePathUnchanged(oldPath, freshPath);
      transaction.set(metadataRef, {
        importedAt: serverTimestamp(),
        importedBy: userId,
        monthCount: metadata.monthCount,
        totalRows: metadata.totalRows,
        totalPickups: metadata.totalPickups,
        storagePath,
      });
    });
  } catch (error) {
    if (uploadedNewFile) {
      try {
        await deleteObject(ref(storage, storagePath));
      } catch {
        // Ignore cleanup failures for an unreferenced upload.
      }
    }
    throw error;
  }

  if (oldPath && oldPath !== storagePath) {
    try {
      await deleteObject(ref(storage, oldPath));
    } catch {
      // Ignore stale storage cleanup failures.
    }
  }
}

export async function deleteTodPickupData(teamId: string): Promise<void> {
  const metadataRef = getMetadataRef(teamId);
  const snap = await getDoc(metadataRef);
  if (!snap.exists()) return;

  const storagePath = snap.data().storagePath;
  if (storagePath) {
    try {
      await deleteObject(ref(storage, storagePath));
    } catch {
      // File may already be gone.
    }
  }
  await deleteDoc(metadataRef);
}
