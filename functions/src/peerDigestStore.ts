/**
 * Firestore paths and reads for Peer Agency Watch.
 *   teams/{team}/peerDigests/{weekOf}          one digest per Monday (weekOf = YYYY-MM-DD)
 *   teams/{team}/peerDigests/{weekOf}_partial  tuning runs on a few agencies; never emailed to management
 *   teams/{team}/peerDigestConfig/settings     { mode: 'draft' | 'live', editorNotes, barrieContext }
 */
import * as admin from 'firebase-admin';
import { mondayOnOrBefore, parsePeerDigestSettings, PeerDigestDoc, PeerDigestSettings } from './peerDigest';

type Db = admin.firestore.Firestore;

export function peerDigestRef(db: Db, teamId: string, id: string): admin.firestore.DocumentReference {
  return db.doc(`teams/${teamId}/peerDigests/${id}`);
}

export function peerDigestSettingsRef(db: Db, teamId: string): admin.firestore.DocumentReference {
  return db.doc(`teams/${teamId}/peerDigestConfig/settings`);
}

export async function loadPeerDigestSettings(db: Db, teamId: string): Promise<PeerDigestSettings> {
  const snap = await peerDigestSettingsRef(db, teamId).get();
  return parsePeerDigestSettings(snap.exists ? snap.data() : undefined);
}

export async function loadPeerDigest(db: Db, teamId: string, id: string): Promise<PeerDigestDoc | null> {
  const snap = await peerDigestRef(db, teamId, id).get();
  return snap.exists ? snap.data() as PeerDigestDoc : null;
}

/** The newest full (not partial) digest, any status. */
export async function loadLatestPeerDigest(db: Db, teamId: string): Promise<PeerDigestDoc | null> {
  const snap = await db.collection(`teams/${teamId}/peerDigests`).orderBy('weekOf', 'desc').limit(6).get();
  const full = snap.docs.find(doc => !doc.id.endsWith('_partial'));
  return full ? full.data() as PeerDigestDoc : null;
}

/** Item titles from the digests before this week, so the editor doesn't repeat a story. */
export async function loadRecentPeerTitles(db: Db, teamId: string, beforeWeekOf: string, weeks = 4): Promise<string[]> {
  const snap = await db.collection(`teams/${teamId}/peerDigests`)
    .where('weekOf', '<', beforeWeekOf)
    .orderBy('weekOf', 'desc')
    .limit(weeks * 2)
    .get();
  return snap.docs
    .filter(doc => !doc.id.endsWith('_partial'))
    .slice(0, weeks)
    .flatMap(doc => ((doc.data() as PeerDigestDoc).content?.items ?? []).map(item => `${item.agency}: ${item.title}`));
}

/**
 * The digest the daily report should carry today, or null. Only in live mode, only this week's
 * digest, only once: the first report sent on or after its Monday (so a Monday with no data
 * passes it to Tuesday). Never throws; a problem here must not stop the ops email.
 */
export async function loadPeerDigestForReport(params: {
  db: Db;
  teamId: string;
  today: string;
}): Promise<{ doc: PeerDigestDoc; ref: admin.firestore.DocumentReference } | null> {
  try {
    const settings = await loadPeerDigestSettings(params.db, params.teamId);
    if (settings.mode !== 'live') return null;
    const ref = peerDigestRef(params.db, params.teamId, mondayOnOrBefore(params.today));
    const snap = await ref.get();
    if (!snap.exists) return null;
    const doc = snap.data() as PeerDigestDoc;
    if (doc.status !== 'ready' || doc.includedInReportAt) return null;
    return { doc, ref };
  } catch (error) {
    console.warn('Peer digest unavailable for the daily report:', error);
    return null;
  }
}
