import { describe, expect, it } from 'vitest';
import {
    buildDirectionColumnWidths,
    getMetricsStartColumn,
    getRenderedTableColumnCount,
    mergeScheduleColumnWidths,
    type ExportStopColumn,
} from '../utils/reports/masterScheduleExportLayout';

describe('master schedule export layout', () => {
    it('places metrics after the wider of the two direction tables', () => {
        const narrowerDirection: ExportStopColumn[] = [
            { name: 'Downtown', subColumns: ['DEP'], type: 'regular' },
            { name: 'Terminal', subColumns: ['ARR', 'R'], type: 'turnaround' },
        ];
        const widerDirection: ExportStopColumn[] = [
            { name: 'Stop A', subColumns: ['DEP'], type: 'regular' },
            { name: 'Stop B', subColumns: ['DEP'], type: 'regular' },
            { name: 'Stop C', subColumns: ['DEP'], type: 'regular' },
            { name: 'Terminal', subColumns: ['ARR', 'R'], type: 'turnaround' },
        ];

        const narrowCols = getRenderedTableColumnCount(narrowerDirection);
        const wideCols = getRenderedTableColumnCount(widerDirection);
        const metricsStartCol = getMetricsStartColumn(narrowCols, wideCols);

        expect(wideCols).toBeGreaterThan(narrowCols);
        expect(metricsStartCol).toBe(wideCols + 2);
        expect(metricsStartCol).toBeGreaterThan(narrowCols);
        expect(metricsStartCol).toBeGreaterThan(wideCols);
    });

    it('keeps schedule column widths wide enough for either direction without reusing metrics columns', () => {
        const northColumns: ExportStopColumn[] = [
            { name: 'Stop 1', subColumns: ['DEP'], type: 'regular' },
            { name: 'Stop 2', subColumns: ['DEP'], type: 'regular' },
            { name: 'Stop 3', subColumns: ['DEP'], type: 'regular' },
            { name: 'Terminal', subColumns: ['ARR', 'R'], type: 'turnaround' },
        ];
        const southColumns: ExportStopColumn[] = [
            { name: 'Stop 1', subColumns: ['DEP'], type: 'regular' },
            { name: 'Terminal', subColumns: ['ARR', 'R'], type: 'turnaround' },
        ];

        const northWidths = buildDirectionColumnWidths(northColumns);
        const southWidths = buildDirectionColumnWidths(southColumns);
        const mergedWidths = mergeScheduleColumnWidths(northWidths, southWidths);
        const metricsStartCol = getMetricsStartColumn(northWidths.length, southWidths.length);
        const expectedMergedWidths = northWidths.map((width, index) => Math.max(width, southWidths[index] ?? 0));

        expect(mergedWidths).toHaveLength(northWidths.length);
        expect(mergedWidths).toEqual(expectedMergedWidths);
        expect(mergedWidths[0]).toBe(10);
        expect(mergedWidths[1]).toBe(6);
        expect(mergedWidths[mergedWidths.length - 5]).toBe(7);
        expect(mergedWidths[mergedWidths.length - 4]).toBe(6);
        expect(mergedWidths[mergedWidths.length - 3]).toBe(7);
        expect(mergedWidths[mergedWidths.length - 2]).toBe(6);
        expect(mergedWidths[mergedWidths.length - 1]).toBe(7);
        expect(metricsStartCol).toBe(mergedWidths.length + 2);
        expect(metricsStartCol).toBeGreaterThan(mergedWidths.length);
    });
});
