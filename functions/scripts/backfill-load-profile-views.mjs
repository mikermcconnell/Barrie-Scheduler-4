#!/usr/bin/env node

/**
 * Backfill compact Load Profiles monthly views from the active performance
 * monthly files. Dry-run is the default; pass --apply to publish the pointer.
 *
 * Usage (from functions/ after npm run build):
 *   gcloud auth application-default login
 *   node scripts/backfill-load-profile-views.mjs --team TEAM_ID
 *   node scripts/backfill-load-profile-views.mjs --team TEAM_ID --apply
 */

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { buildLoadProfileMonthlyView } from '../lib/functions/src/performanceLoadProfileView.js';

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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
if (metadata.loadProfileMonthlyStoragePaths
    && Object.keys(metadata.loadProfileMonthlyStoragePaths).length > 0) {
  throw new Error('Load Profile views already exist. Refusing to replace the active generation.');
}

const sourcePaths = Object.fromEntries(
  Object.entries(monthlyStoragePaths)
    .filter(([month, path]) => /^\d{4}-\d{2}$/.test(month) && typeof path === 'string' && path.length > 0)
    .sort(([a], [b]) => a.localeCompare(b)),
);
if (Object.keys(sourcePaths).length === 0) {
  throw new Error('No valid monthly performance paths were found.');
}

const generation = Date.now().toString();
const publishedPaths = {};
let totalSourceBytes = 0;
let totalViewBytes = 0;

for (const [month, sourcePath] of Object.entries(sourcePaths)) {
  const expectedSourcePrefix = `teams/${teamId}/performanceData/`;
  if (!sourcePath.startsWith(expectedSourcePrefix)) {
    throw new Error(`Refusing source path outside ${expectedSourcePrefix}.`);
  }
  const [sourceBuffer] = await bucket.file(sourcePath).download();
  totalSourceBytes += sourceBuffer.byteLength;
  const summary = JSON.parse(sourceBuffer.toString('utf8'));
  const view = buildLoadProfileMonthlyView(summary);
  if (view.month !== month) {
    throw new Error(`Source month ${month} produced mismatched view month ${view.month}.`);
  }

  const viewBuffer = Buffer.from(JSON.stringify(view));
  totalViewBytes += viewBuffer.byteLength;
  const targetPath = `teams/${teamId}/performanceViews/load-profiles/${generation}-${month}.json`;
  publishedPaths[month] = targetPath;

  if (apply) {
    await bucket.file(targetPath).save(viewBuffer, {
      contentType: 'application/json',
      resumable: false,
      metadata: {
        metadata: {
          sourcePath,
          viewSchemaVersion: String(view.viewSchemaVersion),
        },
      },
    });
  }

  process.stdout.write(`${apply ? 'uploaded' : 'checked'} ${month}: ${sourceBuffer.byteLength} -> ${viewBuffer.byteLength} bytes\n`);
}

if (apply) {
  try {
    await db.runTransaction(async transaction => {
      const currentSnap = await transaction.get(metadataRef);
      const current = currentSnap.data() ?? {};
      const stableRecord = value => JSON.stringify(
        Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))),
      );
      if (stableRecord(current.monthlyStoragePaths) !== stableRecord(monthlyStoragePaths)) {
        throw new Error('Performance data changed during the backfill; the new pointer was not published.');
      }
      if (current.loadProfileMonthlyStoragePaths
          && Object.keys(current.loadProfileMonthlyStoragePaths).length > 0) {
        throw new Error('Another Load Profile generation was published during the backfill.');
      }
      transaction.update(metadataRef, {
        loadProfileMonthlyStoragePaths: publishedPaths,
        loadProfileViewBackfilledAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (error) {
    await Promise.all(Object.values(publishedPaths).map(path => bucket.file(path).delete({ ignoreNotFound: true })));
    throw error;
  }
}

process.stdout.write(JSON.stringify({
  mode: apply ? 'applied' : 'dry-run',
  teamId,
  months: Object.keys(sourcePaths).length,
  totalSourceBytes,
  totalViewBytes,
  reductionPercent: Math.round((1 - totalViewBytes / totalSourceBytes) * 1000) / 10,
}, null, 2) + '\n');
