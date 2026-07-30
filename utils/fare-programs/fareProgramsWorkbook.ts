import * as XLSX from 'xlsx';

export const FARE_PROGRAMS_MAX_SOURCE_WORKBOOK_BYTES = 100 * 1024 * 1024;

export const FARE_PROGRAMS_WORKBOOK_HEADERS = [
    'Id',
    'Route',
    'Transit Pass',
    'Starting Location',
    'Ending Location',
    'Strat Time',
    'End Time',
] as const;

export function validateFareProgramsWorkbookFile(file: File): string | null {
    if (!/\.xlsx$/i.test(file.name)) {
        return 'Choose an Excel .xlsx workbook.';
    }
    if (file.size > FARE_PROGRAMS_MAX_SOURCE_WORKBOOK_BYTES) {
        return 'The workbook is larger than the 100 MB limit.';
    }
    return null;
}

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

export type FareProgramExactDayType = 'weekday' | 'weekend';
export type FareProgramExactTimeBandId =
    | 'before-6'
    | 'morning'
    | 'school-day'
    | 'daytime'
    | 'afternoon'
    | 'after-school'
    | 'evening';

export const FARE_PROGRAM_EXACT_TIME_BANDS: Array<{
    id: FareProgramExactTimeBandId;
    label: string;
    startHour: number;
    endHour: number;
}> = [
    { id: 'before-6', label: 'Before 6 AM', startHour: 0, endHour: 6 },
    { id: 'morning', label: '6–9 AM', startHour: 6, endHour: 9 },
    { id: 'school-day', label: '9 AM–2 PM', startHour: 9, endHour: 14 },
    { id: 'daytime', label: '9 AM–4 PM', startHour: 9, endHour: 16 },
    { id: 'afternoon', label: '2–7 PM', startHour: 14, endHour: 19 },
    { id: 'after-school', label: '4–7 PM', startHour: 16, endHour: 19 },
    { id: 'evening', label: 'After 7 PM', startHour: 19, endHour: 24 },
];

export interface FareProgramExactOrigin {
    id: string;
    label: string;
    geocodeQuery: string;
    uses: number;
    dayUses: Record<FareProgramExactDayType, number>;
    buckets: Record<FareProgramExactDayType, Record<FareProgramExactTimeBandId, number>>;
}

export interface FareProgramExactOriginResult {
    sourceRows: number;
    matchedUses: number;
    usableStartUses: number;
    missingStartUses: number;
    origins: FareProgramExactOrigin[];
}

const UNAVAILABLE_LOCATION = /no data available|geolocation unauthorized/i;
const TORONTO_DATE_TIME = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
});

function displayCell(value: unknown): string {
    return String(value ?? '').trim();
}

function validateWorkbookRows(rows: unknown[][]): void {
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
}

function readWorkbookRows(buffer: ArrayBuffer, raw: boolean): unknown[][] {
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
        raw,
    }) as unknown[][];
    validateWorkbookRows(rows);
    return rows;
}

function parseUtcDate(value: unknown): Date | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (!parsed) return null;
        return new Date(Date.UTC(
            parsed.y,
            parsed.m - 1,
            parsed.d,
            parsed.H ?? 0,
            parsed.M ?? 0,
            parsed.S ?? 0,
        ));
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getTime());
    }

    const text = displayCell(value);
    const utcLike = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2}))?)?/);
    if (utcLike) {
        return new Date(Date.UTC(
            Number(utcLike[1]),
            Number(utcLike[2]) - 1,
            Number(utcLike[3]),
            Number(utcLike[4] ?? 0),
            Number(utcLike[5] ?? 0),
            Number(utcLike[6] ?? 0),
        ));
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localDayAndHour(value: unknown): {
    dayType: FareProgramExactDayType;
    hour: number;
} | null {
    const parsed = parseUtcDate(value);
    if (!parsed) return null;
    const parts = Object.fromEntries(
        TORONTO_DATE_TIME.formatToParts(parsed).map((part) => [part.type, part.value]),
    );
    const hour = Number(parts.hour);
    if (!Number.isFinite(hour)) return null;
    return {
        dayType: /Sat|Sun/.test(parts.weekday) ? 'weekend' : 'weekday',
        hour,
    };
}

function emptyExactBuckets(): FareProgramExactOrigin['buckets'] {
    const emptyBandCounts = () => Object.fromEntries(
        FARE_PROGRAM_EXACT_TIME_BANDS.map((band) => [band.id, 0]),
    ) as Record<FareProgramExactTimeBandId, number>;
    return {
        weekday: emptyBandCounts(),
        weekend: emptyBandCounts(),
    };
}

export function extractFareProgramTransactions(
    buffer: ArrayBuffer,
    fareType: string,
): FareProgramTransactionResult {
    const rows = readWorkbookRows(buffer, false);

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

export function extractFareProgramExactOrigins(
    buffer: ArrayBuffer,
    fareType: string,
): FareProgramExactOriginResult {
    const rows = readWorkbookRows(buffer, true);
    const groups = new Map<string, FareProgramExactOrigin>();
    let matchedUses = 0;
    let usableStartUses = 0;

    rows.slice(1).forEach((row) => {
        const localTime = localDayAndHour(row[5]);
        if (displayCell(row[2]) !== fareType) return;
        matchedUses += 1;

        const startingLocation = displayCell(row[3]).replace(/\s+/g, ' ');
        if (!startingLocation || UNAVAILABLE_LOCATION.test(startingLocation)) return;
        usableStartUses += 1;

        const key = startingLocation.toLocaleLowerCase('en-CA');
        const current = groups.get(key) ?? {
            id: '',
            label: startingLocation,
            geocodeQuery: startingLocation,
            uses: 0,
            dayUses: { weekday: 0, weekend: 0 },
            buckets: emptyExactBuckets(),
        };
        current.uses += 1;

        if (localTime) {
            current.dayUses[localTime.dayType] += 1;
            FARE_PROGRAM_EXACT_TIME_BANDS.forEach((band) => {
                if (localTime.hour >= band.startHour && localTime.hour < band.endHour) {
                    current.buckets[localTime.dayType][band.id] += 1;
                }
            });
        }
        groups.set(key, current);
    });

    const origins = [...groups.values()]
        .sort((left, right) => right.uses - left.uses || left.label.localeCompare(right.label))
        .map((origin, index) => ({
            ...origin,
            id: `exact-origin-${String(index + 1).padStart(4, '0')}`,
        }));

    return {
        sourceRows: rows.length - 1,
        matchedUses,
        usableStartUses,
        missingStartUses: matchedUses - usableStartUses,
        origins,
    };
}

export function getFareProgramExactOriginUses(
    origin: FareProgramExactOrigin,
    dayType: FareProgramExactDayType | 'all' = 'all',
    timeBand: FareProgramExactTimeBandId | 'all' = 'all',
): number {
    if (dayType === 'all' && timeBand === 'all') return origin.uses;
    const dayTypes: FareProgramExactDayType[] = dayType === 'all'
        ? ['weekday', 'weekend']
        : [dayType];
    if (timeBand === 'all') {
        return dayTypes.reduce((sum, selectedDayType) => sum + origin.dayUses[selectedDayType], 0);
    }
    return dayTypes.reduce(
        (sum, selectedDayType) => sum + origin.buckets[selectedDayType][timeBand],
        0,
    );
}
