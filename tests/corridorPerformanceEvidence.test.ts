import { describe, expect, it } from 'vitest';
import {
    buildCorridorEvidenceQuality,
    calculateMedian,
    calculatePercentile,
    isEligibleCorridorPattern,
} from '../utils/corridor-performance/corridorPerformanceEvidence';
import {
    assessCorridorBaselineCoverage,
    isCorridorServiceDateCovered,
    parseCorridorGtfsProvenance,
} from '../utils/corridor-performance/corridorPerformanceProvenance';

describe('corridor performance evidence quality', () => {
    it('calculates median and upper runtime percentiles without mutating inputs', () => {
        const values = [16, 8, 14, 10, 12];

        expect(calculateMedian(values)).toBe(12);
        expect(calculatePercentile(values, 0.8)).toBeCloseTo(14.4);
        expect(calculatePercentile(values, 0.9)).toBeCloseTo(15.2);
        expect(values).toEqual([16, 8, 14, 10, 12]);
    });

    it('requires both enough traversals and enough distinct service days', () => {
        expect(buildCorridorEvidenceQuality(8, 5)).toEqual({ level: 'usable', reasons: [] });
        expect(buildCorridorEvidenceQuality(8, 1)).toMatchObject({ level: 'low' });
        expect(buildCorridorEvidenceQuality(4, 5)).toMatchObject({ level: 'low' });
        expect(buildCorridorEvidenceQuality(0, 0)).toEqual({
            level: 'none',
            reasons: ['No matched observed traversals'],
        });
    });

    it('keeps only explicitly normal observations', () => {
        expect(isEligibleCorridorPattern(undefined)).toBe(false);
        expect(isEligibleCorridorPattern('normal')).toBe(true);
        expect(isEligibleCorridorPattern('detour')).toBe(false);
    });
});

describe('corridor GTFS provenance', () => {
    const rawFeedInfo = [
        'feed_publisher_name,feed_start_date,feed_end_date,feed_version',
        'Barrie Transit,20260527,20260829,20260503b',
    ].join('\n');

    it('reads the schedule version and effective dates', () => {
        expect(parseCorridorGtfsProvenance(rawFeedInfo)).toEqual({
            feedVersion: '20260503b',
            feedStartDate: '2026-05-27',
            feedEndDate: '2026-08-29',
        });
    });

    it('flags observation ranges that extend beyond the bundled schedule baseline', () => {
        const provenance = parseCorridorGtfsProvenance(rawFeedInfo);
        expect(assessCorridorBaselineCoverage({
            dateRange: { start: '2026-06-01', end: '2026-07-31' },
        }, provenance)).toBe('covered');
        expect(assessCorridorBaselineCoverage({
            dateRange: { start: '2026-04-01', end: '2026-07-31' },
        }, provenance)).toBe('partial');
    });

    it('allows comparisons only on service dates covered by the schedule baseline', () => {
        const provenance = parseCorridorGtfsProvenance(rawFeedInfo);

        expect(isCorridorServiceDateCovered('2026-05-27', provenance)).toBe(true);
        expect(isCorridorServiceDateCovered('2026-08-29', provenance)).toBe(true);
        expect(isCorridorServiceDateCovered('2026-05-26', provenance)).toBe(false);
        expect(isCorridorServiceDateCovered('2026-08-30', provenance)).toBe(false);
        expect(isCorridorServiceDateCovered('not-a-date', provenance)).toBe(false);
        expect(isCorridorServiceDateCovered('2026-06-15', {
            feedVersion: null,
            feedStartDate: null,
            feedEndDate: null,
        })).toBe(false);
    });
});
