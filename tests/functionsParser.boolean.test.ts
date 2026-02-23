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
});
