import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildPerformanceGenerationId,
  buildPerformanceImportId,
  buildPerformanceSourceRevision,
  getBlockingPerformanceImportsForRebuild,
  getRebuildEligiblePerformanceImports,
  mergeDailySummariesByImportVersion,
  performanceMetadataVersionMatches,
  retryPerformanceMetadataConflicts,
  shouldCleanupFailedPerformanceGeneration,
  shouldClaimQueuedPerformanceImport,
  shouldDeduplicatePerformanceImport,
  shouldFinalizeExhaustedPerformanceImport,
} from '../functions/src/index';

describe('queued performance imports', () => {
  it('uses CSV content and the processor version as its idempotency key', () => {
    const first = buildPerformanceImportId('header\nrow-a', 'processor-v1');
    const retry = buildPerformanceImportId('header\nrow-a', 'processor-v1');
    const changed = buildPerformanceImportId('header\nrow-b', 'processor-v1');
    const upgraded = buildPerformanceImportId('header\nrow-a', 'processor-v2');

    expect(first).toHaveLength(64);
    expect(retry).toBe(first);
    expect(changed).not.toBe(first);
    expect(upgraded).not.toBe(first);
  });

  it('deduplicates only active or completed work so failed content can be requeued', () => {
    expect(shouldDeduplicatePerformanceImport('queued')).toBe(true);
    expect(shouldDeduplicatePerformanceImport('processing')).toBe(true);
    expect(shouldDeduplicatePerformanceImport('completed')).toBe(true);
    expect(shouldDeduplicatePerformanceImport('failed')).toBe(false);
    expect(shouldDeduplicatePerformanceImport(undefined)).toBe(false);
  });

  it('does not let an older import replace a newer same-day correction', () => {
    const result = mergeDailySummariesByImportVersion(
      [{ date: '2026-01-01', marker: 'newer' }] as any,
      [
        { date: '2026-01-01', marker: 'older' },
        { date: '2026-01-02', marker: 'new-date' },
      ] as any,
      { '2026-01-01': buildPerformanceSourceRevision(200, 'newer') },
      buildPerformanceSourceRevision(100, 'older'),
      10_000,
    );

    expect(result.summaries).toEqual([
      expect.objectContaining({ date: '2026-01-01', marker: 'newer' }),
      expect.objectContaining({ date: '2026-01-02', marker: 'new-date' }),
    ]);
    expect(result.serviceDateImportVersions).toEqual({
      '2026-01-01': buildPerformanceSourceRevision(200, 'newer'),
      '2026-01-02': buildPerformanceSourceRevision(100, 'older'),
    });
  });

  it('lets a newer import replace an older same-day value', () => {
    const result = mergeDailySummariesByImportVersion(
      [{ date: '2026-01-01', marker: 'older' }] as any,
      [{ date: '2026-01-01', marker: 'newer' }] as any,
      { '2026-01-01': buildPerformanceSourceRevision(100, 'older') },
      buildPerformanceSourceRevision(200, 'newer'),
      10_000,
    );

    expect(result.summaries[0]).toEqual(expect.objectContaining({ marker: 'newer' }));
    expect(result.serviceDateImportVersions['2026-01-01'])
      .toBe(buildPerformanceSourceRevision(200, 'newer'));
  });

  it('totally orders imports received in the same millisecond', () => {
    const first = buildPerformanceSourceRevision(123, '00000000-0000-0000-0000-000000000001');
    const second = buildPerformanceSourceRevision(123, '00000000-0000-0000-0000-000000000002');

    expect(first).toBe('0000000000123-00000000-0000-0000-0000-000000000001');
    expect(second.localeCompare(first)).toBeGreaterThan(0);
  });

  it('protects unversioned existing dates with the metadata update revision', () => {
    const result = mergeDailySummariesByImportVersion(
      [{ date: '2026-01-01', marker: 'existing' }] as any,
      [{ date: '2026-01-01', marker: 'stale-queued' }] as any,
      {},
      buildPerformanceSourceRevision(100, 'queued'),
      10_000,
      buildPerformanceSourceRevision(200, 'legacy-metadata'),
    );

    expect(result.summaries[0]).toEqual(expect.objectContaining({ marker: 'existing' }));
  });

  it('gives a failed content hash a new queue record and cleans unused archives', () => {
    const source = readFileSync('functions/src/index.ts', 'utf8');
    const queue = source.match(
      /async function queuePerformanceImport\([\s\S]*?async function savePerformanceSummary/,
    )?.[0] ?? '';

    expect(queue).toContain("imports.where('contentHash', '==', contentHash)");
    expect(queue).toContain('const runId = matching.empty');
    expect(queue).toMatch(/const runId = matching\.empty[\s\S]*?randomUUID\(\)/);
    expect(queue).toContain('await cleanupUnreferencedArchive()');
  });

  it('uses distinct storage generations for simultaneous publication attempts', () => {
    expect(buildPerformanceGenerationId(123, 'first')).toBe('123-first');
    expect(buildPerformanceGenerationId(123, 'first'))
      .not.toBe(buildPerformanceGenerationId(123, 'second'));
  });

  it('preserves a generation after an ambiguous metadata publish error', () => {
    expect(shouldCleanupFailedPerformanceGeneration(false, new Error('storage failed'))).toBe(true);
    expect(shouldCleanupFailedPerformanceGeneration(true, new Error('publish timed out'))).toBe(false);

    const conflict = new Error('stale metadata');
    conflict.name = 'PerformanceMetadataConflictError';
    expect(shouldCleanupFailedPerformanceGeneration(true, conflict)).toBe(true);
  });

  it('claims queued or recoverable imports up to the retry limit', () => {
    expect(shouldClaimQueuedPerformanceImport('queued', 0)).toBe(true);
    expect(shouldClaimQueuedPerformanceImport('processing', 1)).toBe(true);
    expect(shouldClaimQueuedPerformanceImport('failed', 2)).toBe(true);
    expect(shouldClaimQueuedPerformanceImport('failed', 3)).toBe(false);
    expect(shouldClaimQueuedPerformanceImport('completed', 0)).toBe(false);
    expect(shouldClaimQueuedPerformanceImport(undefined, undefined)).toBe(false);
  });

  it('turns an exhausted crashed processor into a re-runnable terminal failure', () => {
    expect(shouldFinalizeExhaustedPerformanceImport('processing', 2)).toBe(false);
    expect(shouldFinalizeExhaustedPerformanceImport('processing', 3)).toBe(true);
    expect(shouldFinalizeExhaustedPerformanceImport('failed', 3)).toBe(false);
  });

  it('acknowledges Power Automate before long-running aggregation begins', () => {
    const source = readFileSync('functions/src/index.ts', 'utf8');
    const endpoint = source.match(
      /export const ingestPerformanceData = onRequest\([\s\S]*?export const processQueuedPerformanceImport/,
    )?.[0] ?? '';
    const automatedBranch = endpoint.match(/if \(actor\.mode === 'automated'\) \{[\s\S]*?\n {6}\}/)?.[0] ?? '';

    expect(endpoint).toContain('concurrency: 1');
    expect(automatedBranch).toContain('queuePerformanceImport');
    expect(automatedBranch).toContain('res.status(202).json');
    expect(automatedBranch).not.toContain('aggregateDailySummaries');
  });

  it('runs queued work in one retryable background processor', () => {
    const source = readFileSync('functions/src/index.ts', 'utf8');
    const processor = source.match(
      /export const processQueuedPerformanceImport = onDocumentCreated\([\s\S]*?\n\);\n\n\/\*\*/,
    )?.[0] ?? '';

    expect(processor).toContain("document: 'teams/{teamId}/performanceImports/{runId}'");
    expect(processor).toContain('timeoutSeconds: 540');
    expect(processor).toContain('maxInstances: 1');
    expect(processor).toContain('concurrency: 1');
    expect(processor).toContain('retry: true');
    expect(processor).toContain("status: 'completed'");
    expect(processor).toContain("status: 'failed'");
    expect(processor).toContain('shouldFinalizeExhaustedPerformanceImport');
  });

  it('retries a stale metadata publication so concurrent imports both merge', async () => {
    let calls = 0;
    const result = await retryPerformanceMetadataConflicts(async attempt => {
      calls += 1;
      if (attempt < 3) {
        const conflict = new Error('stale metadata');
        conflict.name = 'PerformanceMetadataConflictError';
        throw conflict;
      }
      return 'saved';
    });

    expect(result).toBe('saved');
    expect(calls).toBe(3);
  });

  it('does not retry unrelated import failures', async () => {
    let calls = 0;
    await expect(retryPerformanceMetadataConflicts(async () => {
      calls += 1;
      throw new Error('storage unavailable');
    })).rejects.toThrow('storage unavailable');

    expect(calls).toBe(1);
  });

  it('fails closed after the bounded conflict retry limit', async () => {
    let calls = 0;
    await expect(retryPerformanceMetadataConflicts(async () => {
      calls += 1;
      const conflict = new Error('still stale');
      conflict.name = 'PerformanceMetadataConflictError';
      throw conflict;
    }, 2)).rejects.toMatchObject({ name: 'PerformanceMetadataConflictError' });

    expect(calls).toBe(2);
  });

  it('replays only completed and legacy imports in chronological order', () => {
    const timestamp = (value: number) => ({ toMillis: () => value });
    const runs = getRebuildEligiblePerformanceImports([
      { id: 'completed-late', status: 'completed', importedAt: timestamp(300) as any },
      { id: 'queued', status: 'queued', importedAt: timestamp(100) as any },
      { id: 'legacy', importedAt: timestamp(200) as any },
      { id: 'failed', status: 'failed', importedAt: timestamp(50) as any },
      { id: 'processing', status: 'processing', importedAt: timestamp(75) as any },
      { id: 'completed-early-b', status: 'completed', importedAt: timestamp(100) as any },
      { id: 'completed-early-a', status: 'completed', importedAt: timestamp(100) as any },
    ]);

    expect(runs.map(run => run.id)).toEqual([
      'completed-early-a',
      'completed-early-b',
      'legacy',
      'completed-late',
    ]);
  });

  it('blocks rebuilds only for overlapping active or retryable queued imports', () => {
    const runs = [
      { id: 'queued', status: 'queued', serviceDates: ['2026-01-02'] },
      { id: 'processing', status: 'processing', dateRange: { start: '2026-01-03', end: '2026-01-04' } },
      { id: 'publishing', status: 'publishing', serviceDates: ['2026-01-05'] },
      { id: 'retryable', status: 'failed', processorVersion: 'queue-v3', attemptCount: 2, serviceDates: ['2026-01-06'] },
      { id: 'terminal', status: 'failed', processorVersion: 'queue-v3', attemptCount: 3, serviceDates: ['2026-01-07'] },
      { id: 'manual-failed', status: 'failed', serviceDates: ['2026-01-08'] },
      { id: 'outside', status: 'queued', serviceDates: ['2026-02-01'] },
      { id: 'completed', status: 'completed', serviceDates: ['2026-01-09'] },
    ] as any;

    expect(getBlockingPerformanceImportsForRebuild(runs, '2026-01-01', '2026-01-31')
      .map(run => run.id)).toEqual(['queued', 'processing', 'publishing', 'retryable']);
  });

  it('keeps manual imports out of the queue until publication completes', () => {
    expect(shouldClaimQueuedPerformanceImport('publishing', 0)).toBe(false);

    const source = readFileSync('functions/src/index.ts', 'utf8');
    const archive = source.match(
      /async function savePerformanceImportArchive\([\s\S]*?const MAX_QUEUED_IMPORT_ATTEMPTS/,
    )?.[0] ?? '';
    const endpoint = source.match(
      /export const ingestPerformanceData = onRequest\([\s\S]*?export const processQueuedPerformanceImport/,
    )?.[0] ?? '';

    expect(archive).toContain("status: 'publishing'");
    expect(endpoint).toContain("status: 'completed'");
    expect(endpoint).toContain("status: 'failed'");
  });

  it('rejects stale metadata publications', () => {
    const expected = { id: 'expected' } as any;
    const matching = { isEqual: (value: unknown) => value === expected } as any;
    const stale = { isEqual: () => false } as any;

    expect(performanceMetadataVersionMatches(null, false)).toBe(true);
    expect(performanceMetadataVersionMatches(null, true, matching)).toBe(false);
    expect(performanceMetadataVersionMatches(expected, true, matching)).toBe(true);
    expect(performanceMetadataVersionMatches(expected, true, stale)).toBe(false);
    expect(performanceMetadataVersionMatches(expected, false)).toBe(false);
  });

  it('archives decoded request content as CSV and cleans unpublished files', () => {
    const source = readFileSync('functions/src/index.ts', 'utf8');
    const endpoint = source.match(
      /export const ingestPerformanceData = onRequest\([\s\S]*?export const processQueuedPerformanceImport/,
    )?.[0] ?? '';
    const save = source.match(
      /async function savePerformanceSummary\([\s\S]*?async function mergeAndSavePerformanceSummariesAttempt/,
    )?.[0] ?? '';

    expect(endpoint).toContain("const normalizedContentType = 'text/csv'");
    expect(save).toContain('metadataPublishStarted = true');
    expect(save).toContain('shouldCleanupFailedPerformanceGeneration(metadataPublishStarted, error)');
  });
});
