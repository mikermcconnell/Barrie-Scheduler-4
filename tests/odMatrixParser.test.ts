import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseODMatrixFromExcel } from '../utils/od-matrix/odMatrixParser';

function createTestWorkbook(data: (string | number | null)[][]): ArrayBuffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return out;
}

describe('odMatrixParser', () => {
    it('parses a simple 3×3 OD matrix', () => {
        const data = [
            [null,        'Station A', 'Station B', 'Station C'],
            ['Station A', 0,           10,          20],
            ['Station B', 5,           0,           15],
            ['Station C', 8,           12,          0],
        ];
        const buffer = createTestWorkbook(data);
        const result = parseODMatrixFromExcel(buffer);

        expect(result.stationCount).toBe(3);
        expect(result.totalJourneys).toBe(10 + 20 + 5 + 15 + 8 + 12);
        expect(result.pairs.length).toBe(6); // 6 non-zero cells
        expect(result.warnings).toHaveLength(0);

        // Check station totals
        const stationA = result.stations.find(s => s.name === 'Station A')!;
        expect(stationA.totalOrigin).toBe(30);      // 10 + 20
        expect(stationA.totalDestination).toBe(13);  // 5 + 8
        expect(stationA.totalVolume).toBe(43);

        const stationB = result.stations.find(s => s.name === 'Station B')!;
        expect(stationB.totalOrigin).toBe(20);       // 5 + 15
        expect(stationB.totalDestination).toBe(22);   // 10 + 12
        expect(stationB.totalVolume).toBe(42);
    });

    it('skips Grand Total rows and columns', () => {
        const data = [
            [null,          'Station A', 'Station B', 'Grand Total'],
            ['Station A',   0,           10,          10],
            ['Station B',   5,           0,           5],
            ['Grand Total', 5,           10,          15],
        ];
        const buffer = createTestWorkbook(data);
        const result = parseODMatrixFromExcel(buffer);

        expect(result.stationCount).toBe(2);
        expect(result.totalJourneys).toBe(15); // 10 + 5
        expect(result.pairs.length).toBe(2);
    });

    it('skips (blank) entries', () => {
        const data = [
            [null,        'Station A', '(blank)'],
            ['Station A', 0,           10],
            ['(blank)',   5,           0],
        ];
        const buffer = createTestWorkbook(data);
        const result = parseODMatrixFromExcel(buffer);

        expect(result.stationCount).toBe(1);
        expect(result.totalJourneys).toBe(0);
    });

    it('treats null cells as zero journeys', () => {
        const data = [
            [null,        'Station A', 'Station B'],
            ['Station A', null,        10],
            ['Station B', null,        null],
        ];
        const buffer = createTestWorkbook(data);
        const result = parseODMatrixFromExcel(buffer);

        expect(result.totalJourneys).toBe(10);
        expect(result.pairs.length).toBe(1);
    });

    it('sorts topPairs by journey count descending', () => {
        const data = [
            [null,        'A', 'B', 'C'],
            ['A',         0,   5,   50],
            ['B',         30,  0,   10],
            ['C',         1,   20,  0],
        ];
        const buffer = createTestWorkbook(data);
        const result = parseODMatrixFromExcel(buffer);

        expect(result.topPairs[0].journeys).toBe(50);
        expect(result.topPairs[0].origin).toBe('A');
        expect(result.topPairs[0].destination).toBe('C');
        expect(result.topPairs[1].journeys).toBe(30);
    });

    it('returns warning for empty workbook', () => {
        const data: (string | number | null)[][] = [
            [null],
        ];
        const buffer = createTestWorkbook(data);
        const result = parseODMatrixFromExcel(buffer);

        expect(result.stationCount).toBe(0);
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('handles asymmetric origin/destination lists (merges stations)', () => {
        // Origin has A,B but destinations have A,B,C
        const data = [
            [null,   'A', 'B', 'C'],
            ['A',    0,   10,  20],
            ['B',    5,   0,   15],
        ];
        const buffer = createTestWorkbook(data);
        const result = parseODMatrixFromExcel(buffer);

        // C appears only as destination
        expect(result.stationCount).toBe(3);
        const stationC = result.stations.find(s => s.name === 'C')!;
        expect(stationC.totalOrigin).toBe(0);
        expect(stationC.totalDestination).toBe(35); // 20 + 15
    });

    it('skips Row Labels / Column Labels headers', () => {
        const data = [
            ['Row Labels', 'Station A', 'Station B'],
            ['Station A',  0,           10],
            ['Station B',  5,           0],
        ];
        const buffer = createTestWorkbook(data);
        const result = parseODMatrixFromExcel(buffer);

        expect(result.stationCount).toBe(2);
        expect(result.totalJourneys).toBe(15);
    });

    it('caps topPairs at 100', () => {
        // Create a matrix with > 100 pairs
        const stationNames = Array.from({ length: 15 }, (_, i) => `S${i}`);
        const header: (string | number | null)[] = [null, ...stationNames];
        const rows = stationNames.map((name, ri) => {
            const row: (string | number | null)[] = [name];
            stationNames.forEach((_, ci) => {
                row.push(ri === ci ? 0 : (ri + 1) * (ci + 1));
            });
            return row;
        });

        const buffer = createTestWorkbook([header, ...rows]);
        const result = parseODMatrixFromExcel(buffer);

        // 15 stations × 14 non-self pairs = 210 pairs, topPairs capped at 100
        expect(result.topPairs.length).toBe(100);
        expect(result.pairs.length).toBe(210);
    });
});
