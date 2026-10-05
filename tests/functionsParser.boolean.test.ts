import { describe, expect, it } from 'vitest';
import { parseSTREETSCSV } from '../functions/src/parser';
import { STREETS_REQUIRED_COLUMNS } from '../functions/src/types';

describe('functions parser boolean coercion', () => {
    it('parses Y/N values for timepoint flags', () => {
        const headers = [...STREETS_REQUIRED_COLUMNS];
        const row = headers.map((h) => {
            if (h === 'Date') return '2026-02-20';
            if (h === 'Day') return 'FRIDAY';
            if (h === 'TimePoint') return 'Y';
            if (h === 'InBetween') return 'N';
            if (h === 'Direction') return 'N';
            if (h === 'ArrivalTime') return '08:00';
            if (h === 'StopTime') return '08:00';
            return '1';
        });
        const csv = `${headers.join(',')}\n${row.join(',')}`;
        const parsed = parseSTREETSCSV(csv);

        expect(parsed.warnings).toEqual([]);
        expect(parsed.records).toHaveLength(1);
        expect(parsed.records[0].timePoint).toBe(true);
        expect(parsed.records[0].inBetween).toBe(false);
    });

    it.each([
        ['1/2/2026', '2026-01-02'],
        ['46023', '2026-01-01'],
        ['2026/01/03', '2026-01-03'],
    ])('normalizes service date %s to %s', (rawDate, expectedDate) => {
        const headers = [...STREETS_REQUIRED_COLUMNS];
        const row = headers.map((header) => {
            if (header === 'Date') return rawDate;
            if (header === 'Day') return 'FRIDAY';
            if (header === 'ArrivalTime' || header === 'StopTime' || header === 'TerminalDepartureTime') return '08:00';
            return '1';
        });

        const parsed = parseSTREETSCSV(`${headers.join(',')}\n${row.join(',')}`);
        expect(parsed.records[0].date).toBe(expectedDate);
    });
});
