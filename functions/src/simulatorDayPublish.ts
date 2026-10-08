/**
 * Publishes simulator day files for a completed STREETS import (docs/SIMULATOR_FEED.md).
 *
 * Reads the import's archived raw CSV, builds one day file per service date, uploads each to an
 * immutable generation path, then moves the date's pointer in `teams/{teamId}/simulatorFeed/metadata`
 * inside a transaction. A day is only replaced by an import with an equal or newer source revision,
 * so a late-finishing older import never overwrites a same-day correction.
 *
 * No trigger code here, so scripts can call it with an initialized Admin app.
 */
import { createHash, randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { parseSTREETSCSV } from './parser';
import {
  DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG,
  normalizePerformanceLoadCapacityConfig,
} from './performanceLoadCapacity';
import {
  buildSimulatorDay,
  expiredSimulatorDays,
  indexGtfsZip,
  selectGtfsSnapshot,
  shouldReplaceSimulatorDay,
  simulatorDayStoragePath,
  type ArchivedGtfsSnapshot,
  type SimulatorDayPointer,
  type SimulatorGtfsIndex,
} from './simulatorDay';
import type { PerformanceLoadCapacityConfig } from './types';

export const SIMULATOR_FEED_METADATA_PATH = (teamId: string) => `teams/${teamId}/simulatorFeed/metadata`;

export interface SimulatorImportRun {
  rawStoragePath?: string;
  sourceRevision?: string | number;
  importedAt?: admin.firestore.Timestamp | null;
}

export interface PublishSimulatorDaysResult {
  published: string[];
  skippedOlder: string[];
  removedExpired: string[];
}

/** Mirrors index.ts normalizePerformanceSourceRevision (13-digit timestamp prefix sorts by time). */
function sourceRevisionOf(run: SimulatorImportRun, importId: string): string {
  const value = run.sourceRevision;
  const fromMillis = (ms: number, id: string) => `${Math.trunc(ms).toString().padStart(13, '0')}-${id}`;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return fromMillis(value, 'legacy-number');
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return fromMillis(Number(trimmed), 'legacy-number');
    if (/^\d{13,}-.+$/.test(trimmed)) return trimmed;
  }
  return fromMillis(run.importedAt?.toMillis?.() ?? 0, importId);
}

async function loadCapacity(db: admin.firestore.Firestore, teamId: string): Promise<PerformanceLoadCapacityConfig> {
  const snap = await db.doc(`teams/${teamId}/performanceConfig/load`).get();
  return snap.exists ? normalizePerformanceLoadCapacityConfig(snap.data()) : DEFAULT_PERFORMANCE_LOAD_CAPACITY_CONFIG;
}

async function loadGtfsSnapshots(db: admin.firestore.Firestore): Promise<ArchivedGtfsSnapshot[]> {
  const snap = await db.collection('gtfsArchive/barrie/snapshots').get();
  return snap.docs.map(d => d.data() as ArchivedGtfsSnapshot).filter(s => typeof s.zipPath === 'string' && s.zipPath.startsWith('gtfs-archive/barrie/'));
}

export async function publishSimulatorDaysForImport(params: {
  db: admin.firestore.Firestore;
  bucket: ReturnType<admin.storage.Storage['bucket']>;
  teamId: string;
  importId: string;
  run: SimulatorImportRun;
  /** Only these service dates (default: every date in the import). */
  dates?: string[];
  dryRun?: boolean;
}): Promise<PublishSimulatorDaysResult> {
  const { db, bucket, teamId, importId, run } = params;
  const result: PublishSimulatorDaysResult = { published: [], skippedOlder: [], removedExpired: [] };
  if (!run.rawStoragePath?.startsWith(`teams/${teamId}/performanceImports/raw/`)) {
    throw new Error(`Import ${importId} has no valid raw STREETS archive.`);
  }

  const [content] = await bucket.file(run.rawStoragePath).download();
  const csvText = content.toString('utf-8');
  const { records } = parseSTREETSCSV(csvText);
  if (!records.length) throw new Error(`Import ${importId} has no valid STREETS records.`);

  const sourceRevision = sourceRevisionOf(run, importId);
  const sha256 = createHash('sha256').update(csvText).digest('hex');
  const sourceName = run.rawStoragePath.split('/').pop() ?? run.rawStoragePath;
  const capacity = await loadCapacity(db, teamId);
  const snapshots = await loadGtfsSnapshots(db);
  const gtfsCache = new Map<string, SimulatorGtfsIndex>();
  const zipCache = new Map<string, Uint8Array>();
  const metadataRef = db.doc(SIMULATOR_FEED_METADATA_PATH(teamId));

  const allDates = [...new Set(records.map(r => r.date))].sort();
  const dates = params.dates ? allDates.filter(d => params.dates!.includes(d)) : allDates;

  for (const date of dates) {
    const existing = (await metadataRef.get()).data()?.days?.[date] as SimulatorDayPointer | undefined;
    if (!shouldReplaceSimulatorDay(existing, sourceRevision)) {
      result.skippedOlder.push(date);
      continue;
    }

    const chosen = selectGtfsSnapshot(snapshots, date);
    let gtfs: SimulatorGtfsIndex | null = null;
    if (chosen) {
      const cacheKey = `${chosen.snapshot.snapshotId}|${date}`;
      gtfs = gtfsCache.get(cacheKey) ?? null;
      if (!gtfs) {
        let zip = zipCache.get(chosen.snapshot.snapshotId);
        if (!zip) {
          const [buf] = await bucket.file(chosen.snapshot.zipPath).download();
          zip = new Uint8Array(buf);
          zipCache.set(chosen.snapshot.snapshotId, zip);
        }
        gtfs = indexGtfsZip(zip, date);
        gtfsCache.set(cacheKey, gtfs);
      }
    }

    const day = buildSimulatorDay(records, {
      serviceDate: date,
      gtfs,
      gtfsOrigin: chosen ? `gtfs-archive:${chosen.snapshot.snapshotId}` : 'none',
      gtfsCovers: chosen?.covers ?? false,
      loadCapacity: capacity,
      source: { name: sourceName, sha256 },
    });
    if (!day.trips.length) continue;
    if (params.dryRun) {
      console.log(`[simulator-feed] dry run ${date}: ${day.quality.trips} trips, ${day.quality.tripsMatched} matched to GTFS ${day.gtfs.version}`);
      result.published.push(date);
      continue;
    }

    const storagePath = simulatorDayStoragePath(teamId, date, `${sourceRevision}-${randomUUID().slice(0, 8)}`);
    await bucket.file(storagePath).save(JSON.stringify(day), {
      contentType: 'application/json',
      resumable: false,
      metadata: { cacheControl: 'private, max-age=31536000, immutable' },
    });

    const pointer: SimulatorDayPointer = {
      date,
      dayType: day.dayType,
      gtfsVersion: day.gtfs.version,
      trips: day.quality.trips,
      tripsMatched: day.quality.tripsMatched,
      storagePath,
      sourceRevision,
      importId,
      generatedAt: day.generatedAt,
    };
    const outcome = await db.runTransaction(async tx => {
      const snap = await tx.get(metadataRef);
      const days = { ...((snap.data()?.days ?? {}) as Record<string, SimulatorDayPointer>) };
      if (!shouldReplaceSimulatorDay(days[date], sourceRevision)) return { replaced: false, obsolete: [storagePath], expired: [] as string[] };
      const obsolete = days[date] ? [days[date].storagePath] : [];
      days[date] = pointer;
      const expired = expiredSimulatorDays(Object.keys(days));
      for (const d of expired) {
        obsolete.push(days[d].storagePath);
        delete days[d];
      }
      tx.set(metadataRef, {
        schema: 1,
        days,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastImportId: importId,
      });
      return { replaced: true, obsolete, expired };
    });

    // Old generations are removed only after the pointer moved.
    await Promise.all(outcome.obsolete.map(p => bucket.file(p).delete({ ignoreNotFound: true })));
    if (outcome.replaced) {
      result.published.push(date);
      result.removedExpired.push(...outcome.expired);
    } else {
      result.skippedOlder.push(date);
    }
  }
  return result;
}
