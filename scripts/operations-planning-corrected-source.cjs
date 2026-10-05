// Read-only cloud retrieval. Writes a new local source snapshot, never Master.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function main() {
  const root = path.resolve(__dirname, '..');
  const input = JSON.parse(fs.readFileSync(path.join(root, 'output/operations-planning/operations-planning-input-v1.json'), 'utf8'));
  const output = path.join(root, 'outputs/corrected-run-cut-20260921/master-source-snapshot.json');
  if (fs.existsSync(output)) throw new Error('Snapshot already exists; use the pinned local copy.');
  const auth = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const api = fs.readFileSync('D:/DeveloperCaches/npm/_npx/7750544ccf494d8b/node_modules/firebase-tools/lib/api.js', 'utf8');
  const refresh = await fetch('https://www.googleapis.com/oauth2/v3/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: auth.tokens.refresh_token,
      client_id: api.match(/FIREBASE_CLIENT_ID", "([^"]+)"/)[1],
      client_secret: api.match(/FIREBASE_CLIENT_SECRET", "([^"]+)"/)[1], grant_type: 'refresh_token' }),
  });
  if (!refresh.ok) throw new Error(`Authentication failed: ${refresh.status}`);
  const token = (await refresh.json()).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  const schedules = [];
  for (const source of input.sourceManifest.items) {
    const metadata = await fetch(`https://firestore.googleapis.com/v1/projects/barrie-scheduler-7844a/databases/(default)/documents/teams/${source.sourceTeamId}/masterSchedules/${source.routeIdentity}`, { headers });
    if (!metadata.ok) throw new Error(`Master metadata ${source.routeIdentity}: ${metadata.status}`);
    const fields = (await metadata.json()).fields;
    if (Number(fields.currentVersion.integerValue) !== source.version || fields.storagePath.stringValue !== source.storagePath) throw new Error(`Source changed: ${source.routeIdentity}`);
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/barrie-scheduler-7844a.firebasestorage.app/o/${encodeURIComponent(source.storagePath)}?alt=media`, { headers });
    if (!response.ok) throw new Error(`Master content ${source.routeIdentity}: ${response.status}`);
    const raw = await response.text();
    schedules.push({ sourceTeamId: source.sourceTeamId, pinnedAt: source.pinnedAt,
      entry: { id: source.routeIdentity, routeNumber: source.routeNumber, dayType: source.dayType,
        currentVersion: source.version, storagePath: source.storagePath, tripCount: Number(fields.tripCount.integerValue) },
      content: JSON.parse(raw), sha256: crypto.createHash('sha256').update(raw).digest('hex') });
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ retrievedAt: new Date().toISOString(), sourceManifest: input.sourceManifest, schedules }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ schedules: schedules.length, trips: schedules.reduce((n,s)=>n+s.content.northTable.trips.length+s.content.southTable.trips.length,0), output }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
