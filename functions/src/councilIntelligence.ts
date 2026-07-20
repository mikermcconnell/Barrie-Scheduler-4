import * as admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

const DEFAULT_TEAM_ID = 'PHICwXGlvDen0RGt7fCG';
const SOURCE_ORIGIN = 'https://pub-barrie.escribemeetings.com';
const SOURCE_LABEL = 'City of Barrie eSCRIBE';
const PILOT_DAYS = 90;
const MAX_MEETINGS_PER_SYNC = 60;
const MAX_MEETING_TEXT_LENGTH = 80_000;
const FETCH_TIMEOUT_MS = 20_000;

const PILOT_SEED_MEETINGS = [
  { id: '339f5414-8c27-4b04-bb81-19751ad3a536', title: 'City Council', date: '2026-05-13T23:00:00.000Z' },
  { id: 'daf1b4f2-cd5e-43e4-bb30-f335349953d0', title: 'General Committee', date: '2026-06-03T23:00:00.000Z' },
  { id: '2599f54f-8c30-4c1b-84f1-31b8491d858e', title: 'City Council', date: '2026-06-10T23:00:00.000Z' },
  { id: 'b428ebfb-98b3-4996-849b-0174d5f9befc', title: 'City Council', date: '2026-06-17T23:00:00.000Z' },
] as const;

const TRANSIT_TOPICS: Record<string, string[]> = {
  'Transit service': ['transit', 'bus service', 'route ', 'service level', 'headway'],
  'Transit ON Demand': ['transit on demand', 'on-demand transit'],
  'Fares and programs': ['fare', 'transit pass', 'licence 2 ride', 'student pass', 'senior pass'],
  'Fleet and facilities': ['bus fleet', 'electric bus', 'transit terminal', 'transit hub', 'bus stop'],
  'Accessibility': ['specialized transit', 'accessible transit', 'paratransit'],
  'Funding and capital': ['transit funding', 'transit capital', 'shuttle bus'],
  'Network integration': ['active transportation', 'go transit', 'parking integration'],
};

interface DiscoveredMeeting {
  id: string;
  title: string;
  date: string;
  sourceUrl: string;
}

interface ProcessedMeeting extends DiscoveredMeeting {
  status: 'upcoming' | 'agenda' | 'minutes' | 'extraction-gap';
  body: string;
  summary: string;
  topics: string[];
  confidence: 'high' | 'medium' | 'low' | 'none';
  contentHash: string;
  retrievedAt: string;
  signals: Array<{ name: string; kind: 'mover' | 'seconder' | 'recorded-vote'; position?: string }>;
}

function decodeHtml(value: string): string {
  const entities: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  };
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => entities[name.toLowerCase()] ?? match);
}

function htmlToText(html: string): string {
  return decodeHtml(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeSourceUrl(pathOrUrl: string): string | null {
  try {
    const url = new URL(pathOrUrl, SOURCE_ORIGIN);
    if (url.protocol !== 'https:' || url.hostname !== 'pub-barrie.escribemeetings.com') return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchSource(url: string): Promise<string> {
  const safeUrl = normalizeSourceUrl(url);
  if (!safeUrl) throw new Error('Rejected council source URL.');
  const response = await fetch(safeUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'BarrieTransitCouncilIndexer/1.0' },
  });
  if (!response.ok) throw new Error(`Council source returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('text/html')) throw new Error(`Unexpected council source content type: ${contentType || 'unknown'}.`);
  const finalUrl = normalizeSourceUrl(response.url);
  if (!finalUrl) throw new Error('Council source redirected outside the allowlist.');
  const html = await response.text();
  if (html.length > 4_000_000) throw new Error('Council source response exceeded the size limit.');
  return html;
}

function parsePortalDate(value: string): string | null {
  const normalized = decodeHtml(value).replace(/\s+-\s+.*?following.*$/i, '').replace(/\s+@\s+/, ' ');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function discoverMeetingsFromListing(html: string, now = new Date()): DiscoveredMeeting[] {
  const byId = new Map<string, DiscoveredMeeting>();
  const cards = html.split(/<div class=["'](?:upcoming-)?meeting-container["']>/i).slice(1);
  for (const card of cards) {
    const idMatch = /(?:Meeting\.aspx\?[^"']*\bId=|MeetingId=)([0-9a-f-]{36})/i.exec(card);
    const titleMatch = /class=["']meeting-title-heading["'][^>]*>[\s\S]*?(?:<a[^>]*>|<span[^>]*>)([\s\S]*?)<\/(?:a|span)>/i.exec(card);
    const dateMatch = /class=["']meeting-date["'][^>]*>([\s\S]*?)<\/div>/i.exec(card);
    if (!idMatch || !titleMatch || !dateMatch) continue;
    const date = parsePortalDate(htmlToText(dateMatch[1]));
    if (!date) continue;
    const sourceUrl = normalizeSourceUrl(`/Meeting.aspx?Id=${idMatch[1]}&lang=English`);
    if (!sourceUrl) continue;
    byId.set(idMatch[1], { id: idMatch[1], title: htmlToText(titleMatch[1]), date, sourceUrl });
  }

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - PILOT_DAYS);
  for (const seed of PILOT_SEED_MEETINGS) {
    const seedDate = new Date(seed.date);
    if (seedDate < cutoff) continue;
    const sourceUrl = normalizeSourceUrl(`/Meeting.aspx?Id=${seed.id}&lang=English`);
    if (sourceUrl && !byId.has(seed.id)) byId.set(seed.id, { ...seed, sourceUrl });
  }

  return [...byId.values()]
    .filter(meeting => new Date(meeting.date) >= cutoff)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_MEETINGS_PER_SYNC);
}

function classifyTopics(text: string): string[] {
  const normalized = text.toLowerCase();
  return Object.entries(TRANSIT_TOPICS)
    .filter(([, keywords]) => keywords.some(keyword => normalized.includes(keyword)))
    .map(([topic]) => topic);
}

function cleanPersonName(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[.;:,]+$/g, '').trim().slice(0, 120);
}

function extractSignals(text: string): ProcessedMeeting['signals'] {
  const signals: ProcessedMeeting['signals'] = [];
  const seen = new Set<string>();
  const add = (name: string, kind: ProcessedMeeting['signals'][number]['kind'], position?: string) => {
    const cleaned = cleanPersonName(name);
    if (!cleaned || cleaned.length < 3) return;
    const key = `${kind}:${cleaned.toLowerCase()}:${position ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    signals.push({ name: cleaned, kind, ...(position ? { position } : {}) });
  };
  for (const match of text.matchAll(/Moved by\s+([^\n]{3,100})/gi)) add(match[1], 'mover');
  for (const match of text.matchAll(/Seconded by\s+([^\n]{3,100})/gi)) add(match[1], 'seconder');
  for (const block of text.matchAll(/Recorded Vote([\s\S]{0,2500}?)(?=\n\s*\d+(?:\.\d+)*\s|$)/gi)) {
    for (const yes of block[1].matchAll(/(?:YES|Yea|For)\s*[:\-]\s*([^\n]+)/gi)) {
      yes[1].split(/,|;/).forEach(name => add(name, 'recorded-vote', 'Supportive'));
    }
    for (const no of block[1].matchAll(/(?:NO|Nay|Against)\s*[:\-]\s*([^\n]+)/gi)) {
      no[1].split(/,|;/).forEach(name => add(name, 'recorded-vote', 'Opposed'));
    }
  }
  return signals;
}

function buildSummary(text: string, topics: string[]): string {
  if (topics.length === 0) return 'No transit-relevant text was identified in the available official record.';
  const paragraphs = text.split(/\n+/).map(value => value.trim()).filter(value => value.length >= 40);
  const relevant = paragraphs.filter(paragraph => classifyTopics(paragraph).length > 0).slice(0, 3);
  return (relevant.join(' ') || `Transit-related material was identified under ${topics.join(', ')}.`).slice(0, 1200);
}

async function processMeeting(meeting: DiscoveredMeeting, now = new Date()): Promise<ProcessedMeeting> {
  const minutesUrl = normalizeSourceUrl(`/Meeting.aspx?Agenda=PostMinutes&Id=${meeting.id}&lang=English`)!;
  const agendaUrl = normalizeSourceUrl(`/Meeting.aspx?Agenda=Agenda&Id=${meeting.id}&lang=English`)!;
  let html = '';
  let status: ProcessedMeeting['status'] = new Date(meeting.date) > now ? 'upcoming' : 'extraction-gap';
  let sourceUrl = meeting.sourceUrl;
  try {
    html = await fetchSource(minutesUrl);
    const minutesText = htmlToText(html);
    if (/Meeting Minutes|Minutes\s+City of Barrie|PostMinutes/i.test(minutesText)) {
      status = 'minutes';
      sourceUrl = minutesUrl;
    } else {
      html = await fetchSource(agendaUrl);
      status = new Date(meeting.date) > now ? 'upcoming' : 'agenda';
      sourceUrl = agendaUrl;
    }
  } catch {
    if (status !== 'upcoming') status = 'extraction-gap';
  }
  const body = html ? htmlToText(html).slice(0, MAX_MEETING_TEXT_LENGTH) : '';
  const topics = classifyTopics(body);
  return {
    ...meeting,
    sourceUrl,
    status,
    body,
    topics,
    summary: buildSummary(body, topics),
    confidence: status === 'minutes' ? 'high' : status === 'agenda' ? 'medium' : status === 'upcoming' ? 'low' : 'none',
    contentHash: createHash('sha256').update(body).digest('hex'),
    retrievedAt: now.toISOString(),
    signals: extractSignals(body),
  };
}

function slug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'unknown';
}

async function writeWorkspace(teamId: string, meetings: ProcessedMeeting[], now: Date): Promise<void> {
  const db = admin.firestore();
  const rootRef = db.doc(`teams/${teamId}/councilIntelligence/default`);
  const profileMap = new Map<string, { name: string; meetingIds: Set<string>; moverCount: number; seconderCount: number; voteCount: number; latestPosition?: string }>();
  for (const meeting of meetings) {
    for (const signal of meeting.signals) {
      const id = slug(signal.name);
      const profile = profileMap.get(id) ?? { name: signal.name, meetingIds: new Set<string>(), moverCount: 0, seconderCount: 0, voteCount: 0 };
      profile.meetingIds.add(meeting.id);
      if (signal.kind === 'mover') profile.moverCount++;
      if (signal.kind === 'seconder') profile.seconderCount++;
      if (signal.kind === 'recorded-vote') {
        profile.voteCount++;
        profile.latestPosition = signal.position;
      }
      profileMap.set(id, profile);
    }
  }

  const batch = db.batch();
  for (const meeting of meetings) {
    const storedMeeting = Object.fromEntries(
      Object.entries(meeting).filter(([key]) => key !== 'signals'),
    );
    batch.set(rootRef.collection('meetings').doc(meeting.id), storedMeeting, { merge: true });
    if (meeting.topics.length > 0) {
      batch.set(rootRef.collection('registers').doc(`decision-${meeting.id}`), {
        type: 'decision',
        title: meeting.summary,
        meetingTitle: meeting.title,
        date: meeting.date,
        status: meeting.status === 'minutes' ? 'Official minutes available' : 'Provisional',
        sourceUrl: meeting.sourceUrl,
        confidence: meeting.confidence,
        topics: meeting.topics,
        updatedAt: now.toISOString(),
      }, { merge: true });
    }
  }
  for (const [id, profile] of profileMap) {
    batch.set(rootRef.collection('councillors').doc(id), {
      name: profile.name,
      meetingCount: profile.meetingIds.size,
      voteCount: profile.voteCount,
      positionCount: profile.voteCount,
      motionCount: profile.moverCount + profile.seconderCount,
      latestPosition: profile.latestPosition ?? 'No named recorded vote found',
      confidence: profile.voteCount > 0 ? 'high' : 'low',
      updatedAt: now.toISOString(),
    }, { merge: true });
  }

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - PILOT_DAYS);
  const extractionGaps = meetings.filter(meeting => meeting.status === 'extraction-gap').length;
  const processedMeetings = meetings.filter(meeting => meeting.status !== 'extraction-gap').length;
  batch.set(rootRef, {
    sourceLabel: SOURCE_LABEL,
    sourceUrl: SOURCE_ORIGIN,
    windowStart: cutoff.toISOString(),
    windowEnd: now.toISOString(),
    lastSyncedAt: admin.firestore.FieldValue.serverTimestamp(),
    sourceHealth: {
      status: extractionGaps === 0 ? 'healthy' : processedMeetings > 0 ? 'partial' : 'error',
      discoveredMeetings: meetings.length,
      processedMeetings,
      extractionGaps,
      message: extractionGaps === 0 ? 'Official portal sync completed.' : `${extractionGaps} meeting record(s) require source review.`,
    },
  }, { merge: true });
  await batch.commit();
}

export async function syncCouncilIntelligence(teamId: string, now = new Date()): Promise<{ discovered: number; processed: number }> {
  const listingHtml = await fetchSource(`${SOURCE_ORIGIN}/`);
  const discovered = discoverMeetingsFromListing(listingHtml, now);
  const meetings: ProcessedMeeting[] = [];
  for (const meeting of discovered) {
    meetings.push(await processMeeting(meeting, now));
  }
  await writeWorkspace(teamId, meetings, now);
  return { discovered: discovered.length, processed: meetings.filter(meeting => meeting.status !== 'extraction-gap').length };
}

async function assertOwnerOrAdmin(
  request: { auth?: { uid: string; token: Record<string, unknown> } },
  teamId: string,
): Promise<void> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  if (request.auth?.token.schedulerAdmin === true) return;
  const member = await admin.firestore().doc(`teams/${teamId}/members/${uid}`).get();
  if (!member.exists || !['owner', 'admin'].includes(member.data()?.role)) {
    throw new HttpsError('permission-denied', 'Team owner or administrator access is required to refresh Council Intelligence.');
  }
}

export const refreshCouncilIntelligence = onCall({ region: 'us-central1', timeoutSeconds: 540, memory: '1GiB' }, async request => {
  const teamId = typeof request.data?.teamId === 'string' ? request.data.teamId.trim() : '';
  if (!teamId || teamId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(teamId)) {
    throw new HttpsError('invalid-argument', 'A valid team ID is required.');
  }
  await assertOwnerOrAdmin(request, teamId);
  const result = await syncCouncilIntelligence(teamId);
  return { refreshed: true, ...result };
});

export const scheduledCouncilIntelligenceSync = onSchedule({
  schedule: 'every 6 hours',
  timeZone: 'America/Toronto',
  region: 'us-central1',
  timeoutSeconds: 540,
  memory: '1GiB',
  retryCount: 2,
}, async () => {
  await syncCouncilIntelligence(DEFAULT_TEAM_ID);
});
