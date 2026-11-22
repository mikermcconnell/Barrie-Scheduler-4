// @vitest-environment node
import { beforeEach, describe, expect, test } from 'vitest';
import { researchPeerDigest } from '../functions/src/peerDigestResearch';

type Params = { system?: string; tools?: unknown[]; messages: Array<{ role: string; content: unknown }>; output_config?: { format?: unknown } };
const calls: Params[] = [];
let respond: (params: Params) => unknown;

const client = {
  beta: {
    messages: {
      stream: (params: Params) => {
        calls.push(structuredClone(params));
        return { finalMessage: async () => respond(params) };
      },
    },
  },
} as unknown as NonNullable<Parameters<typeof researchPeerDigest>[0]['client']>;

const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 } };
const GUELPH_URL = 'https://www.guelphtoday.com/local-news/fares-2027';

function researchReply(params: Params) {
  const prompt = String(params.messages[0].content);
  if (prompt.includes('Guelph')) {
    // First turn pauses mid-search; the continuation carries on.
    if (params.messages.length === 1) {
      return {
        stop_reason: 'pause_turn',
        usage,
        content: [{ type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: GUELPH_URL, title: 'Fares', encrypted_content: 'x' }] }],
      };
    }
    return {
      stop_reason: 'end_turn',
      usage,
      content: [{ type: 'text', text: `ITEM: Guelph freezes fares\nDATE: 2026-11-18\nWHAT: Held at $3.50.\nSOURCES: ${GUELPH_URL}` }],
    };
  }
  return { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'NO NEWS' }] };
}

function editorReply() {
  return {
    stop_reason: 'end_turn',
    usage,
    content: [{
      type: 'text',
      
      text: JSON.stringify({
        headline: ['Guelph froze fares.'],
        items: [
          { agency: 'Guelph Transit', title: 'Guelph freezes fares', category: 'fares', date: '2026-11-18', summary: 'Held at $3.50.', barrieRelevance: 'Compare.', importance: 'high', sourceUrls: [GUELPH_URL] },
          { agency: 'Guelph Transit', title: 'Invented', category: 'fares', date: '2026-11-18', summary: 'x', barrieRelevance: 'x', importance: 'low', sourceUrls: ['https://guelph.ca/not-seen'] },
        ],
        upcoming: [],
        quietAgencies: [],
      }),
    }],
  };
}

beforeEach(() => {
  calls.length = 0;
  respond = params => (params.output_config?.format ? editorReply() : researchReply(params));
});

describe('researchPeerDigest', () => {
  const input = { apiKey: 'test', client, coverage: { start: '2026-11-16', end: '2026-11-22' }, agencyIds: ['guelph', 'kingston'] };

  test('resumes paused searches, edits, and drops links the researcher never saw', async () => {
    const result = await researchPeerDigest(input);
    expect(result.content.items.map(item => item.title)).toEqual(['Guelph freezes fares']);
    expect(result.droppedItems).toBe(1);
    expect(result.content.quietAgencies).toEqual(['Kingston Transit']);
    expect(result.agencies.find(agency => agency.id === 'kingston')?.noNews).toBe(true);
    // Guelph: two turns (paused, resumed); Kingston: one; editor: one.
    expect(calls).toHaveLength(4);
    const resumed = calls.find(call => call.messages.length === 2);
    expect(resumed?.messages[1].role).toBe('assistant');
    expect(result.usage.webSearches).toBe(8);
  });

  test('the editor gets Barrie context and the team\'s notes', async () => {
    await researchPeerDigest({ ...input, editorNotes: 'More on fares please.', recentTitles: ['Guelph Transit: Old story'] });
    const editor = calls.find(call => call.output_config?.format);
    expect(editor?.system).toContain('Barrie Transit');
    expect(editor?.system).toContain('More on fares please.');
    expect(String(editor?.messages[0].content)).toContain('Old story');
  });

  test('a quiet week skips the editor', async () => {
    respond = () => ({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'NO NEWS' }] });
    const result = await researchPeerDigest(input);
    expect(result.content.items).toEqual([]);
    expect(calls.some(call => call.output_config?.format)).toBe(false);
  });

  test('one agency failing does not stop the digest', async () => {
    respond = params => {
      if (params.output_config?.format) return editorReply();
      if (String(params.messages[0].content).includes('Kingston')) {
        return { stop_reason: 'refusal', stop_details: { category: null }, usage, content: [] };
      }
      return researchReply(params);
    };
    const result = await researchPeerDigest(input);
    expect(result.agencies.find(agency => agency.id === 'kingston')).toMatchObject({ ok: false });
    expect(result.content.items).toHaveLength(1);
  });
});
