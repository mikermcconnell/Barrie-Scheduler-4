import { describe, expect, it } from 'vitest';
import { createTodRidershipProjection, parseTodRidershipProjection, summarizeTodRidershipMonth } from '../utils/ridership-trends/tod';
import type { TodPickupSummary } from '../utils/todPickupTypes';

const summary: TodPickupSummary = {
    schemaVersion: 2,
    months: [],
    dailyReports: [
        {
            date: '2026-08-02', importedAt: '', importedBy: '', sourceFileName: '', rowCount: 1,
            totalCompletedTrips: 25, totalDropoffs: 25, locations: [],
        },
        {
            date: '2026-08-03', importedAt: '', importedBy: '', sourceFileName: '', rowCount: 1,
            totalCompletedTrips: 30, totalDropoffs: 30, locations: [],
        },
        {
            date: '2026-09-01', importedAt: '', importedBy: '', sourceFileName: '', rowCount: 1,
            totalCompletedTrips: 40, totalDropoffs: 40, locations: [],
        },
    ],
    metadata: {
        importedAt: '2026-09-01T12:00:00.000Z', importedBy: 'auto-ingest', monthCount: 0,
        totalRows: 3, totalPickups: 0,
    },
};

describe('On Demand ridership projection', () => {
    it('uses completed pickups once per trip and omits location detail', () => {
        const projection = createTodRidershipProjection(summary);
        expect(projection.dailyTotals).toEqual({
            '2026-08-02': 25,
            '2026-08-03': 30,
            '2026-09-01': 40,
        });
        expect(projection).not.toHaveProperty('locations');
        expect(projection.latestServiceDate).toBe('2026-09-01');
    });

    it('summarizes only the current month through the reference date', () => {
        const result = summarizeTodRidershipMonth(createTodRidershipProjection(summary), '2026-08-25');
        expect(result).toEqual({
            total: 55,
            observedDays: 2,
            firstServiceDate: '2026-08-02',
            latestServiceDate: '2026-08-03',
        });
    });

    it('rejects invalid shared projections', () => {
        expect(() => parseTodRidershipProjection({
            schemaVersion: 1,
            metric: 'tod_completed_trips',
            dailyTotals: { '2026-08-02': -1 },
        })).toThrow('invalid daily total');
    });
});
