import {
  SPECIALIZED_TRANSIT_SCHEMA_VERSION,
  type SpecializedTransitDatasetV1,
  type SpecializedTransitLocationV1,
  type SpecializedTransitMetadata,
  type SpecializedTransitMonthV1,
} from './types';
import { assertSafeSpecializedTransitSegment, parseSpecializedTransitDataset } from './validation';

const DATABASE_NAME = 'scheduler4-specialized-transit-local';
const DATABASE_VERSION = 2;
const DATASET_STORE = 'datasets';
const REPORT_STORE = 'reportFiles';
const MAX_AGGREGATE_BYTES = 8 * 1024 * 1024;

interface StoredSpecializedTransitRecord {
  teamId: string;
  dataset: SpecializedTransitDatasetV1;
  metadata: SpecializedTransitMetadata;
}

function getIndexedDb(factory?: IDBFactory): IDBFactory | null {
  if (factory) return factory;
  return typeof indexedDB === 'undefined' ? null : indexedDB;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage transaction failed.'));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DATASET_STORE)) {
        request.result.createObjectStore(DATASET_STORE, { keyPath: 'teamId' });
      }
      if (!request.result.objectStoreNames.contains(REPORT_STORE)) {
        request.result.createObjectStore(REPORT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'));
    request.onblocked = () => reject(new Error('Browser storage is blocked by another open app window.'));
  });
}

interface SavedReportFile {
  name: string;
  type: string;
  lastModified: number;
  bytes: ArrayBuffer;
}

export interface SavedSpecializedTransitReports {
  monthly: SavedReportFile;
  common: SavedReportFile;
}

// Raw reports stay on this device, isolated by signed-in user and team.
export async function accessLocalSpecializedTransitReports(
  teamId: string,
  userId: string,
  action: 'load' | 'save' | 'clear',
  reports?: SavedSpecializedTransitReports,
  factory?: IDBFactory,
): Promise<SavedSpecializedTransitReports | null> {
  assertSafeSpecializedTransitSegment(teamId, 'Team');
  assertSafeSpecializedTransitSegment(userId, 'User');
  const indexedDb = getIndexedDb(factory);
  if (!indexedDb) {
    if (action === 'load') return null;
    throw new Error('Browser file storage is unavailable.');
  }
  if (action === 'save' && !reports) throw new Error('Select both reports before saving.');
  const database = await openDatabase(indexedDb);
  try {
    const transaction = database.transaction(REPORT_STORE, action === 'load' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore(REPORT_STORE);
    const key = [teamId, userId];
    const completion = transactionComplete(transaction);
    const request = action === 'load' ? store.get(key)
      : action === 'clear' ? store.delete(key) : store.put(reports, key);
    const [result] = await Promise.all([requestResult(request), completion]);
    return action === 'load' ? result ?? null : reports ?? null;
  } finally {
    database.close();
  }
}

function validateStoredRecord(teamId: string, value: unknown): StoredSpecializedTransitRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Local Specialized Transit data is invalid. Clear it and import the reports again.');
  }
  const record = value as Partial<StoredSpecializedTransitRecord>;
  if (record.teamId !== teamId || !record.metadata) {
    throw new Error('Local Specialized Transit data is invalid. Clear it and import the reports again.');
  }
  const dataset = parseSpecializedTransitDataset(record.dataset);
  if (record.metadata.schemaVersion !== SPECIALIZED_TRANSIT_SCHEMA_VERSION
      || record.metadata.activeRevision !== dataset.revision
      || !record.metadata.storagePath.startsWith(`local-specialized-transit://${teamId}/revision-`)) {
    throw new Error('Local Specialized Transit data is invalid. Clear it and import the reports again.');
  }
  return { teamId, dataset, metadata: record.metadata };
}

export async function loadLocalSpecializedTransit(
  teamIdValue: string,
  factory?: IDBFactory,
): Promise<StoredSpecializedTransitRecord | null> {
  const teamId = assertSafeSpecializedTransitSegment(teamIdValue, 'Team');
  const indexedDb = getIndexedDb(factory);
  if (!indexedDb) return null;
  const database = await openDatabase(indexedDb);
  try {
    const transaction = database.transaction(DATASET_STORE, 'readonly');
    const request = transaction.objectStore(DATASET_STORE).get(teamId);
    const [value] = await Promise.all([requestResult(request), transactionComplete(transaction)]);
    return value === undefined ? null : validateStoredRecord(teamId, value);
  } finally {
    database.close();
  }
}

export async function saveLocalSpecializedTransit(input: {
  teamId: string;
  userId: string;
  expectedRevision: number;
  months: Record<string, SpecializedTransitMonthV1>;
  locations: Record<string, SpecializedTransitLocationV1>;
}, factory?: IDBFactory): Promise<{ dataset: SpecializedTransitDatasetV1; metadata: SpecializedTransitMetadata }> {
  const teamId = assertSafeSpecializedTransitSegment(input.teamId, 'Team');
  const userId = assertSafeSpecializedTransitSegment(input.userId, 'User');
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error('Expected revision is invalid.');
  }
  const indexedDb = getIndexedDb(factory);
  if (!indexedDb) throw new Error('Browser storage is unavailable.');

  const nextRevision = input.expectedRevision + 1;
  const updatedAt = new Date().toISOString();
  const dataset = parseSpecializedTransitDataset({
    schemaVersion: SPECIALIZED_TRANSIT_SCHEMA_VERSION,
    revision: nextRevision,
    updatedAt,
    updatedBy: userId,
    months: input.months,
    locations: input.locations,
  });
  const serialized = JSON.stringify(dataset);
  if (new TextEncoder().encode(serialized).byteLength > MAX_AGGREGATE_BYTES) {
    throw new Error('Specialized Transit aggregate exceeds the 8 MB local limit.');
  }
  const availableMonths = Object.keys(dataset.months).sort();
  const metadata: SpecializedTransitMetadata = {
    schemaVersion: SPECIALIZED_TRANSIT_SCHEMA_VERSION,
    activeRevision: nextRevision,
    storagePath: `local-specialized-transit://${teamId}/revision-${nextRevision}`,
    availableMonths,
    latestMonth: availableMonths.at(-1) ?? null,
    updatedAt,
    updatedBy: userId,
  };

  const database = await openDatabase(indexedDb);
  try {
    const transaction = database.transaction(DATASET_STORE, 'readwrite');
    const store = transaction.objectStore(DATASET_STORE);
    const existing = await requestResult<StoredSpecializedTransitRecord | undefined>(store.get(teamId));
    const currentRevision = existing ? validateStoredRecord(teamId, existing).dataset.revision : 0;
    if (currentRevision !== input.expectedRevision) {
      transaction.abort();
      throw new Error('Specialized Transit local data changed. Reload and try again.');
    }
    store.put({ teamId, dataset, metadata } satisfies StoredSpecializedTransitRecord);
    await transactionComplete(transaction);
    return { dataset, metadata };
  } finally {
    database.close();
  }
}

export async function clearLocalSpecializedTransit(teamIdValue: string, factory?: IDBFactory): Promise<boolean> {
  const teamId = assertSafeSpecializedTransitSegment(teamIdValue, 'Team');
  const indexedDb = getIndexedDb(factory);
  if (!indexedDb) return false;
  const database = await openDatabase(indexedDb);
  try {
    const transaction = database.transaction(DATASET_STORE, 'readwrite');
    transaction.objectStore(DATASET_STORE).delete(teamId);
    await transactionComplete(transaction);
    return true;
  } finally {
    database.close();
  }
}
