#!/usr/bin/env node
import admin from 'firebase-admin';
import {
  createRidershipTrendProjection,
  mergeRidershipTrendProjection,
} from '../lib/utils/ridership-trends/model.js';
import { RIDERSHIP_TREND_BASELINE_HASH } from '../lib/utils/ridership-trends/types.js';

function readArgs(argv) {
  const args = { teamId: '', apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--team') args.teamId = argv[index + 1] || '';
    if (argv[index] === '--apply') args.apply = true;
  }
  if (!args.teamId || !/^[A-Za-z0-9_-]{1,128}$/.test(args.teamId)) {
    throw new Error('An explicit valid --team TEAM_ID is required.');
  }
  return args;
}

async function readPerformanceDays(bucket, metadata) {
  const monthlyPaths = metadata.monthlyStoragePaths;
  if (monthlyPaths && typeof monthlyPaths === 'object' && !Array.isArray(monthlyPaths)) {
    const days = [];
    for (const month of Object.keys(monthlyPaths).sort()) {
      const path = monthlyPaths[month];
      if (typeof path !== 'string' || !path) throw new Error(`Invalid performance path for ${month}.`);
      const [content] = await bucket.file(path).download();
      const summary = JSON.parse(content.toString('utf8'));
      if (!Array.isArray(summary.dailySummaries)) throw new Error(`Invalid performance summary for ${month}.`);
      days.push(...summary.dailySummaries.map(day => ({
        date: day.date,
        boardings: day?.system?.totalRidership,
        performanceSchemaVersion: summary.schemaVersion,
      })));
    }
    return days;
  }
  if (typeof metadata.storagePath === 'string' && metadata.storagePath) {
    const [content] = await bucket.file(metadata.storagePath).download();
    const summary = JSON.parse(content.toString('utf8'));
    if (!Array.isArray(summary.dailySummaries)) throw new Error('Invalid monolithic performance summary.');
    return summary.dailySummaries.map(day => ({
      date: day.date,
      boardings: day?.system?.totalRidership,
      performanceSchemaVersion: summary.schemaVersion,
    }));
  }
  return [];
}

async function main() {
  const { teamId, apply } = readArgs(process.argv.slice(2));
  admin.initializeApp();
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const metadataRef = db.doc(`teams/${teamId}/performanceData/metadata`);
  const initialSnap = await metadataRef.get();
  if (!initialSnap.exists) throw new Error(`Performance metadata was not found for team ${teamId}.`);
  const metadata = initialSnap.data() || {};
  if (metadata.ridershipTrendStoragePath) {
    throw new Error('Ridership Trends already has an active projection; bootstrap refused.');
  }

  const dailyInputs = await readPerformanceDays(bucket, metadata);
  const now = new Date().toISOString();
  const projection = mergeRidershipTrendProjection(
    createRidershipTrendProjection({ baselineHash: RIDERSHIP_TREND_BASELINE_HASH, updatedAt: now }),
    dailyInputs,
    now,
  );
  const generation = Date.now().toString();
  const storagePath = `teams/${teamId}/performanceViews/ridership-trends/${generation}.json`;
  const totalBoardings = Object.values(projection.dailyTotals)
    .reduce((sum, day) => sum + day.boardings, 0);

  console.log(JSON.stringify({
    dryRun: !apply,
    teamId,
    retainedPerformanceDaysRead: dailyInputs.length,
    projectedDays: Object.keys(projection.dailyTotals).length,
    latestServiceDate: projection.latestServiceDate,
    totalBoardings,
    storagePath,
  }, null, 2));
  if (!apply) return;

  await bucket.file(storagePath).save(JSON.stringify(projection), { contentType: 'application/json' });
  try {
    await db.runTransaction(async transaction => {
      const currentSnap = await transaction.get(metadataRef);
      if (!currentSnap.exists || !currentSnap.updateTime.isEqual(initialSnap.updateTime)) {
        throw new Error('Performance metadata changed after the bootstrap preview; no pointer was updated.');
      }
      if (currentSnap.data()?.ridershipTrendStoragePath) {
        throw new Error('Ridership Trends was initialized concurrently; bootstrap refused.');
      }
      transaction.update(metadataRef, { ridershipTrendStoragePath: storagePath });
    });
  } catch (error) {
    await bucket.file(storagePath).delete().catch(() => undefined);
    throw error;
  }
  console.log(`Applied Ridership Trends projection for ${teamId}.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
