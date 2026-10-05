import { doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { parkingStrategySourceKey, type ParkingStrategyLocationLink } from './parkingStrategyModel';
export { createParkingStrategyLocationLink, parkingStrategySourceKey, type ParkingStrategyLocationLink } from './parkingStrategyModel';

export interface ParkingStrategyLocations {
  revision: number;
  links: ParkingStrategyLocationLink[];
  updatedAt: string;
  updatedBy: string;
}

function locationRef(teamId: string) {
  if (!teamId.trim() || teamId.includes('/')) throw new Error('A valid Parking team is required.');
  return doc(db, 'teams', teamId, 'parking', 'historyLocations');
}

function validateLinks(value: unknown): ParkingStrategyLocationLink[] {
  if (!Array.isArray(value)) throw new Error('Invalid Parking strategy location links.');
  const seen = new Set<string>();
  return value.map(link => {
    if (!link || link.vendor !== 'locomobi' || typeof link.domain !== 'string' || typeof link.meterId !== 'string' || !link.meterId.trim()
      || typeof link.locationId !== 'string' || !link.locationId.trim() || link.sourceKey !== parkingStrategySourceKey(link.domain, link.meterId) || seen.has(link.sourceKey)) {
      throw new Error('Invalid or duplicate Parking strategy source mapping.');
    }
    seen.add(link.sourceKey);
    return { sourceKey: link.sourceKey, vendor: 'locomobi', domain: link.domain, meterId: link.meterId, locationId: link.locationId };
  });
}

function readLocations(value: Record<string, unknown> | undefined): ParkingStrategyLocations {
  if (!value) return { revision: 0, links: [], updatedAt: '', updatedBy: '' };
  if (value.schemaVersion !== 1 || !Number.isInteger(value.revision) || Number(value.revision) < 1) throw new Error('Stored Parking strategy location settings are invalid.');
  return { revision: Number(value.revision), links: validateLinks(value.links), updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '', updatedBy: typeof value.updatedBy === 'string' ? value.updatedBy : '' };
}

export async function getParkingStrategyLocations(teamId: string): Promise<ParkingStrategyLocations> {
  const snapshot = await getDoc(locationRef(teamId));
  return readLocations(snapshot.exists() ? snapshot.data() : undefined);
}

/** Full reviewed-link replacement. Omit a source key to unmap it. */
export async function saveParkingStrategyLocations(teamId: string, userId: string, links: ParkingStrategyLocationLink[], expectedRevision: number): Promise<ParkingStrategyLocations> {
  const target = locationRef(teamId);
  const safeLinks = validateLinks(links);
  if (!userId.trim() || !Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('A user and expected mapping revision are required.');
  return runTransaction(db, async transaction => {
    const previous = await transaction.get(target);
    const current = readLocations(previous.exists() ? previous.data() : undefined);
    if (current.revision !== expectedRevision) throw new Error('Parking strategy location links changed. Refresh and try again.');
    const result = { revision: current.revision + 1, links: safeLinks, updatedAt: new Date().toISOString(), updatedBy: userId };
    transaction.set(target, { schemaVersion: 1, ...result, updatedAtServer: serverTimestamp() });
    return result;
  });
}
