/**
 * Peer Agency Watch: the digest model, the editor's output schema, and the checks run on it.
 * Pure functions only (no Firebase, no network), so tests can cover them directly.
 */

export const PEER_DIGEST_CATEGORIES = [
  'service',
  'fares',
  'on-demand',
  'funding',
  'procurement',
  'technology',
  'fleet',
  'council',
  'ridership',
  'labour',
  'other',
] as const;
export type PeerDigestCategory = typeof PEER_DIGEST_CATEGORIES[number];

export const PEER_DIGEST_CATEGORY_LABEL: Record<PeerDigestCategory, string> = {
  service: 'Service change',
  fares: 'Fares & passes',
  'on-demand': 'On-demand & specialized',
  funding: 'Funding',
  procurement: 'Procurement',
  technology: 'Technology',
  fleet: 'Fleet & electrification',
  council: 'Council & budget',
  ridership: 'Ridership',
  labour: 'Labour',
  other: 'Other',
};

export type PeerDigestImportance = 'high' | 'medium' | 'low';

export interface PeerDigestItem {
  agency: string;
  title: string;
  category: PeerDigestCategory;
  /** YYYY-MM-DD, or '' when the source gives no date. */
  date: string;
  summary: string;
  barrieRelevance: string;
  importance: PeerDigestImportance;
  sourceUrls: string[];
}

export interface PeerDigestUpcoming {
  agency: string;
  /** YYYY-MM-DD */
  date: string;
  what: string;
  sourceUrl: string;
}

export interface PeerDigestContent {
  headline: string[];
  items: PeerDigestItem[];
  upcoming: PeerDigestUpcoming[];
  quietAgencies: string[];
}

export interface PeerDigestUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
  webFetches: number;
  estimatedCostUsd: number;
}

export interface PeerDigestAgencyRun {
  id: string;
  name: string;
  ok: boolean;
  error?: string;
  noNews?: boolean;
  urlCount: number;
}

/** Stored at teams/{team}/peerDigests/{weekOf}. */
export interface PeerDigestDoc {
  weekOf: string;
  coverageStart: string;
  coverageEnd: string;
  status: 'ready' | 'failed';
  error?: string;
  content: PeerDigestContent | null;
  agencies: PeerDigestAgencyRun[];
  droppedItems: number;
  usage: PeerDigestUsage;
  model: string;
  builtAt: string;
  durationSeconds: number;
  includedInReportAt?: string | null;
}

export type PeerDigestMode = 'draft' | 'live';

/** Stored at teams/{team}/peerDigestConfig/settings. Every field is optional. */
export interface PeerDigestSettings {
  mode: PeerDigestMode;
  /** Extra instructions for the editor, for tuning without a deploy. */
  editorNotes: string;
  /** Replaces DEFAULT_BARRIE_CONTEXT when set. */
  barrieContext: string;
}

export function parsePeerDigestSettings(raw: Record<string, unknown> | undefined): PeerDigestSettings {
  return {
    mode: raw?.mode === 'live' ? 'live' : 'draft',
    editorNotes: typeof raw?.editorNotes === 'string' ? raw.editorNotes.trim() : '',
    barrieContext: typeof raw?.barrieContext === 'string' ? raw.barrieContext.trim() : '',
  };
}

// ─── Dates (calendar dates as YYYY-MM-DD, no time zone math) ───────────────────

function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: string): number {
  return parseDate(date).getUTCDay();
}

/** The Monday this week's digest goes out: tomorrow when run on Sunday, else the next Monday. */
export function digestWeekOf(today: string): string {
  const daysAhead = (8 - weekday(today)) % 7 || 7;
  return addDays(today, daysAhead);
}

/** The Monday on or before a date: which digest a daily report on that date may carry. */
export function mondayOnOrBefore(date: string): string {
  return addDays(date, -((weekday(date) + 6) % 7));
}

/** Seven days of news ending the day before the Monday send (Monday–Sunday). */
export function digestCoverage(weekOf: string): { start: string; end: string } {
  return { start: addDays(weekOf, -7), end: addDays(weekOf, -1) };
}

// ─── Source URLs ────────────────────────────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s"'<>\\`)\]]+/g;

/** Comparable form of a URL: lower-case host, no www., no fragment, no trailing slash or punctuation. */
export function normalizeUrl(url: string): string | null {
  const trimmed = url.trim().replace(/[.,;:!?]+$/, '');
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}${u.search}`;
  } catch {
    return null;
  }
}

/** Every URL in a block of JSON or text. */
export function extractUrls(text: string): string[] {
  return text.match(URL_PATTERN) ?? [];
}

/** Display name for a link: the host without www. */
export function sourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

// ─── Editor output schema and checks ────────────────────────────────────────

const MAX_ITEMS = 12;
const MAX_UPCOMING = 8;
const MAX_HEADLINE = 3;

/** JSON schema for the editor's structured output (output_config.format). */
export const PEER_DIGEST_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'items', 'upcoming', 'quietAgencies'],
  properties: {
    headline: {
      type: 'array',
      description: 'One to three one-sentence bullets: the most useful things for Barrie this week.',
      items: { type: 'string' },
    },
    items: {
      type: 'array',
      description: `At most ${MAX_ITEMS} items, most relevant to Barrie first.`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['agency', 'title', 'category', 'date', 'summary', 'barrieRelevance', 'importance', 'sourceUrls'],
        properties: {
          agency: { type: 'string' },
          title: { type: 'string', description: 'Plain headline, under 90 characters.' },
          category: { type: 'string', enum: [...PEER_DIGEST_CATEGORIES] },
          date: { type: 'string', description: 'YYYY-MM-DD the news was published or decided, or empty.' },
          summary: { type: 'string', description: 'Two or three sentences with the specific facts and numbers.' },
          barrieRelevance: { type: 'string', description: 'One sentence: why a Barrie Transit planner or manager should care.' },
          importance: { type: 'string', enum: ['high', 'medium', 'low'] },
          sourceUrls: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    upcoming: {
      type: 'array',
      description: `At most ${MAX_UPCOMING} dated events in the coming weeks: council or committee meetings, consultations, RFP closings, service launches.`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['agency', 'date', 'what', 'sourceUrl'],
        properties: {
          agency: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          what: { type: 'string' },
          sourceUrl: { type: 'string' },
        },
      },
    },
    quietAgencies: {
      type: 'array',
      description: 'Agencies with nothing relevant this week.',
      items: { type: 'string' },
    },
  },
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const IMPORTANCE_RANK: Record<PeerDigestImportance, number> = { high: 0, medium: 1, low: 2 };

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Checks the editor's JSON and keeps only what the research can back up: every source URL must
 * be one the researcher actually saw (search results, fetched pages or citations). Items left
 * with no source are dropped, which stops invented links reaching the email.
 */
export function sanitizeDigestContent(
  raw: unknown,
  seenUrls: Iterable<string>,
  coverage: { start: string; end: string },
): { content: PeerDigestContent; droppedItems: number } {
  const seen = new Map<string, string>();
  for (const url of seenUrls) {
    const key = normalizeUrl(url);
    if (key && !seen.has(key)) seen.set(key, url.trim().replace(/[.,;:!?]+$/, ''));
  }
  const keep = (url: unknown): string | null => {
    const key = normalizeUrl(str(url));
    return key && seen.has(key) ? str(url) : null;
  };

  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  let droppedItems = 0;

  const items: PeerDigestItem[] = [];
  for (const entry of rawItems) {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const sourceUrls = [...new Set((Array.isArray(e.sourceUrls) ? e.sourceUrls : []).map(keep).filter((u): u is string => !!u))];
    const title = str(e.title);
    const summary = str(e.summary);
    const date = DATE_PATTERN.test(str(e.date)) ? str(e.date) : '';
    // News must fall in the coverage week (a missing date is allowed; the source shows it).
    const inWindow = !date || (date >= addDays(coverage.start, -1) && date <= addDays(coverage.end, 1));
    if (!title || !summary || sourceUrls.length === 0 || !inWindow) {
      droppedItems += 1;
      continue;
    }
    const category = (PEER_DIGEST_CATEGORIES as readonly string[]).includes(str(e.category))
      ? str(e.category) as PeerDigestCategory
      : 'other';
    const importance = (['high', 'medium', 'low'] as const).find(level => level === str(e.importance)) ?? 'medium';
    items.push({
      agency: str(e.agency) || 'Unknown agency',
      title,
      category,
      date,
      summary,
      barrieRelevance: str(e.barrieRelevance),
      importance,
      sourceUrls: sourceUrls.slice(0, 3),
    });
  }
  // Stable sort keeps the editor's order inside each importance level.
  items.sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance]);
  if (items.length > MAX_ITEMS) droppedItems += items.length - MAX_ITEMS;

  const upcoming: PeerDigestUpcoming[] = [];
  for (const entry of Array.isArray(obj.upcoming) ? obj.upcoming : []) {
    const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const sourceUrl = keep(e.sourceUrl);
    const date = str(e.date);
    if (!sourceUrl || !DATE_PATTERN.test(date) || date < coverage.end || !str(e.what)) continue;
    upcoming.push({ agency: str(e.agency) || 'Unknown agency', date, what: str(e.what), sourceUrl });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  return {
    content: {
      headline: (Array.isArray(obj.headline) ? obj.headline : []).map(str).filter(Boolean).slice(0, MAX_HEADLINE),
      items: items.slice(0, MAX_ITEMS),
      upcoming: upcoming.slice(0, MAX_UPCOMING),
      quietAgencies: [...new Set((Array.isArray(obj.quietAgencies) ? obj.quietAgencies : []).map(str).filter(Boolean))],
    },
    droppedItems,
  };
}

// ─── Cost estimate ──────────────────────────────────────────────────────────

/** Claude Opus 5.5 list prices, USD per million tokens, and web search per search. */
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, perSearch: 0.01 };

export function emptyUsage(): PeerDigestUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, webFetches: 0, estimatedCostUsd: 0 };
}

export function addUsage(total: PeerDigestUsage, part: Omit<PeerDigestUsage, 'estimatedCostUsd'>): PeerDigestUsage {
  const next = {
    inputTokens: total.inputTokens + part.inputTokens,
    outputTokens: total.outputTokens + part.outputTokens,
    cacheReadTokens: total.cacheReadTokens + part.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + part.cacheWriteTokens,
    webSearches: total.webSearches + part.webSearches,
    webFetches: total.webFetches + part.webFetches,
  };
  const cost = (next.inputTokens * PRICE.input + next.outputTokens * PRICE.output
    + next.cacheReadTokens * PRICE.cacheRead + next.cacheWriteTokens * PRICE.cacheWrite) / 1_000_000
    + next.webSearches * PRICE.perSearch;
  return { ...next, estimatedCostUsd: Math.round(cost * 100) / 100 };
}
