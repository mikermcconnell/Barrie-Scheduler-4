import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import {
  SPECIALIZED_TRANSIT_SCHEMA_VERSION,
  type SpecializedTransitDatasetV1,
  type SpecializedTransitMetadata,
  type SpecializedTransitMonthV1,
  type SpecializedTransitLocationV1,
} from './types';
import {
  assertSafeSpecializedTransitSegment,
  isSpecializedTransitStoragePath,
  parseSpecializedTransitDataset,
} from './validation';
import {
  clearLocalSpecializedTransit,
  loadLocalSpecializedTransit,
  saveLocalSpecializedTransit,
} from './localStore';

const metadataRef = (teamId: string) => doc(db, 'teams', teamId, 'specializedTransitData', 'metadata');
const storagePrefix = (teamId: string) => `teams/${teamId}/specializedTransitData/`;

export function isLocalSpecializedTransitMode(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function parseMetadata(data: Record<string, unknown>): SpecializedTransitMetadata {
  const availableMonths = Array.isArray(data.availableMonths)
    ? data.availableMonths.filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}$/.test(value)).sort()
    : [];
  const updatedAtValue = data.updatedAt as { toDate?: () => Date } | string | undefined;
  const updatedAt = typeof updatedAtValue === 'string'
    ? updatedAtValue
    : updatedAtValue?.toDate?.().toISOString() ?? '';
  const metadata: SpecializedTransitMetadata = {
    schemaVersion: SPECIALIZED_TRANSIT_SCHEMA_VERSION,
    activeRevision: Number(data.activeRevision),
    storagePath: String(data.storagePath ?? ''),
    availableMonths,
    latestMonth: typeof data.latestMonth === 'string' ? data.latestMonth : availableMonths.at(-1) ?? null,
    updatedAt,
    updatedBy: String(data.updatedBy ?? ''),
  };
  if (data.schemaVersion !== SPECIALIZED_TRANSIT_SCHEMA_VERSION
    || !Number.isInteger(metadata.activeRevision)
    || metadata.activeRevision < 1
    || !metadata.storagePath) {
    throw new Error('Stored Specialized Transit metadata is invalid.');
  }
  return metadata;
}

function assertStoragePath(teamId: string, path: string): void {
  if (!isSpecializedTransitStoragePath(teamId, path)) {
    throw new Error('Stored Specialized Transit path is invalid.');
  }
}

export async function getSpecializedTransitMetadata(teamId: string): Promise<SpecializedTransitMetadata | null> {
  assertSafeSpecializedTransitSegment(teamId, 'Team');
  if (isLocalSpecializedTransitMode()) return (await loadLocalSpecializedTransit(teamId))?.metadata ?? null;
  const snapshot = await getDoc(metadataRef(teamId));
  return snapshot.exists() ? parseMetadata(snapshot.data()) : null;
}

export async function getSpecializedTransitDataset(
  teamId: string,
  metadataOverride?: SpecializedTransitMetadata | null,
): Promise<SpecializedTransitDatasetV1 | null> {
  if (isLocalSpecializedTransitMode()) return (await loadLocalSpecializedTransit(teamId))?.dataset ?? null;
  const metadata = metadataOverride ?? await getSpecializedTransitMetadata(teamId);
  if (!metadata) return null;
  assertStoragePath(teamId, metadata.storagePath);
  const bytes = await getBytes(ref(storage, metadata.storagePath), 8 * 1024 * 1024);
  const dataset = parseSpecializedTransitDataset(JSON.parse(new TextDecoder().decode(bytes)));
  if (dataset.revision !== metadata.activeRevision) throw new Error('Specialized Transit metadata and data revisions do not match.');
  return dataset;
}

export async function saveSpecializedTransitDataset(input: {
  teamId: string;
  userId: string;
  expectedRevision: number;
  months: Record<string, SpecializedTransitMonthV1>;
  locations: Record<string, SpecializedTransitLocationV1>;
}): Promise<{ dataset: SpecializedTransitDatasetV1; metadata: SpecializedTransitMetadata }> {
  const teamId = assertSafeSpecializedTransitSegment(input.teamId, 'Team');
  const userId = assertSafeSpecializedTransitSegment(input.userId, 'User');
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('Expected revision is invalid.');
  if (isLocalSpecializedTransitMode()) return saveLocalSpecializedTransit({ ...input, teamId, userId });

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
  const nonce = crypto.randomUUID();
  const storagePath = `${storagePrefix(teamId)}revision-${nextRevision}-${nonce}.json`;
  const storageRef = ref(storage, storagePath);
  const bytes = new TextEncoder().encode(JSON.stringify(dataset));
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Specialized Transit aggregate exceeds the 8 MB limit.');
  await uploadBytes(storageRef, bytes, { contentType: 'application/json', cacheControl: 'private,max-age=300' });

  let previousPath: string | null = null;
  try {
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(metadataRef(teamId));
      const currentRevision = snapshot.exists() ? Number(snapshot.data().activeRevision) : 0;
      if (currentRevision !== input.expectedRevision) throw new Error('Specialized Transit data changed. Reload and try again.');
      previousPath = snapshot.exists() ? String(snapshot.data().storagePath ?? '') || null : null;
      const availableMonths = Object.keys(dataset.months).sort();
      transaction.set(metadataRef(teamId), {
        schemaVersion: SPECIALIZED_TRANSIT_SCHEMA_VERSION,
        activeRevision: nextRevision,
        storagePath,
        availableMonths,
        latestMonth: availableMonths.at(-1) ?? null,
        updatedAt: serverTimestamp(),
        updatedBy: userId,
      });
    });
  } catch (error) {
    await deleteObject(storageRef).catch((_cleanupError: unknown): void => {});
    throw error;
  }
  const confirmed = await getSpecializedTransitMetadata(teamId);
  if (!confirmed || confirmed.activeRevision !== nextRevision || confirmed.storagePath !== storagePath) {
    throw new Error('Specialized Transit save could not be verified.');
  }
  if (previousPath && previousPath !== storagePath) {
    assertStoragePath(teamId, previousPath);
    await deleteObject(ref(storage, previousPath)).catch((_cleanupError: unknown): void => {});
  }
  return { dataset, metadata: confirmed };
}

export async function clearLocalSpecializedTransitDataset(teamId: string): Promise<void> {
  if (!isLocalSpecializedTransitMode()) throw new Error('Local Specialized Transit data can only be cleared on localhost.');
  await clearLocalSpecializedTransit(teamId);
}

export { parseSpecializedTransitDataset } from './validation';
