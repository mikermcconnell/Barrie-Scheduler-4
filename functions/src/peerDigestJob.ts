/**
 * Peer Agency Watch jobs.
 *
 * buildPeerDigest (Sundays 18:00 Toronto): researches last week's peer news and saves the digest.
 *   Draft mode (the default): emails the digest to PEER_DIGEST_DRAFT_TO only.
 *   Live mode: the Monday daily report carries it (dailyReport.ts); no separate email.
 * testPeerDigest (HTTP, REPORT_TEST_API_KEY): run, preview, resend and switch mode while tuning.
 *
 * Secrets: ANTHROPIC_API_KEY, PEER_DIGEST_DRAFT_TO (comma-separated emails), REPORT_TEST_API_KEY.
 */
import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { digestCoverage, digestWeekOf, emptyUsage, PeerDigestDoc, PeerDigestMode } from './peerDigest';
import { buildPeerDigestDraftHtml } from './peerDigestHtml';
import { PEER_DIGEST_MODEL, researchPeerDigest } from './peerDigestResearch';
import {
  loadLatestPeerDigest,
  loadPeerDigest,
  loadPeerDigestSettings,
  loadRecentPeerTitles,
  peerDigestRef,
  peerDigestSettingsRef,
} from './peerDigestStore';
import { hasValidApiKey } from './requestAuth';

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const PEER_DIGEST_DRAFT_TO = defineSecret('PEER_DIGEST_DRAFT_TO');
const REPORT_TEST_API_KEY = defineSecret('REPORT_TEST_API_KEY');
/** Same team as the daily report (dailyReport.ts). */
const TEAM_ID = 'PHICwXGlvDen0RGt7fCG';
const TIME_ZONE = 'America/Toronto';

function todayInToronto(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function parseEmails(csv: string | undefined): string[] {
  return (csv ?? '').split(',').map(email => email.trim()).filter(email => email.includes('@'));
}

async function queueDraft(db: admin.firestore.Firestore, to: string[], doc: PeerDigestDoc): Promise<void> {
  const label = doc.status === 'ready' ? `${doc.content?.items.length ?? 0} items` : 'build failed';
  await db.collection('mail').add({
    to,
    message: {
      subject: `[DRAFT] Peer Agency Watch · week of ${doc.weekOf} · ${label}`,
      html: buildPeerDigestDraftHtml(doc),
    },
  });
}

/** Researches, edits and saves one digest. Saves a failed digest instead of throwing. */
export async function buildAndStorePeerDigest(params: {
  db: admin.firestore.Firestore;
  apiKey: string;
  today: string;
  weekOf?: string;
  agencyIds?: string[];
}): Promise<PeerDigestDoc> {
  const startedAt = Date.now();
  const weekOf = params.weekOf ?? digestWeekOf(params.today);
  const coverage = digestCoverage(weekOf);
  const partial = !!params.agencyIds?.length;
  const settings = await loadPeerDigestSettings(params.db, TEAM_ID);

  let doc: PeerDigestDoc;
  try {
    const result = await researchPeerDigest({
      apiKey: params.apiKey,
      coverage,
      barrieContext: settings.barrieContext,
      editorNotes: settings.editorNotes,
      recentTitles: await loadRecentPeerTitles(params.db, TEAM_ID, weekOf),
      agencyIds: params.agencyIds,
      log: message => console.log(message),
    });
    doc = {
      weekOf,
      coverageStart: coverage.start,
      coverageEnd: coverage.end,
      status: 'ready',
      content: result.content,
      agencies: result.agencies,
      droppedItems: result.droppedItems,
      usage: result.usage,
      model: PEER_DIGEST_MODEL,
      builtAt: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      includedInReportAt: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Peer digest build failed:', error);
    doc = {
      weekOf,
      coverageStart: coverage.start,
      coverageEnd: coverage.end,
      status: 'failed',
      error: message.slice(0, 500),
      content: null,
      agencies: [],
      droppedItems: 0,
      usage: emptyUsage(),
      model: PEER_DIGEST_MODEL,
      builtAt: new Date().toISOString(),
      durationSeconds: Math.round((Date.now() - startedAt) / 1000),
      includedInReportAt: null,
    };
  }

  await peerDigestRef(params.db, TEAM_ID, partial ? `${weekOf}_partial` : weekOf).set(doc);
  return doc;
}

export const buildPeerDigest = onSchedule(
  {
    schedule: 'every sunday 18:00',
    timeZone: TIME_ZONE,
    secrets: [ANTHROPIC_API_KEY, PEER_DIGEST_DRAFT_TO],
    memory: '512MiB',
    timeoutSeconds: 1800,
    // Failures are saved, not thrown, so a retry would only repeat the cost.
    retryCount: 0,
    region: 'us-central1',
  },
  async () => {
    const db = admin.firestore();
    const doc = await buildAndStorePeerDigest({ db, apiKey: ANTHROPIC_API_KEY.value(), today: todayInToronto() });
    const settings = await loadPeerDigestSettings(db, TEAM_ID);
    const draftTo = parseEmails(PEER_DIGEST_DRAFT_TO.value());

    // Draft mode emails every edition; live mode emails only a failure, as a heads-up.
    if (draftTo.length > 0 && (settings.mode === 'draft' || doc.status === 'failed')) {
      await queueDraft(db, draftTo, doc);
    }
    console.log(`Peer digest ${doc.weekOf}: ${doc.status}, ${doc.content?.items.length ?? 0} items, ~$${doc.usage.estimatedCostUsd}, mode ${settings.mode}`);
  },
);

/**
 * Tuning endpoint. Every call needs the REPORT_TEST_API_KEY (as for testDailyReport).
 *   ?action=run[&agencies=guelph,kingston][&week=YYYY-MM-DD][&to=email][&send=0]
 *       Build now. With agencies, a cheap partial run saved as {week}_partial (never sent to
 *       management). Emails the draft to `to`, or to PEER_DIGEST_DRAFT_TO, unless send=0.
 *   ?action=preview[&week=YYYY-MM-DD | &id={week}_partial]   Draft HTML of a saved digest.
 *   ?action=json[&week=… | &id=…]                            The saved digest document.
 *   ?action=send&to=email[&week=… | &id=…]                    Email a saved digest's draft.
 *   ?action=mode&value=draft|live                             Switch mode (live = in the Monday report).
 *   ?action=settings                                          Show the settings.
 */
export const testPeerDigest = onRequest(
  {
    memory: '512MiB',
    timeoutSeconds: 1800,
    region: 'us-central1',
    secrets: [REPORT_TEST_API_KEY, ANTHROPIC_API_KEY, PEER_DIGEST_DRAFT_TO],
  },
  async (req, res) => {
    if (!hasValidApiKey(req, REPORT_TEST_API_KEY.value())) {
      res.status(401).json({ error: 'Invalid or missing API key' });
      return;
    }
    const db = admin.firestore();
    const query = (name: string) => (typeof req.query[name] === 'string' ? req.query[name] as string : '');
    const action = query('action') || 'preview';
    const week = /^\d{4}-\d{2}-\d{2}$/.test(query('week')) ? query('week') : undefined;
    const id = /^\d{4}-\d{2}-\d{2}(_partial)?$/.test(query('id')) ? query('id') : week;
    const loadSaved = () => (id ? loadPeerDigest(db, TEAM_ID, id) : loadLatestPeerDigest(db, TEAM_ID));

    if (action === 'mode') {
      const value = query('value');
      if (value !== 'draft' && value !== 'live') {
        res.status(400).json({ error: 'Pass &value=draft or &value=live' });
        return;
      }
      await peerDigestSettingsRef(db, TEAM_ID).set({ mode: value as PeerDigestMode }, { merge: true });
      res.json({ success: true, mode: value });
      return;
    }

    if (action === 'settings') {
      res.json(await loadPeerDigestSettings(db, TEAM_ID));
      return;
    }

    if (action === 'run') {
      const agencyIds = query('agencies').split(',').map(value => value.trim()).filter(Boolean);
      const doc = await buildAndStorePeerDigest({
        db,
        apiKey: ANTHROPIC_API_KEY.value(),
        today: todayInToronto(),
        weekOf: week,
        agencyIds: agencyIds.length ? agencyIds : undefined,
      });
      const to = query('to') ? parseEmails(query('to')) : parseEmails(PEER_DIGEST_DRAFT_TO.value());
      const sent = query('send') !== '0' && to.length > 0;
      if (sent) await queueDraft(db, to, doc);
      res.json({
        success: doc.status === 'ready',
        weekOf: doc.weekOf,
        partial: agencyIds.length > 0,
        items: doc.content?.items.length ?? 0,
        droppedItems: doc.droppedItems,
        failedAgencies: doc.agencies.filter(agency => !agency.ok),
        usage: doc.usage,
        error: doc.error,
        sentTo: sent ? to : [],
      });
      return;
    }

    const doc = await loadSaved();
    if (!doc) {
      res.status(404).json({ error: 'No saved digest. Run one with ?action=run.' });
      return;
    }
    if (action === 'json') {
      res.json(doc);
      return;
    }
    if (action === 'send') {
      const to = parseEmails(query('to'));
      if (to.length === 0) {
        res.status(400).json({ error: 'Pass &to=email@example.com' });
        return;
      }
      await queueDraft(db, to, doc);
      res.json({ success: true, weekOf: doc.weekOf, sentTo: to });
      return;
    }
    res.type('html').send(buildPeerDigestDraftHtml(doc));
  },
);
