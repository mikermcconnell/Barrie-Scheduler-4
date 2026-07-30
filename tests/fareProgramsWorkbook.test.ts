import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
    extractFareProgramTransactions,
    FARE_PROGRAMS_WORKBOOK_HEADERS,
} from '../utils/fare-programs/fareProgramsWorkbook';

function workbookBuffer(rows: unknown[][]): ArrayBuffer {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Transactions');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
}

describe('Fare Programs workbook transaction extraction', () => {
    it('returns every row for the selected fare type with its source row number', () => {
        const result = extractFareProgramTransactions(workbookBuffer([
            [...FARE_PROGRAMS_WORKBOOK_HEADERS],
            [1, 'Barrie Transit', 'Adult Monthly Pass', 'Start A', 'End A', '2026-01-01 08:00', '2026-01-01 08:30'],
            [2, 'Barrie Transit', 'Student Monthly Pass', 'Start B', 'End B', '2026-01-01 09:00', '2026-01-01 09:30'],
            [3, 'Barrie Transit', 'Adult Monthly Pass', 'Start C', '', '2026-01-01 10:00', ''],
        ]), 'Adult Monthly Pass');

        expect(result.sourceRows).toBe(3);
        expect(result.transactions).toEqual([
            expect.objectContaining({
                sourceRowNumber: 2,
                id: '1',
                transitPass: 'Adult Monthly Pass',
                startingLocation: 'Start A',
            }),
            expect.objectContaining({
                sourceRowNumber: 4,
                id: '3',
                transitPass: 'Adult Monthly Pass',
                startingLocation: 'Start C',
            }),
        ]);
    });

    it('rejects a workbook with different logical columns', () => {
        expect(() => extractFareProgramTransactions(workbookBuffer([
            ['Wrong', ...FARE_PROGRAMS_WORKBOOK_HEADERS.slice(1)],
            [1, 'Barrie Transit', 'Adult Monthly Pass', '', '', '', ''],
        ]), 'Adult Monthly Pass')).toThrow(/Unexpected workbook columns/);
    });
});
