import {
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
import { db, storage } from '../firebase';
import { buildParkingLocoMobiHistorySnapshot } from './parkingLocoMobiAggregation';
import {
  PARKING_LOCOMOBI_FINANCIAL_BASIS,
  PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION,
  PARKING_LOCOMOBI_VENDOR,
  type ParkingLocoMobiHistoryRow,
  type ParkingLocoMobiHistorySnapshot,
  type ParkingLocoMobiParseResult,
} from './parkingLocoMobiTypes';

export const PARKING_STRATEGY_HISTORY_MANIFEST_VERSION = 1;

export interface ParkingStrategyHistoryPartitionDescriptor {
  month: string;
  storagePath: string;
  rowCount: number;
  totalReportedAmount: number;
  zeroAmountRowCount: number;
  observedStartDate: string;
  observedEndDate: string;
}

export interface ParkingStrategyHistoryManifest {
  schemaVersion: typeof PARKING_STRATEGY_HISTORY_MANIFEST_VERSION;
  historySchemaVersion: typeof PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION;
  revision: number;
  vendor: typeof PARKING_LOCOMOBI_VENDOR;
  financialBasis: typeof PARKING_LOCOMOBI_FINANCIAL_BASIS;
  importFingerprint: string;
  importedAt: string;
  importedBy: string;
  aggregateStoragePath: string;
  partitions: ParkingStrategyHistoryPartitionDescriptor[];
  coverage: ParkingLocoMobiHistorySnapshot['coverage'];
  reconciliation: ParkingLocoMobiHistorySnapshot['reconciliation'];
}

export interface ParkingStrategyHistoryPartition {
  schemaVersion: typeof PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION;
  vendor: typeof PARKING_LOCOMOBI_VENDOR;
  financialBasis: typeof PARKING_LOCOMOBI_FINANCIAL_BASIS;
  month: string;
  rows: ParkingLocoMobiHistoryRow[];
}

export interface ParkingStrategyHistoryData {
  manifest: ParkingStrategyHistoryManifest;
  snapshot: ParkingLocoMobiHistorySnapshot;
}

function getManifestRef(teamId: string) {
  if (!teamId.trim() || teamId.includes('/')) throw new Error('A valid Parking team is required.');
  return doc(db, 'teams', teamId, 'parking', 'history');
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function isIsoMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function timestampString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return '';
}

export function readParkingStrategyHistoryManifest(
  value: Record<string, unknown> | undefined,
  teamId?: string,
): ParkingStrategyHistoryManifest | null {
  if (!value) return null;
  if (value.schemaVersion !== PARKING_STRATEGY_HISTORY_MANIFEST_VERSION) return null;
  if (value.historySchemaVersion !== PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION) return null;
  if (value.vendor !== PARKING_LOCOMOBI_VENDOR || value.financialBasis !== PARKING_LOCOMOBI_FINANCIAL_BASIS) return null;
  if (!Number.isInteger(value.revision) || Number(value.revision) < 1) return null;
  if (typeof value.aggregateStoragePath !== 'string' || !value.aggregateStoragePath.trim()) return null;
  const pathParts = value.aggregateStoragePath.split('/');
  if (pathParts.length !== 6 || pathParts[0] !== 'teams' || !pathParts[1] || (teamId && pathParts[1] !== teamId)
    || pathParts[2] !== 'parking' || pathParts[3] !== 'history' || !pathParts[4] || pathParts[4] === '..' || pathParts[4] === '.' || pathParts[5] !== 'aggregate.json') return null;
  const prefix = pathParts.slice(0, 5).join('/');
  if (typeof value.importFingerprint !== 'string' || !value.importFingerprint.trim()) return null;
  if (!Array.isArray(value.partitions)) return null;

  const partitions: ParkingStrategyHistoryPartitionDescriptor[] = [];
  for (const item of value.partitions) {
    if (!item || typeof item !== 'object') return null;
    const raw = item as Record<string, unknown>;
    if (!isIsoMonth(raw.month) || typeof raw.storagePath !== 'string' || !raw.storagePath.trim()) return null;
    if (raw.storagePath !== `${prefix}/months/${raw.month}.json` || partitions.some(partition => partition.month === raw.month)) return null;
    if (![raw.rowCount, raw.totalReportedAmount, raw.zeroAmountRowCount].every(Number.isFinite)) return null;
    if (typeof raw.observedStartDate !== 'string' || typeof raw.observedEndDate !== 'string') return null;
    partitions.push({
      month: raw.month,
      storagePath: raw.storagePath,
      rowCount: Number(raw.rowCount),
      totalReportedAmount: Number(raw.totalReportedAmount),
      zeroAmountRowCount: Number(raw.zeroAmountRowCount),
      observedStartDate: raw.observedStartDate,
      observedEndDate: raw.observedEndDate,
    });
  }

  const coverage = value.coverage;
  const reconciliation = value.reconciliation;
  if (!coverage || typeof coverage !== 'object' || !reconciliation || typeof reconciliation !== 'object') return null;

  return {
    schemaVersion: PARKING_STRATEGY_HISTORY_MANIFEST_VERSION,
    historySchemaVersion: PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION,
    revision: Number(value.revision),
    vendor: PARKING_LOCOMOBI_VENDOR,
    financialBasis: PARKING_LOCOMOBI_FINANCIAL_BASIS,
    importFingerprint: String(value.importFingerprint),
    importedAt: timestampString(value.importedAt),
    importedBy: typeof value.importedBy === 'string' ? value.importedBy : '',
    aggregateStoragePath: value.aggregateStoragePath,
    partitions,
    coverage: coverage as ParkingLocoMobiHistorySnapshot['coverage'],
    reconciliation: reconciliation as ParkingLocoMobiHistorySnapshot['reconciliation'],
  };
}

async function downloadJson<T>(storagePath: string): Promise<T> {
  const url = await getDownloadURL(ref(storage, storagePath));
  const response = await fetch(url);
  if (!response.ok) throw new Error('Stored Parking strategy history could not be downloaded.');
  return response.json() as Promise<T>;
}

function assertHistorySnapshot(value: unknown): asserts value is ParkingLocoMobiHistorySnapshot {
  const object = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const count = (item: unknown) => Number.isInteger(item) && Number(item) >= 0;
  const values = (item: unknown): item is Record<string, unknown> => object(item)
    && count(item.rowCount) && Number.isFinite(item.totalReportedAmount) && count(item.zeroAmountRowCount) && count(item.negativeAmountRowCount);
  const strings = (item: unknown) => Array.isArray(item) && item.every(entry => typeof entry === 'string');
  const invalid = () => { throw new Error('Stored Parking strategy history aggregate is invalid. Re-import the complete archive.'); };
  if (!object(value) || value.schemaVersion !== PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION
    || value.vendor !== PARKING_LOCOMOBI_VENDOR || value.financialBasis !== PARKING_LOCOMOBI_FINANCIAL_BASIS) return invalid();
  const coverage = value.coverage;
  const reconciliation = value.reconciliation;
  if (!object(coverage) || typeof coverage.observedStartDate !== 'string' || typeof coverage.observedEndDate !== 'string'
    || !Array.isArray(coverage.observedMonths) || !coverage.observedMonths.every(isIsoMonth)
    || !Array.isArray(coverage.observedYears) || !coverage.observedYears.every(Number.isInteger) || !count(coverage.activeDateCount)
    || !object(reconciliation) || !Number.isFinite(reconciliation.totalReportedAmount)
    || !['sourceRowCount', 'acceptedRowCount', 'duplicateRowCount', 'skippedRowCount', 'zeroAmountRowCount', 'negativeAmountRowCount', 'missingPaymentChannelRowCount', 'uniqueMeterCount', 'uniqueMeterLocationCount'].every(key => count(reconciliation[key]))) return invalid();
  if (!strings(value.warnings) || !Array.isArray(value.ignoredSheets) || !Array.isArray(value.sourceTables)
    || !value.sourceTables.every(table => object(table) && typeof table.fileName === 'string' && typeof table.sheetName === 'string'
      && count(table.acceptedRowCount) && count(table.duplicateRowCount) && count(table.skippedRowCount))) return invalid();
  if (!Array.isArray(value.monthly) || !value.monthly.every(row => values(row) && isIsoMonth(row.month))
    || !Array.isArray(value.locations) || !value.locations.every(row => values(row) && typeof row.domain === 'string' && typeof row.meterId === 'string' && typeof row.locationLabel === 'string')
    || !Array.isArray(value.hourly) || value.hourly.length !== 24 || !value.hourly.every((row, hour) => values(row) && row.hour === hour)
    || !Array.isArray(value.weekdays) || !value.weekdays.every(values)
    || !Array.isArray(value.paymentChannels) || !value.paymentChannels.every(values)
    || !Array.isArray(value.domains) || !value.domains.every(values)) return invalid();
  if (value.locationMonths !== undefined) {
    if (!Array.isArray(value.locationMonths) || !value.locationMonths.every(row => values(row) && isIsoMonth(row.month)
      && typeof row.domain === 'string' && typeof row.meterId === 'string' && typeof row.locationLabel === 'string'
      && Array.isArray(row.hourlyCounts) && row.hourlyCounts.length === 24 && row.hourlyCounts.every(count)
      && row.hourlyCounts.reduce((sum: number, hour: number) => sum + hour, 0) === row.rowCount)) return invalid();
    if (value.locationMonths.reduce((sum, row) => sum + row.rowCount, 0) !== reconciliation.acceptedRowCount) return invalid();
  }
}

function stableFingerprint(parsed: ParkingLocoMobiParseResult): string {
  const input = JSON.stringify({
    aggregateIndexVersion: 2,
    vendor: parsed.vendor,
    financialBasis: parsed.financialBasis,
    // Ordering and workbook naming are provenance, not normalized evidence content.
    rows: parsed.rows.map(row => JSON.stringify({
      vendor: row.vendor, financialBasis: row.financialBasis, domain: row.domain, meterId: row.meterId,
      locationLabel: row.locationLabel, activityDate: row.activityDate, activityMonth: row.activityMonth,
      activityMinutes: row.activityMinutes, weekday: row.weekday, isWeekend: row.isWeekend,
      reportedAmount: row.reportedAmount, paymentChannel: row.paymentChannel, paymentChannelLabel: row.paymentChannelLabel,
      qualityFlags: [...row.qualityFlags].sort(),
    })).sort(),
  });
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}-${input.length}`;
}

function partitionRows(rows: ParkingLocoMobiHistoryRow[]): Map<string, ParkingLocoMobiHistoryRow[]> {
  const partitions = new Map<string, ParkingLocoMobiHistoryRow[]>();
  for (const row of rows) {
    const monthRows = partitions.get(row.activityMonth) ?? [];
    monthRows.push(row);
    partitions.set(row.activityMonth, monthRows);
  }
  return partitions;
}

function buildImportPrefix(teamId: string, revision: number): string {
  return `teams/${teamId}/parking/history/revision-${revision}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function getParkingStrategyHistory(teamId: string): Promise<ParkingStrategyHistoryData | null> {
  const snap = await getDoc(getManifestRef(teamId));
  const manifest = readParkingStrategyHistoryManifest(snap.exists() ? snap.data() : undefined, teamId);
  if (snap.exists() && !manifest) throw new Error('Stored Parking strategy history manifest is invalid.');
  if (!manifest) return null;
  const snapshot = await downloadJson<unknown>(manifest.aggregateStoragePath);
  assertHistorySnapshot(snapshot);
  return { manifest, snapshot };
}

export async function getParkingStrategyHistoryMonth(
  teamId: string,
  month: string,
): Promise<ParkingStrategyHistoryPartition | null> {
  if (!isIsoMonth(month)) throw new Error('Parking strategy history month must use YYYY-MM.');
  const snap = await getDoc(getManifestRef(teamId));
  const manifest = readParkingStrategyHistoryManifest(snap.exists() ? snap.data() : undefined, teamId);
  if (snap.exists() && !manifest) throw new Error('Stored Parking strategy history manifest is invalid.');
  const descriptor = manifest?.partitions.find(partition => partition.month === month);
  if (!descriptor) return null;
  return downloadJson<ParkingStrategyHistoryPartition>(descriptor.storagePath);
}

export async function saveParkingStrategyHistory(
  teamId: string,
  userId: string,
  parsed: ParkingLocoMobiParseResult,
  expectedRevision?: number,
): Promise<ParkingStrategyHistoryData> {
  if (parsed.rows.length === 0) throw new Error('Parking strategy history import has no accepted rows.');
  const manifestRef = getManifestRef(teamId);
  const existingSnap = await getDoc(manifestRef);
  const previous = readParkingStrategyHistoryManifest(existingSnap.exists() ? existingSnap.data() : undefined, teamId);
  if (existingSnap.exists() && !previous) throw new Error('Stored Parking strategy history manifest is invalid.');
  const previousRevision = previous?.revision ?? 0;
  if (expectedRevision != null && expectedRevision !== previousRevision) {
    throw new Error('Parking strategy history changed while importing. Refresh and try again.');
  }

  const snapshot = buildParkingLocoMobiHistorySnapshot(parsed);
  const importFingerprint = stableFingerprint(parsed);
  if (previous?.importFingerprint === importFingerprint) {
    return { manifest: previous, snapshot };
  }

  const revision = previousRevision + 1;
  const importedAt = new Date().toISOString();
  const prefix = buildImportPrefix(teamId, revision);
  const aggregateStoragePath = `${prefix}/aggregate.json`;
  const rowsByMonth = partitionRows(parsed.rows);
  const uploadedPaths: string[] = [];
  const partitions: ParkingStrategyHistoryPartitionDescriptor[] = [];

  try {
    await uploadBytes(ref(storage, aggregateStoragePath), encodeJson(snapshot), { contentType: 'application/json' });
    uploadedPaths.push(aggregateStoragePath);

    for (const [month, rows] of [...rowsByMonth.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const storagePath = `${prefix}/months/${month}.json`;
      const payload: ParkingStrategyHistoryPartition = {
        schemaVersion: PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION,
        vendor: PARKING_LOCOMOBI_VENDOR,
        financialBasis: PARKING_LOCOMOBI_FINANCIAL_BASIS,
        month,
        rows,
      };
      await uploadBytes(ref(storage, storagePath), encodeJson(payload), { contentType: 'application/json' });
      uploadedPaths.push(storagePath);
      const dates = rows.map(row => row.activityDate).sort();
      partitions.push({
        month,
        storagePath,
        rowCount: rows.length,
        totalReportedAmount: roundMoney(rows.reduce((sum, row) => sum + row.reportedAmount, 0)),
        zeroAmountRowCount: rows.filter(row => row.qualityFlags.includes('zero_amount')).length,
        observedStartDate: dates[0],
        observedEndDate: dates[dates.length - 1],
      });
    }

    const manifest: ParkingStrategyHistoryManifest = {
      schemaVersion: PARKING_STRATEGY_HISTORY_MANIFEST_VERSION,
      historySchemaVersion: PARKING_LOCOMOBI_HISTORY_SCHEMA_VERSION,
      revision,
      vendor: PARKING_LOCOMOBI_VENDOR,
      financialBasis: PARKING_LOCOMOBI_FINANCIAL_BASIS,
      importFingerprint,
      importedAt,
      importedBy: userId,
      aggregateStoragePath,
      partitions,
      coverage: snapshot.coverage,
      reconciliation: snapshot.reconciliation,
    };

    await runTransaction(db, async transaction => {
      const fresh = await transaction.get(manifestRef);
      const freshManifest = readParkingStrategyHistoryManifest(fresh.exists() ? fresh.data() : undefined, teamId);
      if (fresh.exists() && !freshManifest) throw new Error('Stored Parking strategy history manifest is invalid.');
      if ((freshManifest?.revision ?? 0) !== previousRevision) {
        throw new Error('Parking strategy history changed while importing. Refresh and try again.');
      }
      transaction.set(manifestRef, {
        ...manifest,
        importedAtServer: serverTimestamp(),
      });
    });

    const previousPaths = previous
      ? [previous.aggregateStoragePath, ...previous.partitions.map(partition => partition.storagePath)]
      : [];
    await Promise.all(previousPaths.map(async path => {
      if (uploadedPaths.includes(path)) return;
      try { await deleteObject(ref(storage, path)); } catch { /* stale history cleanup is best effort */ }
    }));

    return { manifest, snapshot };
  } catch (error) {
    await Promise.all(uploadedPaths.map(async path => {
      try { await deleteObject(ref(storage, path)); } catch { /* orphan cleanup is best effort */ }
    }));
    throw error;
  }
}
