// Loads a hand-made Peer Agency Watch digest into Firestore, with no Anthropic API call.
// The Monday daily report then carries it (in live mode), and the Sunday build skips that week.
//
//   gcloud auth application-default login
//   cd functions
//   node scripts/seed-peer-digest.mjs --project barrie-scheduler-7844a --file scripts/peer-digest-samples/2026-11-23.json            # dry run
//   node scripts/seed-peer-digest.mjs --project barrie-scheduler-7844a --file scripts/peer-digest-samples/2026-11-23.json --live --apply
//
// --live also switches the settings to live mode, so management receives the section.
import { readFileSync } from 'node:fs';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';

const args = process.argv.slice(2);
const readOption = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const projectId = readOption('--project') || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
const file = readOption('--file');
const teamId = readOption('--team') || DEFAULT_TEAM_ID;
const goLive = args.includes('--live');
const apply = args.includes('--apply');

if (!projectId || !file) {
  console.error('Usage: node scripts/seed-peer-digest.mjs --project project-id --file digest.json [--team id] [--live] [--apply]');
  process.exit(1);
}

const doc = JSON.parse(readFileSync(file, 'utf8'));
const problems = [];
if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.weekOf ?? '')) problems.push('weekOf must be YYYY-MM-DD');
if (new Date(`${doc.weekOf}T12:00:00Z`).getUTCDay() !== 1) problems.push('weekOf must be a Monday');
if (doc.status !== 'ready') problems.push('status must be "ready"');
if (!Array.isArray(doc.content?.items)) problems.push('content.items must be an array');
for (const item of doc.content?.items ?? []) {
  if (!item.title || !item.summary || !Array.isArray(item.sourceUrls) || item.sourceUrls.length === 0) {
    problems.push(`item "${item.title ?? '?'}" needs a title, summary and at least one source URL`);
  }
}
if (problems.length) {
  console.error(`Not loaded:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

const record = {
  ...doc,
  source: 'manual',
  builtAt: new Date().toISOString(),
  includedInReportAt: null,
};

const path = `teams/${teamId}/peerDigests/${doc.weekOf}`;
console.log(`${apply ? 'Writing' : 'Dry run:'} ${path} in ${projectId}`);
console.log(`  ${doc.content.items.length} items, ${doc.content.upcoming?.length ?? 0} upcoming, ${doc.content.headline?.length ?? 0} headline bullets`);
for (const item of doc.content.items) console.log(`  - ${item.agency}: ${item.title}`);
if (goLive) console.log(`  and set teams/${teamId}/peerDigestConfig/settings mode = live`);

if (!apply) {
  console.log('Nothing written. Add --apply to write.');
  process.exit(0);
}

if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
await db.doc(path).set(record);
if (goLive) await db.doc(`teams/${teamId}/peerDigestConfig/settings`).set({ mode: 'live' }, { merge: true });
const settings = (await db.doc(`teams/${teamId}/peerDigestConfig/settings`).get()).data() ?? {};
console.log(`Done. Mode is ${settings.mode === 'live' ? 'live: the next daily report carries this digest' : 'draft: management will not see it until mode is live'}.`);
