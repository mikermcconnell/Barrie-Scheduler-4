import { describe, expect, it } from 'vitest';
import {
    RIDERSHIP_TREND_BASELINE,
    RIDERSHIP_TREND_BASELINE_HASH,
} from '../utils/ridership-trends/baseline';
import {
    buildRidershipTrendView,
    createRidershipTrendProjection,
    mergeRidershipTrendProjection,
    parseRidershipTrendProjection,
} from '../utils/ridership-trends/model';

const CREATED_AT = '2026-08-01T12:00:00.000Z';

describe('ridership trend projection', () => {
    it('preserves prior dates, replaces corrections, ignores pre-cutover data, and sorts dates', () => {
        const empty = createRidershipTrendProjection({
            baselineHash: RIDERSHIP_TREND_BASELINE_HASH,
            updatedAt: CREATED_AT,
        });
        const first = mergeRidershipTrendProjection(empty, [
            { date: '2026-08-03', boardings: 300, performanceSchemaVersion: 14 },
            { date: '2026-07-31', boardings: 999, performanceSchemaVersion: 14 },
            { date: '2026-08-01', boardings: 100, performanceSchemaVersion: 14 },
        ], '2026-08-04T12:00:00.000Z');
        const corrected = mergeRidershipTrendProjection(first, [
            { date: '2026-08-01', boardings: 125, performanceSchemaVersion: 15 },
        ], '2026-08-05T12:00:00.000Z');

        expect(Object.keys(corrected.dailyTotals)).toEqual(['2026-08-01', '2026-08-03']);
        expect(corrected.dailyTotals['2026-08-01']).toEqual({
            boardings: 125,
            performanceSchemaVersion: 15,
        });
        expect(corrected.dailyTotals['2026-08-03']?.boardings).toBe(300);
        expect(corrected.latestServiceDate).toBe('2026-08-03');
    });

    it('rejects invalid data instead of converting missing evidence to zero', () => {
        const empty = createRidershipTrendProjection({
            baselineHash: RIDERSHIP_TREND_BASELINE_HASH,
            updatedAt: CREATED_AT,
        });
        expect(() => mergeRidershipTrendProjection(empty, [
            { date: '2026-08-02', boardings: 1.5, performanceSchemaVersion: 14 },
        ], CREATED_AT)).toThrow('non-negative whole number');
        expect(() => mergeRidershipTrendProjection(empty, [
            { date: '2026-02-30', boardings: 10, performanceSchemaVersion: 14 },
        ], CREATED_AT)).toThrow('valid YYYY-MM-DD');
    });

    it('strictly validates persisted projections before use', () => {
        const valid = mergeRidershipTrendProjection(
            createRidershipTrendProjection({
                baselineHash: RIDERSHIP_TREND_BASELINE_HASH,
                updatedAt: CREATED_AT,
            }),
            [{ date: '2026-08-02', boardings: 10, performanceSchemaVersion: 14 }],
            CREATED_AT,
        );
        expect(parseRidershipTrendProjection(valid)).toEqual(valid);
        expect(() => parseRidershipTrendProjection({
            ...valid,
            cutoverDate: '2026-07-01',
        })).toThrow('unsupported or invalid schema');
        expect(() => parseRidershipTrendProjection({
            ...valid,
            latestServiceDate: '2026-08-01',
        })).toThrow('invalid latest service date');
        expect(() => parseRidershipTrendProjection({
            ...valid,
            dailyTotals: {
                '2026-08-02': { boardings: 10.5, performanceSchemaVersion: 14 },
            },
        })).toThrow('invalid daily totals');
        expect(() => parseRidershipTrendProjection({
            ...valid,
            updatedAt: 'August 2, 2026',
        })).toThrow('unsupported or invalid schema');
    });
});

describe('ridership trend calculations', () => {
    it('uses exact totals, correct YoY, completed-month YTD, and a separate partial month', () => {
        const projection = mergeRidershipTrendProjection(
            createRidershipTrendProjection({
                baselineHash: RIDERSHIP_TREND_BASELINE_HASH,
                updatedAt: CREATED_AT,
            }),
            [
                { date: '2026-08-01', boardings: 100, performanceSchemaVersion: 14 },
                { date: '2026-08-03', boardings: 300, performanceSchemaVersion: 14 },
            ],
            '2026-08-03T12:00:00.000Z',
        );
        const view = buildRidershipTrendView(RIDERSHIP_TREND_BASELINE, projection, '2026-08-03');

        expect(view.annualSeries.at(-1)).toMatchObject({ year: 2025, total: 3_362_338 });
        expect(view.annualChanges.at(-1)).toMatchObject({
            year: 2025,
            previousYear: 2024,
            change: (3_362_338 - 4_076_773) / 4_076_773,
        });
        expect(view.annualSeries.some(year => year.year === 2026)).toBe(false);
        expect(view.currentYtd).toEqual({ total: 1_632_533, coverageComplete: false });
        expect(view.completedMonthComparison).toEqual({
            throughMonth: 7,
            currentTotal: 1_632_133,
            previousTotal: 2_079_256,
            change: (1_632_133 - 2_079_256) / 2_079_256,
            coverageComplete: true,
        });
        expect(view.activePartialMonth).toMatchObject({
            monthKey: '2026-08',
            total: 400,
            observedDays: 2,
            expectedDays: 3,
            coverageStatus: 'partial',
            missingDates: ['2026-08-02'],
        });
        expect(view.liveCoverage).toEqual({
            observedDays: 2,
            expectedDays: 3,
            missingDates: ['2026-08-02'],
            complete: false,
        });
    });

    it('keeps absent live months null and suppresses YoY when coverage is incomplete', () => {
        const projection = mergeRidershipTrendProjection(
            createRidershipTrendProjection({
                baselineHash: RIDERSHIP_TREND_BASELINE_HASH,
                updatedAt: CREATED_AT,
            }),
            [{ date: '2027-01-02', boardings: 200, performanceSchemaVersion: 14 }],
            '2027-01-02T12:00:00.000Z',
        );
        const view = buildRidershipTrendView(RIDERSHIP_TREND_BASELINE, projection, '2028-01-02');

        expect(view.monthly.find(month => month.monthKey === '2026-08')?.total).toBeNull();
        expect(view.years.find(year => year.year === 2027)).toMatchObject({
            total: 200,
            coverageStatus: 'partial',
        });
        expect(view.annualChanges.find(change => change.year === 2027)).toMatchObject({
            change: null,
            suppressedReason: 'incomplete_coverage',
        });
    });

    it('fails closed when a projection references a different baseline', () => {
        const projection = createRidershipTrendProjection({
            baselineHash: RIDERSHIP_TREND_BASELINE_HASH,
            updatedAt: CREATED_AT,
        });
        expect(() => buildRidershipTrendView(
            RIDERSHIP_TREND_BASELINE,
            { ...projection, baselineHash: 'different-baseline' },
            '2026-08-01',
        )).toThrow('does not match');
    });
});
