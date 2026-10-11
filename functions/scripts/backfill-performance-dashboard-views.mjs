#!/usr/bin/env node

/**
 * Build compact dashboard monthly views from the active full performance
 * months. Dry-run is the default; pass --apply to upload and publish pointers.
 *
 * Usage (from functions/):
 *   gcloud auth application-default login
 *   npm run backfill:dashboard-views -- --team TEAM_ID
 *   npm run backfill:dashboard-views -- --team TEAM_ID --apply
 */

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  buildPerformanceDashboardView,
  PERFORMANCE_DASHBOARD_VIEW_MODES,
} from '../lib/functions/src/performanceDashboardView.js';

const IMMUTABLE_CACHE_CONTROL = 'private, max-age=31536000, immutable';

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stableRecord(value) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right))),
  );
}

const teamId = readArg('--team');
const apply = process.argv.includes('--apply');
const projectId = readArg('--project')
  || process.env.GOOGLE_CLOUD_PROJECT
  || process.env.GCLOUD_PROJECT
  || 'barrie-scheduler-7844a';
const storageBucket = `${projectId}.firebasestorage.app`;

if (!teamId || !/^[A-Za-z0-9_-]{6,128}$/.test(teamId)) {
  throw new Error('Provide a valid team ID with --team TEAM_ID.');
}

if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault(), projectId, storageBucket });
}

const db = getFirestore();
const bucket = getStorage().bucket(storageBucket);
const metadataRef = db.doc(`teams/${teamId}/performanceData/metadata`);
const metadataSnap = await metadataRef.get();

if (!metadataSnap.exists) {
  throw new Error(`Performance metadata was not found for team ${teamId}.`);
}

const metadata = metadataSnap.data() ?? {};
const monthlyStoragePaths = metadata.monthlyStoragePaths;
if (!monthlyStoragePaths || typeof monthlyStoragePaths !== 'object') {
  throw new Error('This team does not have active monthly performance files to backfill.');
}
if (metadata.dashboardMonthlyStoragePaths
    && Object.keys(metadata.dashboardMonthlyStoragePaths).length > 0) {
  throw new Error('Dashboard views already exist. Refusing to replace the active generation.');
}

const sourcePaths = Object.fromEntries(
  Object.entries(monthlyStoragePaths)
    .filter(([month, path]) => /^\d{4}-\d{2}$/.test(month) && typeof path === 'string' && path.length > 0)
    .sort(([left], [right]) => left.localeCompare(right)),
);
if (Object.keys(sourcePaths).length === 0) {
  throw new Error('No valid monthly performance paths were found.');
}

const generation = Date.now().toString();
const publishedPaths = Object.fromEntries(
  PERFORMANCE_DASHBOARD_VIEW_MODES.map(mode => [mode, {}]),
);
const viewBytes = Object.fromEntries(
  PERFORMANCE_DASHBOARD_VIEW_MODES.map(mode => [mode, 0]),
);
let totalSourceBytes = 0;

for (const [month, sourcePath] of Object.entries(sourcePaths)) {
  const expectedSourcePrefix = `teams/${teamId}/performanceData/`;
  if (!sourcePath.startsWith(expectedSourcePrefix)) {
    throw new Error(`Refusing source path outside ${expectedSourcePrefix}.`);
  }

  const [sourceBuffer] = await bucket.file(sourcePath).download();
  totalSourceBytes += sourceBuffer.byteLength;
  const summary = JSON.parse(sourceBuffer.toString('utf8'));

  for (const mode of PERFORMANCE_DASHBOARD_VIEW_MODES) {
    const viewBuffer = Buffer.from(JSON.stringify(buildPerformanceDashboardView(summary, mode)));
    viewBytes[mode] += viewBuffer.byteLength;
    const targetPath = `teams/${teamId}/performanceData/views/${generation}-${mode}-${month}.json`;
    publishedPaths[mode][month] = targetPath;

    if (apply) {
      await bucket.file(targetPath).save(viewBuffer, {
        contentType: 'application/json',
        resumable: false,
        metadata: {
          cacheControl: IMMUTABLE_CACHE_CONTROL,
          metadata: { sourcePath, detailMode: mode },
        },
      });
    }
  }

  process.stdout.write(`${apply ? 'uploaded' : 'checked'} ${month}: ${sourceBuffer.byteLength} source bytes\n`);
}

if (apply) {
  try {
    await db.runTransaction(async transaction => {
      const currentSnap = await transaction.get(metadataRef);
      const current = currentSnap.data() ?? {};
      if (stableRecord(current.monthlyStoragePaths) !== stableRecord(monthlyStoragePaths)) {
        throw new Error('Performance data changed during the backfill; the new pointers were not published.');
      }
      if (current.dashboardMonthlyStoragePaths
          && Object.keys(current.dashboardMonthlyStoragePaths).length > 0) {
        throw new Error('Another dashboard-view generation was published during the backfill.');
      }
      transaction.update(metadataRef, {
        dashboardMonthlyStoragePaths: publishedPaths,
        dashboardViewsBackfilledAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    const uploadedPaths = Object.values(publishedPaths).flatMap(months => Object.values(months));
    await Promise.all(uploadedPaths.map(path => bucket.file(path).delete({ ignoreNotFound: true })));
    throw error;
  }
}

const totalViewBytes = Object.values(viewBytes).reduce((sum, bytes) => sum + bytes, 0);
process.stdout.write(JSON.stringify({
  mode: apply ? 'applied' : 'dry-run',
  teamId,
  months: Object.keys(sourcePaths).length,
  totalSourceBytes,
  viewBytes,
  totalViewBytes,
  combinedReductionPercent: Math.round((1 - totalViewBytes / (totalSourceBytes * PERFORMANCE_DASHBOARD_VIEW_MODES.length)) * 1000) / 10,
}, null, 2) + '\n');
