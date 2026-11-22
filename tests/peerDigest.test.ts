import { describe, expect, test } from 'vitest';
import {
  addDays,
  addUsage,
  digestCoverage,
  digestWeekOf,
  emptyUsage,
  mondayOnOrBefore,
  normalizeUrl,
  parsePeerDigestSettings,
  PeerDigestDoc,
  sanitizeDigestContent,
} from '../functions/src/peerDigest';
import { buildPeerDigestDraftHtml, buildPeerDigestSection } from '../functions/src/peerDigestHtml';
import { PEER_AGENCIES } from '../functions/src/peerDigestSources';

const coverage = { start: '2026-11-16', end: '2026-11-22' };
const seen = [
  'https://www.guelphtoday.com/local-news/guelph-transit-fares-2027-123/',
  'https://guelph.ca/news/council-budget',
];

function item(overrides: Record<string, unknown> = {}) {
  return {
    agency: 'Guelph Transit',
    title: 'Guelph freezes fares for 2027',
    category: 'fares',
    date: '2026-11-18',
    summary: 'Council voted 9-4 to hold the adult fare at $3.50.',
    barrieRelevance: 'Barrie sets 2027 fares in the same budget cycle.',
    importance: 'high',
    sourceUrls: ['https://guelphtoday.com/local-news/guelph-transit-fares-2027-123'],
    ...overrides,
  };
}

describe('digest dates', () => {
  test('a Sunday run targets the next day and covers Monday to Sunday', () => {
    expect(digestWeekOf('2026-11-22')).toBe('2026-11-23');
    expect(digestCoverage('2026-11-23')).toEqual({ start: '2026-11-16', end: '2026-11-22' });
  });

  test('a run on any other day targets the coming Monday', () => {
    expect(digestWeekOf('2026-11-23')).toBe('2026-11-30');
    expect(digestWeekOf('2026-11-25')).toBe('2026-11-30');
    expect(digestWeekOf('2026-11-28')).toBe('2026-11-30');
  });

  test('daily reports Monday to Sunday look up that Monday\'s digest', () => {
    for (let offset = 0; offset < 7; offset += 1) {
      expect(mondayOnOrBefore(addDays('2026-11-23', offset))).toBe('2026-11-23');
    }
  });
});

describe('settings', () => {
  test('default to draft mode', () => {
    expect(parsePeerDigestSettings(undefined).mode).toBe('draft');
    expect(parsePeerDigestSettings({ mode: 'LIVE' }).mode).toBe('draft');
    expect(parsePeerDigestSettings({ mode: 'live', editorNotes: '  more fares ' })).toEqual({ mode: 'live', editorNotes: 'more fares', barrieContext: '' });
  });
});

describe('sanitizeDigestContent', () => {
  test('matches URLs that differ only in www, trailing slash or fragment', () => {
    expect(normalizeUrl('https://www.GuelphToday.com/a/b/#x')).toBe(normalizeUrl('https://guelphtoday.com/a/b'));
  });

  test('keeps items whose links the researcher saw', () => {
    const { content, droppedItems } = sanitizeDigestContent({ headline: ['Fares frozen'], items: [item()], upcoming: [], quietAgencies: [] }, seen, coverage);
    expect(droppedItems).toBe(0);
    expect(content.items).toHaveLength(1);
    expect(content.headline).toEqual(['Fares frozen']);
  });

  test('drops invented links and items left with none', () => {
    const { content, droppedItems } = sanitizeDigestContent({
      headline: [],
      items: [
        item({ sourceUrls: ['https://guelph.ca/made-up-page'] }),
        item({ title: 'Budget', sourceUrls: ['https://guelph.ca/news/council-budget', 'https://fake.example/x'] }),
      ],
      upcoming: [],
      quietAgencies: [],
    }, seen, coverage);
    expect(droppedItems).toBe(1);
    expect(content.items.map(entry => entry.title)).toEqual(['Budget']);
    expect(content.items[0].sourceUrls).toEqual(['https://guelph.ca/news/council-budget']);
  });

  test('drops news dated outside the week and fixes unknown fields', () => {
    const { content, droppedItems } = sanitizeDigestContent({
      items: [
        item({ date: '2026-10-01' }),
        item({ title: 'Undated', date: 'last week', category: 'gossip', importance: 'urgent' }),
      ],
    }, seen, coverage);
    expect(droppedItems).toBe(1);
    expect(content.items[0]).toMatchObject({ title: 'Undated', date: '', category: 'other', importance: 'medium' });
  });

  test('puts high-importance items first and keeps only future upcoming events', () => {
    const { content } = sanitizeDigestContent({
      items: [item({ title: 'Low', importance: 'low' }), item({ title: 'High', importance: 'high' })],
      upcoming: [
        { agency: 'Guelph', date: '2026-12-09', what: 'Budget vote', sourceUrl: 'https://guelph.ca/news/council-budget' },
        { agency: 'Guelph', date: '2026-11-01', what: 'Old meeting', sourceUrl: 'https://guelph.ca/news/council-budget' },
        { agency: 'Guelph', date: '2026-12-01', what: 'Unsourced', sourceUrl: 'https://nowhere.example' },
      ],
    }, seen, coverage);
    expect(content.items.map(entry => entry.title)).toEqual(['High', 'Low']);
    expect(content.upcoming.map(event => event.what)).toEqual(['Budget vote']);
  });

  test('copes with junk', () => {
    expect(sanitizeDigestContent(null, seen, coverage).content).toEqual({ headline: [], items: [], upcoming: [], quietAgencies: [] });
  });
});

describe('usage', () => {
  test('estimates cost from Opus 5.5 prices and searches', () => {
    const usage = addUsage(emptyUsage(), { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 50, webFetches: 10 });
    expect(usage.estimatedCostUsd).toBe(6.5);
  });
});

function doc(overrides: Partial<PeerDigestDoc> = {}): PeerDigestDoc {
  return {
    weekOf: '2026-11-23',
    coverageStart: coverage.start,
    coverageEnd: coverage.end,
    status: 'ready',
    content: {
      headline: ['Guelph froze 2027 fares <b>today</b>'],
      items: [sanitizeDigestContent({ items: [item({ summary: 'Fare <script>alert(1)</script> held' })] }, seen, coverage).content.items[0]],
      upcoming: [{ agency: 'Guelph Transit', date: '2026-12-09', what: 'Budget vote', sourceUrl: 'https://guelph.ca/news/council-budget' }],
      quietAgencies: ['Orillia Transit'],
    },
    agencies: [{ id: 'guelph', name: 'Guelph Transit', ok: true, urlCount: 4 }, { id: 'kingston', name: 'Kingston Transit', ok: false, error: 'timeout', urlCount: 0 }],
    droppedItems: 2,
    usage: { ...emptyUsage(), estimatedCostUsd: 4.2 },
    model: 'claude-opus-5-5',
    builtAt: '2026-11-22T23:10:00Z',
    durationSeconds: 540,
    ...overrides,
  };
}

describe('email section', () => {
  test('renders items, sources, upcoming and quiet agencies, escaping model text', () => {
    const html = buildPeerDigestSection(doc());
    expect(html).toContain('Peer Agency Watch');
    expect(html).toContain('Guelph freezes fares for 2027');
    expect(html).toContain('href="https://guelphtoday.com/local-news/guelph-transit-fares-2027-123"');
    expect(html).toContain('guelphtoday.com');
    expect(html).toContain('Dec 9');
    expect(html).toContain('Orillia Transit');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>today</b>');
    // Email rules: no style block, flex, grid or SVG.
    expect(html).not.toMatch(/<style|display:\s*(flex|grid)|<svg/i);
  });

  test('is empty for a missing or failed digest', () => {
    expect(buildPeerDigestSection(null)).toBe('');
    expect(buildPeerDigestSection(doc({ status: 'failed', content: null }))).toBe('');
  });

  test('says when the week was quiet', () => {
    const html = buildPeerDigestSection(doc({ content: { headline: [], items: [], upcoming: [], quietAgencies: [] } }));
    expect(html).toContain('A quiet week');
  });

  test('the draft shows run details and failures', () => {
    const html = buildPeerDigestDraftHtml(doc());
    expect(html).toContain('DRAFT');
    expect(html).toContain('Kingston Transit: timeout');
    expect(html).toContain('US$4.20');
    expect(buildPeerDigestDraftHtml(doc({ status: 'failed', content: null, error: 'Every agency failed' }))).toContain('Every agency failed');
  });
});

describe('peer list', () => {
  test('ids are unique and every agency has a starting page', () => {
    expect(new Set(PEER_AGENCIES.map(agency => agency.id)).size).toBe(PEER_AGENCIES.length);
    for (const agency of PEER_AGENCIES) expect(agency.start.length).toBeGreaterThan(0);
  });
});
