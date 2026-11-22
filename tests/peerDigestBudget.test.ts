// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { parsePeerDigestSettings, runBudgetUsd } from '../functions/src/peerDigest';
import { researchPeerDigest, usageFromError } from '../functions/src/peerDigestResearch';

describe('monthly budget', () => {
  const settings = parsePeerDigestSettings(undefined);

  test('defaults to US$100 a month and US$20 a run', () => {
    expect(settings.monthlyBudgetUsd).toBe(100);
    expect(settings.maxRunUsd).toBe(20);
    expect(parsePeerDigestSettings({ monthlyBudgetUsd: 60, maxRunUsd: -1 })).toMatchObject({ monthlyBudgetUsd: 60, maxRunUsd: 20 });
  });

  test('a run gets the per-run ceiling, cut to what is left of the month', () => {
    expect(runBudgetUsd(settings, 0, false)).toBe(20);
    expect(runBudgetUsd(settings, 85, false)).toBe(15);
    expect(runBudgetUsd(settings, 85.5, true)).toBe(14.5);
  });

  test('no run starts when too little is left', () => {
    expect(runBudgetUsd(settings, 90, false)).toBeNull();
    expect(runBudgetUsd(settings, 96, true)).toBeNull();
    expect(runBudgetUsd(settings, 120, true)).toBeNull();
  });
});

describe('run budget inside the research', () => {
  // Every agency call costs US$4 (1M input tokens); notes say NO NEWS so the editor is skipped.
  const usage = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } };
  let calls = 0;
  const client = {
    beta: {
      messages: {
        stream: () => {
          calls += 1;
          return { finalMessage: async () => ({ stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'NO NEWS' }] }) };
        },
      },
    },
  } as unknown as NonNullable<Parameters<typeof researchPeerDigest>[0]['client']>;

  test('stops starting agencies before the budget runs out and records them as skipped', async () => {
    calls = 0;
    const result = await researchPeerDigest({ apiKey: 'test', client, coverage: { start: '2026-11-16', end: '2026-11-22' }, budgetUsd: 20 });
    // Three start (allowance 1.5 each); once calls cost 4, the margin grows to 5 per call in flight.
    expect(calls).toBeLessThan(18);
    expect(result.usage.estimatedCostUsd).toBeLessThanOrEqual(20);
    expect(result.agencies.filter(agency => agency.error === 'skipped: run budget reached').length).toBe(18 - calls);
  });

  test('a failed run still reports what it spent', async () => {
    const failing = {
      beta: { messages: { stream: () => ({ finalMessage: async () => ({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, usage, content: [] as unknown[] }) }) } },
    } as unknown as NonNullable<Parameters<typeof researchPeerDigest>[0]['client']>;
    const error = await researchPeerDigest({ apiKey: 'test', client: failing, coverage: { start: '2026-11-16', end: '2026-11-22' }, agencyIds: ['guelph'] }).catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(usageFromError(error)?.estimatedCostUsd).toBe(4);
  });
});
