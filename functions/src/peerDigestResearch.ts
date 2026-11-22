/**
 * Peer Agency Watch research: Claude Opus 5.5 on the Anthropic API.
 *
 * Stage A (one call per agency, a few at a time): web search and web fetch, which run on
 * Anthropic's servers, collect the week's news as notes with source links.
 * Stage B (one call): an editor turns every agency's notes into the digest JSON.
 * The code then keeps only items whose links the researcher actually saw (peerDigest.ts).
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlock,
  BetaMessage,
  BetaMessageParam,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  extractUrls,
  PEER_DIGEST_CATEGORY_LABEL,
  PEER_DIGEST_SCHEMA,
  PeerDigestAgencyRun,
  PeerDigestContent,
  PeerDigestUsage,
  addUsage,
  emptyUsage,
  sanitizeDigestContent,
} from './peerDigest';
import { DEFAULT_BARRIE_CONTEXT, PEER_AGENCIES, PeerAgency } from './peerDigestSources';

export const PEER_DIGEST_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const AGENCY_CONCURRENCY = 5;
const MAX_CONTINUATIONS = 4;
const NO_NEWS = 'NO NEWS';

export interface ResearchInput {
  apiKey: string;
  coverage: { start: string; end: string };
  barrieContext?: string;
  editorNotes?: string;
  /** Titles from the last few digests, so the editor doesn't repeat a story. */
  recentTitles?: string[];
  /** Research only these agency ids (tuning runs). Default: all. */
  agencyIds?: string[];
  log?: (message: string) => void;
  /** Tests pass a stand-in; production builds a client from apiKey. */
  client?: Anthropic;
}

export interface ResearchResult {
  content: PeerDigestContent;
  agencies: PeerDigestAgencyRun[];
  droppedItems: number;
  usage: PeerDigestUsage;
}

interface AgencyNotes {
  agency: PeerAgency;
  notes: string;
  urls: string[];
}

function usagePart(usage: BetaUsage): Omit<PeerDigestUsage, 'estimatedCostUsd'> {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
    webFetches: usage.server_tool_use?.web_fetch_requests ?? 0,
  };
}

function textOf(content: BetaContentBlock[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text).join('').trim();
}

/** URLs from tool results and citations: everything the researcher saw, not what it wrote. */
function seenUrls(content: BetaContentBlock[]): string[] {
  const urls: string[] = [];
  for (const block of content) {
    if (block.type === 'text') {
      for (const citation of block.citations ?? []) {
        if (citation.type === 'web_search_result_location') urls.push(citation.url);
      }
    } else if (block.type.endsWith('_tool_result')) {
      urls.push(...extractUrls(JSON.stringify(block)));
    }
  }
  return urls;
}

const RESEARCH_SYSTEM = `You research public news about Canadian transit agencies for the transit planning and management team at Barrie Transit (Ontario). You read agency websites, council agendas and minutes, and local news, and you report only what the sources say.

Rules:
- Report only news published, decided or announced inside the date window you are given. Ignore older stories, even if they appear first in search results.
- Also note any dated event coming up in the next 60 days that you find: council or committee meetings with transit items, public consultations, RFP closing dates, service launches.
- Be specific: route numbers, dollar amounts, dates, percentages, vehicle counts, vote results.
- Every item must list the exact URLs you opened or saw in search results. Never write a URL you did not see.
- Do not pad. If you find nothing relevant in the window, answer exactly: ${NO_NEWS}`;

function researchPrompt(agency: PeerAgency, coverage: { start: string; end: string }): string {
  const themes = Object.values(PEER_DIGEST_CATEGORY_LABEL).filter(label => label !== 'Other').join(', ');
  return `Agency: ${agency.name} (${agency.area})
Date window: ${coverage.start} to ${coverage.end} (inclusive)

Start with these pages: ${agency.start.join(', ')}
${agency.news.length ? `Local news that covers them: ${agency.news.join(', ')}` : ''}
Search more widely if needed.

Look for: ${themes}; also network redesigns, on-time performance, safety, accessibility (AODA), partnerships, and transit items at council.

Answer with one block per item:
ITEM: <plain headline>
DATE: <YYYY-MM-DD published or decided>
WHAT: <two to four sentences with the specifics>
SOURCES: <URL>, <URL>

Then, if any, one block per upcoming event:
UPCOMING: <YYYY-MM-DD> | <what> | <URL>

Or answer exactly ${NO_NEWS}.`;
}

async function researchAgency(
  client: Anthropic,
  agency: PeerAgency,
  coverage: { start: string; end: string },
): Promise<{ notes: AgencyNotes; usage: Omit<PeerDigestUsage, 'estimatedCostUsd'>[] }> {
  const messages: BetaMessageParam[] = [{ role: 'user', content: researchPrompt(agency, coverage) }];
  const usage: Omit<PeerDigestUsage, 'estimatedCostUsd'>[] = [];
  const urls: string[] = [];
  let text = '';

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
    const response: BetaMessage = await client.beta.messages.stream({
      model: PEER_DIGEST_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: RESEARCH_SYSTEM,
      tools: [
        {
          type: 'web_search_20260209',
          name: 'web_search',
          max_uses: 6,
          user_location: { type: 'approximate', country: 'CA', region: 'Ontario', timezone: 'America/Toronto' },
        },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6 },
      ],
      messages,
    }).finalMessage();

    usage.push(usagePart(response.usage));
    urls.push(...seenUrls(response.content));
    text += textOf(response.content);

    if (response.stop_reason === 'refusal') {
      throw new Error(`declined (${response.stop_details?.category ?? 'no category'})`);
    }
    // A long server-tool turn pauses; send it back as-is and the server carries on.
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    break;
  }
  return { notes: { agency, notes: text, urls }, usage };
}

/** Runs tasks with at most `limit` in flight; results keep input order. */
async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function editorSystem(barrieContext: string, editorNotes: string): string {
  return `You are the editor of "Peer Agency Watch", a weekly section in the Monday morning email to Barrie Transit's management and planning team. Researchers have collected this week's news from peer transit agencies. You choose what Barrie should know and write it up.

About Barrie Transit:
${barrieContext}

How to write:
- Plain language, Canadian spelling, no hype or filler adjectives. Short sentences. Specific numbers.
- Pick what a transit manager or planner in Barrie would act on, cite in a report, or want to know before a council meeting. Leave out routine notices (holiday schedules, single stop closures, snow detours) unless they show a policy change.
- Merge items that describe the same story. One item per story.
- "barrieRelevance" ties the item to Barrie's own work: a comparison, a precedent, a risk, a funding opportunity, or a contact worth calling. Don't overstate it; if the link is weak, say what to watch for.
- importance "high" is for something Barrie may want to act on or brief council about; most items are "medium".
- Use only URLs that appear in the researchers' notes, copied exactly.
- Only news from the date window goes in "items". Dated future events go in "upcoming".
- If the week was quiet, return few items. An empty list is fine; never invent news.
- Skip stories already covered in recent weeks unless there is a new development; then say what is new.
${editorNotes ? `\nNotes from the Barrie team for this week's edition (follow them):\n${editorNotes}` : ''}`;
}

function editorPrompt(input: ResearchInput, notes: AgencyNotes[]): string {
  const blocks = notes.map(entry => `## ${entry.agency.name} (${entry.agency.area})\n${entry.notes || NO_NEWS}`);
  const recent = input.recentTitles?.length
    ? `\n\nStories already covered in recent weeks:\n${input.recentTitles.map(title => `- ${title}`).join('\n')}`
    : '';
  return `Date window: ${input.coverage.start} to ${input.coverage.end}.

Researchers' notes, by agency:

${blocks.join('\n\n')}${recent}

Write this week's Peer Agency Watch as JSON in the given schema.`;
}

export async function researchPeerDigest(input: ResearchInput): Promise<ResearchResult> {
  const log = input.log ?? (() => {});
  const client = input.client ?? new Anthropic({ apiKey: input.apiKey, maxRetries: 3, timeout: 15 * 60 * 1000 });
  const agencies = input.agencyIds?.length
    ? PEER_AGENCIES.filter(agency => input.agencyIds!.includes(agency.id))
    : PEER_AGENCIES;

  let usage = emptyUsage();
  const runs: PeerDigestAgencyRun[] = [];
  const notes: AgencyNotes[] = [];

  const results = await mapLimited(agencies, AGENCY_CONCURRENCY, agency => researchAgency(client, agency, input.coverage));
  results.forEach((result, index) => {
    const agency = agencies[index];
    if (result.status === 'fulfilled') {
      for (const part of result.value.usage) usage = addUsage(usage, part);
      const { notes: agencyNotes } = result.value;
      const noNews = !agencyNotes.notes || agencyNotes.notes.trim().toUpperCase().startsWith(NO_NEWS);
      runs.push({ id: agency.id, name: agency.name, ok: true, noNews, urlCount: new Set(agencyNotes.urls).size });
      notes.push(agencyNotes);
      log(`[peerDigest] ${agency.id}: ${noNews ? 'no news' : `${agencyNotes.urls.length} urls seen`}`);
    } else {
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      runs.push({ id: agency.id, name: agency.name, ok: false, error: message.slice(0, 300), urlCount: 0 });
      log(`[peerDigest] ${agency.id} failed: ${message}`);
    }
  });

  if (notes.length === 0) throw new Error('Every agency failed; nothing to edit.');

  const withNews = notes.filter(entry => !runs.find(run => run.id === entry.agency.id)?.noNews);
  const quietNames = notes.filter(entry => !withNews.includes(entry)).map(entry => entry.agency.name);
  if (withNews.length === 0) {
    return {
      content: { headline: [], items: [], upcoming: [], quietAgencies: quietNames },
      agencies: runs,
      droppedItems: 0,
      usage,
    };
  }

  const editor = await client.beta.messages.stream({
    model: PEER_DIGEST_MODEL,
    max_tokens: 32000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema: PEER_DIGEST_SCHEMA } },
    system: editorSystem(input.barrieContext || DEFAULT_BARRIE_CONTEXT, input.editorNotes ?? ''),
    messages: [{ role: 'user', content: editorPrompt(input, notes) }],
  }).finalMessage();
  usage = addUsage(usage, usagePart(editor.usage));

  if (editor.stop_reason === 'refusal') {
    throw new Error(`Editor declined (${editor.stop_details?.category ?? 'no category'})`);
  }
  if (editor.stop_reason === 'max_tokens') throw new Error('Editor output was cut off (max_tokens).');

  let parsed: unknown;
  try {
    parsed = JSON.parse(textOf(editor.content));
  } catch {
    throw new Error('Editor output was not valid JSON.');
  }

  const { content, droppedItems } = sanitizeDigestContent(parsed, notes.flatMap(entry => entry.urls), input.coverage);
  for (const name of quietNames) {
    if (!content.quietAgencies.includes(name)) content.quietAgencies.push(name);
  }
  log(`[peerDigest] editor: ${content.items.length} items, ${droppedItems} dropped, ~$${usage.estimatedCostUsd}`);
  return { content, agencies: runs, droppedItems, usage };
}
