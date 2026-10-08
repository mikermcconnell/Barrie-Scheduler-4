#!/usr/bin/env node
/**
 * Builds simulator day files (docs/SIMULATOR_FEED.md) for service dates that already have completed
 * STREETS imports. Dry run by default; pass --apply to publish.
 *
 *   npm run build
 *   node scripts/backfill-simulator-days.mjs --team TEAM_ID [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--apply]
 *
 * Each date is rebuilt from the newest completed import covering it. Publication uses the same
 * revision guard as the live trigger, so it never replaces a newer day.
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { publishSimulatorDaysForImport } from '../lib/functions/src/simulatorDayPublish.js';

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
const end = readArg('--end') ?? new Date().toISOString().slice(0, 10);
const startDefault = new Date(`${end}T00:00:00Z`);
startDefault.setUTCDate(startDefault.getUTCDate() - 30);
const start = readArg('--start') ?? startDefault.toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
  throw new Error('--start and --end must be YYYY-MM-DD with start <= end.');
}

if (getApps().length === 0) {
  initializeApp({ credential: applicationDefault(), projectId, storageBucket });
}
const db = getFirestore();
const bucket = getStorage().bucket(storageBucket);

const snapshot = await db.collection(`teams/${teamId}/performanceImports`).where('status', '==', 'completed').get();
/** date → newest completed import covering it */
const newestByDate = new Map();
for (const doc of snapshot.docs) {
  const run = doc.data();
  if (!run.rawStoragePath || !Array.isArray(run.serviceDates)) continue;
  const revision = String(run.sourceRevision ?? '');
  for (const date of run.serviceDates) {
    if (date < start || date > end) continue;
    const current = newestByDate.get(date);
    if (!current || String(current.run.sourceRevision ?? '') < revision) newestByDate.set(date, { id: doc.id, run });
  }
}

/** importId → dates to build from it */
const plan = new Map();
for (const [date, { id, run }] of [...newestByDate].sort()) {
  const entry = plan.get(id) ?? { run, dates: [] };
  entry.dates.push(date);
  plan.set(id, entry);
}

console.log(`${apply ? 'Publishing' : 'Dry run for'} ${newestByDate.size} service dates (${start} to ${end}) from ${plan.size} imports.`);
for (const [importId, { run, dates }] of plan) {
  try {
    const result = await publishSimulatorDaysForImport({ db, bucket, teamId, importId, run, dates, dryRun: !apply });
    console.log(`  ${importId}: ${apply ? 'published' : 'would publish'} ${result.published.join(', ') || 'none'}`
      + `${result.skippedOlder.length ? `; newer data kept for ${result.skippedOlder.join(', ')}` : ''}`);
  } catch (error) {
    console.error(`  ${importId}: failed — ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
