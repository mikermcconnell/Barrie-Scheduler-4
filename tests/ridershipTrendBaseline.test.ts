import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import XLSX from 'xlsx';
import baselineJson from '../utils/ridership-trends/ridershipTrendBaseline.v1.json';
import type { RidershipTrendBaselineV1 } from '../utils/ridership-trends/types';
import {
    extractRidershipTrendBaseline,
    serializeRidershipTrendBaseline,
} from '../scripts/generateRidershipTrendBaseline.mjs';

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

function buildFixtureWorkbook(): Buffer {
    const rows: unknown[][] = [
        [null, 'Boards'],
        [null, ...Array.from({ length: 19 }, (_, index) => 2008 + index)],
    ];
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        rows.push([
            MONTHS[monthIndex],
            ...Array.from({ length: 19 }, (_, yearIndex) => (
                yearIndex === 18 && monthIndex > 6 ? null : 100 + yearIndex + monthIndex
            )),
        ]);
    }
    rows.push([
        'Total',
        ...Array.from({ length: 19 }, (_, yearIndex) => {
            const monthCount = yearIndex === 18 ? 7 : 12;
            return Array.from({ length: monthCount }, (_, monthIndex) => 100 + yearIndex + monthIndex)
                .reduce((sum, value) => sum + value, 0);
        }),
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Ridership Trend');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function annualTotal(year: number): number {
    return Object.entries(baselineJson.monthlyTotals)
        .filter(([key]) => key.startsWith(`${year}-`))
        .reduce((sum, [, value]) => sum + value, 0);
}

describe('ridership trend workbook baseline', () => {
    it('reconciles the checked-in exact monthly history', () => {
        expect(baselineJson.metric).toBe('fixed_route_boardings');
        expect(baselineJson.source).toMatchObject({
            fileName: 'Transit Annual Ridership.xlsx',
            sheetName: 'Ridership Trend',
            finalMonth: '2026-07',
            sha256: 'f43696aab18337c5a8a4f43db447568545c30b343e3639190f9078a2538facc2',
        });
        expect(annualTotal(2024)).toBe(4_076_773);
        expect(annualTotal(2025)).toBe(3_362_338);
        expect(annualTotal(2026)).toBe(1_632_133);
        expect(Object.keys(baselineJson.monthlyTotals).at(-1)).toBe('2026-07');
        expect(Object.values(baselineJson.monthlyTotals).every(Number.isSafeInteger)).toBe(true);
    });

    it('extracts the expected range deterministically and validates annual totals', () => {
        const buffer = buildFixtureWorkbook();
        const first = extractRidershipTrendBaseline(buffer, 'fixture.xlsx') as RidershipTrendBaselineV1;
        const second = extractRidershipTrendBaseline(buffer, 'fixture.xlsx') as RidershipTrendBaselineV1;

        expect(serializeRidershipTrendBaseline(first)).toBe(serializeRidershipTrendBaseline(second));
        expect(first.monthlyTotals['2008-01']).toBe(100);
        expect(first.monthlyTotals['2026-07']).toBe(124);
        expect(first.monthlyTotals['2026-08']).toBeUndefined();
        expect(first.source).toMatchObject({
            fileName: 'fixture.xlsx',
            sheetName: 'Ridership Trend',
            extractedRange: 'A2:T15',
            finalMonth: '2026-07',
        });
    });

    it('matches a fresh extraction of the source workbook when it is available', async () => {
        const sourcePath = 'D:/Transit Annual Ridership.xlsx';
        let source: Buffer;
        try {
            source = await readFile(sourcePath);
        } catch {
            return;
        }
        const extracted = extractRidershipTrendBaseline(source, 'Transit Annual Ridership.xlsx');
        expect(extracted).toEqual(baselineJson);
    });
});
