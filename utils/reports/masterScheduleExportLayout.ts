export type ExportStopColumn = {
    name: string;
    subColumns: string[];
    type: 'regular' | 'turnaround';
};

const BLOCK_COLUMN_WIDTH = 10;
const BAND_COLUMN_WIDTH = 6;
const STOP_COLUMN_WIDTH = 11;
const RECOVERY_COLUMN_WIDTH = 5;
const METRIC_COLUMN_WIDTHS = [7, 6, 7, 6, 7] as const;

export const buildDirectionColumnWidths = (stopColumns: ExportStopColumn[]): number[] => {
    const widths = [BLOCK_COLUMN_WIDTH, BAND_COLUMN_WIDTH];

    stopColumns.forEach(col => {
        if (col.type === 'turnaround') {
            widths.push(STOP_COLUMN_WIDTH, RECOVERY_COLUMN_WIDTH);
        } else {
            widths.push(STOP_COLUMN_WIDTH);
        }
    });

    widths.push(...METRIC_COLUMN_WIDTHS);
    return widths;
};

export const getRenderedTableColumnCount = (stopColumns: ExportStopColumn[]): number => {
    return buildDirectionColumnWidths(stopColumns).length;
};

export const mergeScheduleColumnWidths = (...directionWidths: number[][]): number[] => {
    const maxColumns = Math.max(0, ...directionWidths.map(widths => widths.length));
    const merged: number[] = [];

    for (let index = 0; index < maxColumns; index += 1) {
        merged.push(Math.max(0, ...directionWidths.map(widths => widths[index] ?? 0)));
    }

    return merged;
};

export const getMetricsStartColumn = (...tableColumnCounts: number[]): number => {
    const widestTable = Math.max(0, ...tableColumnCounts);
    return widestTable + 2;
};
