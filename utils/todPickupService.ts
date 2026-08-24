import { doc, getDoc } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { db, storage } from './firebase';
import type { TodPickupMetadata, TodPickupSummary } from './todPickupTypes';

function getMetadataRef(teamId: string) {
  return doc(db, 'teams', teamId, 'todPickupData', 'metadata');
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
      dailyReportCount: metadata.dailyReportCount ?? summary.metadata.dailyReportCount,
      dailyDateRange: metadata.dailyDateRange ?? summary.metadata.dailyDateRange,
      totalCompletedTrips: metadata.totalCompletedTrips ?? summary.metadata.totalCompletedTrips,
      storagePath: metadata.storagePath || summary.metadata.storagePath,
    },
  };
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
      dailyReportCount: Number(data.dailyReportCount || 0),
      dailyDateRange: data.dailyDateRange?.start && data.dailyDateRange?.end
        ? { start: String(data.dailyDateRange.start), end: String(data.dailyDateRange.end) }
        : undefined,
      totalCompletedTrips: Number(data.totalCompletedTrips || 0),
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
