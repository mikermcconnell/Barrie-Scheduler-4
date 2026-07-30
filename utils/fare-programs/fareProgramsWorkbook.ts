import * as XLSX from 'xlsx';

export const FARE_PROGRAMS_WORKBOOK_HEADERS = [
    'Id',
    'Route',
    'Transit Pass',
    'Starting Location',
    'Ending Location',
    'Strat Time',
    'End Time',
] as const;

export interface FareProgramTransactionRow {
    sourceRowNumber: number;
    id: string;
    route: string;
    transitPass: string;
    startingLocation: string;
    endingLocation: string;
    startTime: string;
    endTime: string;
}

export interface FareProgramTransactionResult {
    sourceRows: number;
    transactions: FareProgramTransactionRow[];
}

function displayCell(value: unknown): string {
    return String(value ?? '').trim();
}

export function extractFareProgramTransactions(
    buffer: ArrayBuffer,
    fareType: string,
): FareProgramTransactionResult {
    const workbook = XLSX.read(buffer, {
        type: 'array',
        cellDates: false,
        dense: true,
    });

    if (workbook.SheetNames.length !== 1) {
        throw new Error(`Expected one source sheet, found ${workbook.SheetNames.length}.`);
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: '',
        raw: false,
    }) as unknown[][];
    if (rows.length < 2) {
        throw new Error('The selected workbook contains no transaction rows.');
    }

    const headers = rows[0]
        .slice(0, FARE_PROGRAMS_WORKBOOK_HEADERS.length)
        .map(displayCell);
    const headersMatch = FARE_PROGRAMS_WORKBOOK_HEADERS.every(
        (expected, index) => headers[index] === expected,
    );
    if (!headersMatch) {
        throw new Error(`Unexpected workbook columns: ${headers.join(', ')}`);
    }

    const transactions: FareProgramTransactionRow[] = [];
    rows.slice(1).forEach((row, index) => {
        const transitPass = displayCell(row[2]);
        const normalizedFareType = transitPass || '(Blank fare type)';
        if (normalizedFareType !== fareType) return;

        transactions.push({
            sourceRowNumber: index + 2,
            id: displayCell(row[0]),
            route: displayCell(row[1]),
            transitPass,
            startingLocation: displayCell(row[3]),
            endingLocation: displayCell(row[4]),
            startTime: displayCell(row[5]),
            endTime: displayCell(row[6]),
        });
    });

    return {
        sourceRows: rows.length - 1,
        transactions,
    };
}
