import { describe, expect, it } from 'vitest';
import {
    RIDERSHIP_TREND_BASELINE,
    RIDERSHIP_TREND_BASELINE_HASH,
} from '../utils/ridership-trends/baseline';
import {
    backtestRidershipTrendForecast,
    buildRidershipTrendForecast,
} from '../utils/ridership-trends/forecast';
import {
    buildRidershipTrendView,
    createRidershipTrendProjection,
    mergeRidershipTrendProjection,
} from '../utils/ridership-trends/model';

describe('ridership trend forecast', () => {
    it('uses completed-month trend, preserves actual days, and estimates only unreported days', () => {
        const projection = mergeRidershipTrendProjection(
            createRidershipTrendProjection({
                baselineHash: RIDERSHIP_TREND_BASELINE_HASH,
                updatedAt: '2026-08-01T12:00:00.000Z',
            }),
            [
                { date: '2026-08-01', boardings: 100, performanceSchemaVersion: 14 },
                { date: '2026-08-03', boardings: 300, performanceSchemaVersion: 14 },
            ],
            '2026-08-03T12:00:00.000Z',
        );
        const view = buildRidershipTrendView(RIDERSHIP_TREND_BASELINE, projection, '2026-08-03');
        const forecast = buildRidershipTrendForecast(RIDERSHIP_TREND_BASELINE, view);

        expect(forecast).not.toBeNull();
        expect(forecast?.trendFactor).toBeCloseTo(1_632_133 / 2_079_256, 10);
        expect(forecast?.actualToDate).toBe(1_632_533);
        expect(forecast?.months[6]).toMatchObject({
            monthKey: '2026-07',
            actual: 230_134,
            projected: null,
            remainingEstimate: 0,
            status: 'actual',
        });

        const august = forecast?.months[7];
        const seasonalAugust = 269_090 * (1_632_133 / 2_079_256);
        expect(august).toMatchObject({
            monthKey: '2026-08',
            actual: 400,
            status: 'actual-plus-forecast',
        });
        expect(august?.remainingEstimate).toBe(Math.round(seasonalAugust * (29 / 31)));
        expect(august?.projected).toBe(400 + Math.round(seasonalAugust * (29 / 31)));
        expect(forecast?.projectedAnnualTotal).toBe(
            (forecast?.actualToDate ?? 0) + (forecast?.remainingEstimate ?? 0),
        );
        expect(forecast?.backtestSampleSize).toBe(17);
        expect(forecast?.lowEstimate).toBeLessThan(forecast?.projectedAnnualTotal ?? 0);
        expect(forecast?.highEstimate).toBeGreaterThan(forecast?.projectedAnnualTotal ?? 0);
    });

    it('derives the uncertainty range from historical backtests', () => {
        const backtest = backtestRidershipTrendForecast(RIDERSHIP_TREND_BASELINE, 7);

        expect(backtest.sampleSize).toBe(17);
        expect(backtest.medianAbsoluteError).toBeCloseTo(0.0338681806, 8);
    });

    it('withholds a forecast when completed-month evidence is incomplete', () => {
        const view = buildRidershipTrendView(
            RIDERSHIP_TREND_BASELINE,
            createRidershipTrendProjection({
                baselineHash: RIDERSHIP_TREND_BASELINE_HASH,
                updatedAt: '2027-08-01T12:00:00.000Z',
            }),
            '2027-08-03',
        );

        expect(buildRidershipTrendForecast(RIDERSHIP_TREND_BASELINE, view)).toBeNull();
    });
});
