#!/usr/bin/env node
/**
 * One-off backfill: sanitize historical load metrics in stored performance summaries.
 *
 * Usage:
 *   node functions/scripts/backfill-load-sanitization.mjs --teamId <TEAM_ID> --dry-run
 *   node functions/scripts/backfill-load-sanitization.mjs --teamId <TEAM_ID> --apply
 *   node functions/scripts/backfill-load-sanitization.mjs --teamId <TEAM_ID> --apply --delete-old
 *
 * Notes:
 * - Requires Firebase Admin credentials (for example: GOOGLE_APPLICATION_CREDENTIALS).
 * - Rewrites Storage JSON and updates teams/{teamId}/performanceData/metadata.
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';
const DEFAULT_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'barrie-scheduler-7844a.firebasestorage.app';
const DEFAULT_LOAD_CAP = 65;

function printUsage() {
  console.log(`
Backfill load sanitization in stored performance summaries.

Options:
  --teamId <id>     Team ID (default: ${DEFAULT_TEAM_ID})
  --bucket <name>   Firebase Storage bucket (default: ${DEFAULT_BUCKET})
  --cap <number>    Load cap (default: ${DEFAULT_LOAD_CAP})
  --dry-run         Preview only (default)
  --apply           Write updated JSON + metadata
  --delete-old      Delete prior storage JSON after successful write (with --apply)
  --help            Show this help
`);
}

function parseArgs(argv) {
  const out = {
    teamId: DEFAULT_TEAM_ID,
    bucket: DEFAULT_BUCKET,
    cap: DEFAULT_LOAD_CAP,
    apply: false,
    deleteOld: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      out.help = true;
    } else if (a === '--teamId' && argv[i + 1]) {
      out.teamId = argv[++i];
    } else if (a === '--bucket' && argv[i + 1]) {
      out.bucket = argv[++i];
    } else if (a === '--cap' && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --cap value: ${argv[i]}`);
      }
      out.cap = n;
    } else if (a === '--apply') {
      out.apply = true;
    } else if (a === '--dry-run') {
      out.apply = false;
    } else if (a === '--delete-old') {
      out.deleteOld = true;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }

  return out;
}

function getTotalRecords(summary) {
  if (typeof summary?.metadata?.totalRecords === 'number') return summary.metadata.totalRecords;
  return (summary?.dailySummaries || []).reduce((acc, d) => acc + (d?.dataQuality?.totalRecords || 0), 0);
}

function sanitizeNumericField(obj, key, cap, stats) {
  if (!obj || typeof obj[key] !== 'number' || !Number.isFinite(obj[key])) return;

  const original = obj[key];
  let next = original;

  if (original > cap) {
    next = cap;
    stats.overCapClamps++;
  }
  if (next < 0) {
    next = 0;
    stats.negativeClamps++;
  }

  if (next !== original) {
    obj[key] = next;
    stats.fieldsChanged++;
    stats.dayChanged = true;
  }
}

function sanitizeDay(day, cap) {
  const stats = {
    dayChanged: false,
    fieldsChanged: 0,
    overCapClamps: 0,
    negativeClamps: 0,
  };

  sanitizeNumericField(day.system, 'peakLoad', cap, stats);
  sanitizeNumericField(day.system, 'avgSystemLoad', cap, stats);

  if (Array.isArray(day.byRoute)) {
    for (const r of day.byRoute) {
      sanitizeNumericField(r, 'maxLoad', cap, stats);
      sanitizeNumericField(r, 'avgLoad', cap, stats);
    }
  }

  if (Array.isArray(day.byHour)) {
    for (const h of day.byHour) {
      sanitizeNumericField(h, 'avgLoad', cap, stats);
    }
  }

  if (Array.isArray(day.byStop)) {
    for (const s of day.byStop) {
      sanitizeNumericField(s, 'avgLoad', cap, stats);
    }
  }

  if (Array.isArray(day.byTrip)) {
    for (const t of day.byTrip) {
      sanitizeNumericField(t, 'maxLoad', cap, stats);
    }
  }

  if (Array.isArray(day.loadProfiles)) {
    for (const lp of day.loadProfiles) {
      if (!Array.isArray(lp?.stops)) continue;
      for (const stop of lp.stops) {
        sanitizeNumericField(stop, 'maxLoad', cap, stats);
        sanitizeNumericField(stop, 'avgLoad', cap, stats);
      }
    }
  }

  return stats;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  initializeApp({ storageBucket: args.bucket });
  const db = getFirestore();
  const bucket = getStorage().bucket(args.bucket);

  const metadataRef = db.doc(`teams/${args.teamId}/performanceData/metadata`);
  const metadataSnap = await metadataRef.get();
  if (!metadataSnap.exists) {
    throw new Error(`No metadata found for team ${args.teamId}`);
  }

  const metadata = metadataSnap.data();
  const oldStoragePath = metadata?.storagePath;
  if (!oldStoragePath) {
    throw new Error(`Metadata for team ${args.teamId} has no storagePath`);
  }

  const [buf] = await bucket.file(oldStoragePath).download();
  const summary = JSON.parse(buf.toString('utf8'));
  if (!Array.isArray(summary?.dailySummaries)) {
    throw new Error('Stored summary has no dailySummaries array');
  }

  let daysChanged = 0;
  let fieldsChanged = 0;
  let overCapClamps = 0;
  let negativeClamps = 0;

  for (const day of summary.dailySummaries) {
    const dayStats = sanitizeDay(day, args.cap);
    if (dayStats.dayChanged) daysChanged++;
    fieldsChanged += dayStats.fieldsChanged;
    overCapClamps += dayStats.overCapClamps;
    negativeClamps += dayStats.negativeClamps;
  }

  console.log(`Team: ${args.teamId}`);
  console.log(`Storage path: ${oldStoragePath}`);
  console.log(`Load cap: ${args.cap}`);
  console.log(`Days scanned: ${summary.dailySummaries.length}`);
  console.log(`Days changed: ${daysChanged}`);
  console.log(`Fields changed: ${fieldsChanged}`);
  console.log(`Over-cap clamps: ${overCapClamps}`);
  console.log(`Negative clamps: ${negativeClamps}`);

  if (!args.apply) {
    console.log('Dry run complete. No data written. Re-run with --apply to persist.');
    return;
  }

  const timestamp = Date.now().toString();
  const newStoragePath = `teams/${args.teamId}/performanceData/${timestamp}-load-sanitize-backfill.json`;
  await bucket.file(newStoragePath).save(JSON.stringify(summary), {
    contentType: 'application/json',
  });

  const dates = summary.dailySummaries
    .map(d => d.date)
    .filter(Boolean)
    .sort();
  const dateRange = dates.length > 0
    ? { start: dates[0], end: dates[dates.length - 1] }
    : (summary.metadata?.dateRange || { start: '', end: '' });

  await metadataRef.set({
    importedAt: FieldValue.serverTimestamp(),
    importedBy: 'load-sanitize-backfill',
    storagePath: newStoragePath,
    dateRange,
    dayCount: summary.dailySummaries.length,
    totalRecords: getTotalRecords(summary),
  }, { merge: true });

  if (args.deleteOld && oldStoragePath !== newStoragePath) {
    try {
      await bucket.file(oldStoragePath).delete();
      console.log(`Deleted old storage object: ${oldStoragePath}`);
    } catch (err) {
      console.warn(`Could not delete old storage object ${oldStoragePath}:`, err?.message || err);
    }
  }

  console.log(`Backfill applied. New storage path: ${newStoragePath}`);
}

main().catch((err) => {
  console.error('Backfill failed:', err?.message || err);
  process.exitCode = 1;
});
