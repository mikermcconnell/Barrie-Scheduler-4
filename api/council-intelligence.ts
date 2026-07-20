import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { CouncilIntelligenceWorkspaceData } from '../utils/council/councilIntelligenceService';
import { checkRateLimit, getRequestIp } from '../lib/apiSecurity';

const SOURCE_ORIGIN = 'https://pub-barrie.escribemeetings.com';
const SOURCE_LABEL = 'City of Barrie eSCRIBE (local official-source preview)';
const PILOT_DAYS = 90;
const MAX_MEETINGS = 20;
const MAX_BODY_LENGTH = 12_000;
const FETCH_TIMEOUT_MS = 20_000;
const CACHE_MS = 5 * 60 * 1000;

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
    Accessibility: ['specialized transit', 'accessible transit', 'paratransit'],
    'Funding and capital': ['transit funding', 'transit capital', 'shuttle bus'],
    'Network integration': ['active transportation', 'go transit', 'parking integration'],
};

interface DiscoveredMeeting {
    id: string;
    title: string;
    date: string;
    sourceUrl: string;
}

let cache: { expiresAt: number; data: CouncilIntelligenceWorkspaceData } | null = null;

function sendJson(res: Pick<VercelResponse, 'statusCode' | 'setHeader' | 'end'>, statusCode: number, payload: unknown): void {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(payload));
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

function sourceUrl(pathOrUrl: string): string | null {
    try {
        const url = new URL(pathOrUrl, SOURCE_ORIGIN);
        return url.protocol === 'https:' && url.hostname === 'pub-barrie.escribemeetings.com'
            ? url.toString()
            : null;
    } catch {
        return null;
    }
}

async function fetchSource(url: string): Promise<string> {
    const validatedUrl = sourceUrl(url);
    if (!validatedUrl) throw new Error('Rejected Council source URL.');
    const response = await fetch(validatedUrl, {
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': 'BarrieTransitCouncilIndexer/1.0', accept: 'text/html' },
    });
    if (!response.ok) throw new Error(`Council source returned HTTP ${response.status}.`);
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('text/html')) {
        throw new Error('Council source returned an unexpected content type.');
    }
    if (!sourceUrl(response.url)) throw new Error('Council source redirected outside the allowlist.');
    const html = await response.text();
    if (html.length > 4_000_000) throw new Error('Council source response exceeded the size limit.');
    return html;
}

function parsePortalDate(value: string): string | null {
    const normalized = decodeHtml(value).replace(/\s+-\s+.*?following.*$/i, '').replace(/\s+@\s+/, ' ');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function discoverLocalCouncilMeetings(html: string, now = new Date()): DiscoveredMeeting[] {
    const byId = new Map<string, DiscoveredMeeting>();
    const cards = html.split(/<div class=["'](?:upcoming-)?meeting-container["']>/i).slice(1);
    for (const card of cards) {
        const idMatch = /(?:Meeting\.aspx\?[^"']*\bId=|MeetingId=)([0-9a-f-]{36})/i.exec(card);
        const titleMatch = /class=["']meeting-title-heading["'][^>]*>[\s\S]*?(?:<a[^>]*>|<span[^>]*>)([\s\S]*?)<\/(?:a|span)>/i.exec(card);
        const dateMatch = /class=["']meeting-date["'][^>]*>([\s\S]*?)<\/div>/i.exec(card);
        if (!idMatch || !titleMatch || !dateMatch) continue;
        const date = parsePortalDate(htmlToText(dateMatch[1]));
        const meetingUrl = sourceUrl(`/Meeting.aspx?Id=${idMatch[1]}&lang=English`);
        if (date && meetingUrl) byId.set(idMatch[1], { id: idMatch[1], title: htmlToText(titleMatch[1]), date, sourceUrl: meetingUrl });
    }

    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - PILOT_DAYS);
    for (const seed of PILOT_SEED_MEETINGS) {
        const meetingUrl = sourceUrl(`/Meeting.aspx?Id=${seed.id}&lang=English`);
        if (new Date(seed.date) >= cutoff && meetingUrl && !byId.has(seed.id)) byId.set(seed.id, { ...seed, sourceUrl: meetingUrl });
    }
    return [...byId.values()]
        .filter(meeting => new Date(meeting.date) >= cutoff && new Date(meeting.date) <= now)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, MAX_MEETINGS);
}

function classifyTopics(text: string): string[] {
    const normalized = text.toLowerCase();
    return Object.entries(TRANSIT_TOPICS)
        .filter(([, keywords]) => keywords.some(keyword => normalized.includes(keyword)))
        .map(([topic]) => topic);
}

function extractSignals(text: string): Array<{ name: string; position?: string; vote: boolean }> {
    const signals: Array<{ name: string; position?: string; vote: boolean }> = [];
    const add = (rawName: string, vote: boolean, position?: string) => {
        const name = rawName.replace(/^(councillor|mayor)\s+/i, '').replace(/[.;:,]+$/g, '').trim().slice(0, 120);
        if (name.length >= 3) signals.push({ name, vote, position });
    };
    for (const match of text.matchAll(/Moved by\s+([^\n]{3,100})/gi)) add(match[1], false);
    for (const match of text.matchAll(/Seconded by\s+([^\n]{3,100})/gi)) add(match[1], false);
    for (const block of text.matchAll(/Recorded Vote([\s\S]{0,2500}?)(?=\n\s*\d+(?:\.\d+)*\s|$)/gi)) {
        for (const yes of block[1].matchAll(/(?:YES|Yea|For)\s*[:\-]\s*([^\n]+)/gi)) yes[1].split(/,|;/).forEach(name => add(name, true, 'Supportive'));
        for (const no of block[1].matchAll(/(?:NO|Nay|Against)\s*[:\-]\s*([^\n]+)/gi)) no[1].split(/,|;/).forEach(name => add(name, true, 'Opposed'));
    }
    return signals;
}

async function loadMeeting(meeting: DiscoveredMeeting, now: Date) {
    const minutesUrl = sourceUrl(`/Meeting.aspx?Agenda=PostMinutes&Id=${meeting.id}&lang=English`)!;
    const agendaUrl = sourceUrl(`/Meeting.aspx?Agenda=Agenda&Id=${meeting.id}&lang=English`)!;
    let html = '';
    let status: 'minutes' | 'agenda' | 'extraction-gap' = 'extraction-gap';
    let officialUrl = meeting.sourceUrl;
    try {
        html = await fetchSource(minutesUrl);
        const text = htmlToText(html);
        if (/Meeting Minutes|Minutes\s+City of Barrie|PostMinutes/i.test(text)) {
            status = 'minutes';
            officialUrl = minutesUrl;
        } else {
            html = await fetchSource(agendaUrl);
            status = 'agenda';
            officialUrl = agendaUrl;
        }
    } catch {
        status = 'extraction-gap';
    }
    const body = htmlToText(html).slice(0, MAX_BODY_LENGTH);
    const topics = classifyTopics(body);
    const relevantParagraphs = body.split(/\n+/).filter(paragraph => paragraph.length >= 40 && classifyTopics(paragraph).length > 0).slice(0, 3);
    return {
        id: meeting.id,
        title: meeting.title,
        date: meeting.date,
        status,
        body,
        sourceUrl: officialUrl,
        summary: relevantParagraphs.join(' ').slice(0, 1200) || 'No transit-relevant text was identified in the available official record.',
        topics,
        confidence: status === 'minutes' ? 'high' as const : status === 'agenda' ? 'medium' as const : 'none' as const,
        signals: extractSignals(body),
        retrievedAt: now.toISOString(),
    };
}

export async function loadLocalCouncilWorkspace(now = new Date()): Promise<CouncilIntelligenceWorkspaceData> {
    const listing = await fetchSource(`${SOURCE_ORIGIN}/`);
    const discovered = discoverLocalCouncilMeetings(listing, now);
    const loaded = await Promise.all(discovered.map(meeting => loadMeeting(meeting, now)));
    const profileMap = new Map<string, { name: string; meetings: Set<string>; votes: number; positions: number; latestPosition?: string }>();
    for (const meeting of loaded) {
        for (const signal of meeting.signals) {
            const key = signal.name.toLowerCase();
            const profile = profileMap.get(key) ?? { name: signal.name, meetings: new Set<string>(), votes: 0, positions: 0 };
            profile.meetings.add(meeting.id);
            if (signal.vote) {
                profile.votes++;
                profile.positions++;
                profile.latestPosition = signal.position;
            }
            profileMap.set(key, profile);
        }
    }
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - PILOT_DAYS);
    const gaps = loaded.filter(meeting => meeting.status === 'extraction-gap').length;
    return {
        pilot: { windowStart: cutoff.toISOString(), windowEnd: now.toISOString(), lastSyncedAt: now.toISOString(), sourceLabel: SOURCE_LABEL },
        sourceHealth: {
            status: gaps === 0 ? 'healthy' : loaded.length > gaps ? 'partial' : 'error',
            discoveredMeetings: discovered.length,
            processedMeetings: loaded.length - gaps,
            extractionGaps: gaps,
            message: 'Loaded directly from the official source for localhost preview.',
        },
        meetings: loaded.map(({ signals: _signals, retrievedAt: _retrievedAt, ...meeting }) => meeting),
        councillors: [...profileMap.entries()].map(([id, profile]) => ({
            id,
            name: profile.name,
            meetingCount: profile.meetings.size,
            voteCount: profile.votes,
            positionCount: profile.positions,
            latestPosition: profile.latestPosition ?? 'No named recorded vote found',
            confidence: profile.votes > 0 ? 'high' as const : 'low' as const,
        })).sort((a, b) => a.name.localeCompare(b.name)),
        registers: loaded.filter(meeting => meeting.topics.length > 0).map(meeting => ({
            id: `decision-${meeting.id}`,
            type: 'decision' as const,
            title: meeting.summary,
            meetingTitle: meeting.title,
            date: meeting.date,
            status: meeting.status === 'minutes' ? 'Official minutes available' : 'Provisional',
            sourceUrl: meeting.sourceUrl,
            confidence: meeting.confidence,
        })),
    };
}

export default async function councilIntelligenceApiHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'Method not allowed.' });
        return;
    }
    const requestIp = getRequestIp(req);
    if (!checkRateLimit(`council-local:${requestIp}`, 20, 60 * 60 * 1000)) {
        sendJson(res, 429, { error: 'Rate limit exceeded. Please try again later.' });
        return;
    }
    const refresh = typeof req.url === 'string' && new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1';
    try {
        if (!refresh && cache && cache.expiresAt > Date.now()) {
            sendJson(res, 200, cache.data);
            return;
        }
        const data = await loadLocalCouncilWorkspace();
        cache = { data, expiresAt: Date.now() + CACHE_MS };
        sendJson(res, 200, data);
    } catch (error) {
        console.error('Council localhost source load failed:', error instanceof Error ? error.message : 'Unknown error');
        sendJson(res, 502, { error: 'The official Council source could not be loaded.' });
    }
}
