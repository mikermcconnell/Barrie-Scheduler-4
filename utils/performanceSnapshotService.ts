/**
 * Performance Snapshot Service
 *
 * Firestore CRUD for monthly performance snapshots.
 * Path: teams/{teamId}/performanceSnapshots/{YYYY-MM}
 *
 * Snapshots are compact (~2-5 KB) monthly rollups that accumulate
 * over time, preserving historical data across imports.
 */

import {
  doc,
  setDoc,
  collection,
  query,
  orderBy,
  getDocs,
} from 'firebase/firestore';
import { db } from './firebase';
import type { MonthlySnapshot } from './performanceSnapshotTypes';

function getSnapshotsCollection(teamId: string) {
  return collection(db, 'teams', teamId, 'performanceSnapshots');
}

/** Save monthly snapshots to Firestore (upsert per month). */
export async function saveMonthlySnapshots(
  teamId: string,
  snapshots: MonthlySnapshot[]
): Promise<void> {
  for (const snapshot of snapshots) {
    const docRef = doc(getSnapshotsCollection(teamId), snapshot.month);
    await setDoc(docRef, snapshot);
  }
}

/** Retrieve all performance snapshots for a team, ordered by month ascending. */
export async function getPerformanceSnapshots(
  teamId: string
): Promise<MonthlySnapshot[]> {
  const q = query(getSnapshotsCollection(teamId), orderBy('month', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as MonthlySnapshot);
}
