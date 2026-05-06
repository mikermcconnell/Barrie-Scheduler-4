import type { ResidentialGrowthMonthlyDataset, ResidentialGrowthRecord } from './types';

export type ResidentialGrowthDateRangePreset =
    | 'latest-month'
    | 'selected-month'
    | 'past-3-months'
    | 'past-12-months';

export interface ResidentialGrowthRangeResult {
    issued: ResidentialGrowthRecord[];
    occupied: ResidentialGrowthRecord[];
    fromDate?: string;
    toDate?: string;
    datasetCount: number;
    periodCount: number;
    periods: string[];
}

export const RESIDENTIAL_GROWTH_DATE_RANGE_OPTIONS: Array<{ value: ResidentialGrowthDateRangePreset; label: string }> = [
    { value: 'latest-month', label: 'Latest month' },
    { value: 'selected-month', label: '1 month' },
    { value: 'past-3-months', label: '3 months' },
    { value: 'past-12-months', label: '12 months' },
];

export interface ResidentialGrowthMonthOption {
    value: string;
    label: string;
}

function parseIsoDate(value: string): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatIsoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function isPeriod(value: string | undefined): value is string {
    return !!value && /^\d{4}-\d{2}$/.test(value);
}

const MONTH_LOOKUP: Record<string, string> = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12',
};

export function periodFromText(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const isoMatch = value.match(/(?:^|[^0-9])(20\d{2})[-_/ ](0[1-9]|1[0-2])(?:$|[^0-9])/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
    const monthNameMatch = value.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[\s_-]*(20\d{2})/i);
    if (monthNameMatch) {
        const month = MONTH_LOOKUP[monthNameMatch[1].toLowerCase()];
        if (month) return `${monthNameMatch[2]}-${month}`;
    }
    const yearMonthNameMatch = value.match(/\b(20\d{2})[\s_-]*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i);
    if (yearMonthNameMatch) {
        const month = MONTH_LOOKUP[yearMonthNameMatch[2].toLowerCase()];
        if (month) return `${yearMonthNameMatch[1]}-${month}`;
    }
    return undefined;
}

function monthStart(period: string): string {
    return `${period}-01`;
}

function monthEnd(period: string): string {
    const [year, month] = period.split('-').map(Number);
    return formatIsoDate(new Date(Date.UTC(year, month, 0, 12)));
}

function formatMonthLabel(period: string): string {
    const date = new Date(`${period}-01T12:00:00`);
    return Number.isNaN(date.getTime())
        ? period
        : date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function recordKey(record: ResidentialGrowthRecord): string {
    return [
        record.layer,
        record.fileNumber.trim().toLowerCase(),
        record.address.trim().toLowerCase(),
        record.date,
        record.units,
    ].join('|');
}

function dedupeRecords(records: ResidentialGrowthRecord[]): ResidentialGrowthRecord[] {
    const byKey = new Map<string, ResidentialGrowthRecord>();
    records.forEach((record) => {
        byKey.set(recordKey(record), record);
    });
    return Array.from(byKey.values()).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.address.localeCompare(b.address));
}

function latestRecordDate(datasets: ResidentialGrowthMonthlyDataset[]): string | undefined {
    const dates = datasets
        .flatMap((dataset) => [...dataset.issued, ...dataset.occupied])
        .map((record) => record.date)
        .filter((date) => !!parseIsoDate(date))
        .sort();
    return dates.at(-1);
}

function datasetHasRecords(dataset: ResidentialGrowthMonthlyDataset): boolean {
    return dataset.issued.length > 0 || dataset.occupied.length > 0;
}

function datasetLatestImportTime(dataset: ResidentialGrowthMonthlyDataset): number {
    return Math.max(
        ...[
            dataset.metadata.issuedImportedAt,
            dataset.metadata.occupiedImportedAt,
            dataset.metadata.importedAt,
        ].map((value) => {
            const time = value ? new Date(value).getTime() : NaN;
            return Number.isNaN(time) ? 0 : time;
        }),
    );
}

function datasetPeriod(dataset: ResidentialGrowthMonthlyDataset): string | undefined {
    const filePeriod = periodFromText(dataset.metadata.issuedFileName) ?? periodFromText(dataset.metadata.occupiedFileName);
    if (filePeriod) return filePeriod;
    if (isPeriod(dataset.period)) return dataset.period;
    const latestDate = latestRecordDate([dataset]);
    if (latestDate) return latestDate.slice(0, 7);
    const importedMonth = dataset.metadata.importedAt?.slice(0, 7);
    return isPeriod(importedMonth) ? importedMonth : undefined;
}

function recordPeriod(record: ResidentialGrowthRecord): string | undefined {
    return parseIsoDate(record.date) ? record.date.slice(0, 7) : undefined;
}

function datasetPeriods(dataset: ResidentialGrowthMonthlyDataset): string[] {
    const recordPeriods = Array.from(new Set([...dataset.issued, ...dataset.occupied].map(recordPeriod).filter(isPeriod))).sort().reverse();
    const fallback = datasetPeriod(dataset);
    if (fallback && recordPeriods.length <= 1) return [fallback];
    if (recordPeriods.length > 0) return recordPeriods;
    return fallback ? [fallback] : [];
}

function periodsFromDatasets(datasets: ResidentialGrowthMonthlyDataset[]): string[] {
    return Array.from(new Set(datasets.flatMap(datasetPeriods))).sort().reverse();
}

function latestUploadedDataset(datasets: ResidentialGrowthMonthlyDataset[]): ResidentialGrowthMonthlyDataset | undefined {
    return [...datasets]
        .filter(datasetHasRecords)
        .sort((a, b) => datasetLatestImportTime(b) - datasetLatestImportTime(a))[0];
}

function latestUploadedPeriod(datasets: ResidentialGrowthMonthlyDataset[]): string | undefined {
    const latestDataset = latestUploadedDataset(datasets);
    if (!latestDataset) return undefined;
    return datasetPeriods(latestDataset)[0];
}

function selectedPeriodsForPreset(
    datasets: ResidentialGrowthMonthlyDataset[],
    preset: ResidentialGrowthDateRangePreset,
    selectedMonth?: string,
): string[] {
    const periods = periodsFromDatasets(datasets);
    switch (preset) {
        case 'latest-month': {
            const period = latestUploadedPeriod(datasets) ?? periods[0];
            return period ? [period] : [];
        }
        case 'selected-month':
            return isPeriod(selectedMonth) ? [selectedMonth] : periods.slice(0, 1);
        case 'past-3-months':
            return periods.slice(0, 3);
        case 'past-12-months':
            return periods.slice(0, 12);
    }
}

export function getResidentialGrowthMonthOptions(datasets: ResidentialGrowthMonthlyDataset[]): ResidentialGrowthMonthOption[] {
    return periodsFromDatasets(datasets.filter(datasetHasRecords)).map((period) => ({
        value: period,
        label: formatMonthLabel(period),
    }));
}

export function buildResidentialGrowthRange(
    datasets: ResidentialGrowthMonthlyDataset[],
    preset: ResidentialGrowthDateRangePreset,
    selectedMonth?: string,
): ResidentialGrowthRangeResult {
    const datasetsWithRecords = datasets.filter(datasetHasRecords);
    const periodSet = new Set(selectedPeriodsForPreset(datasetsWithRecords, preset, selectedMonth));
    const sourceDatasets = preset === 'latest-month'
        ? [latestUploadedDataset(datasetsWithRecords)].filter((dataset): dataset is ResidentialGrowthMonthlyDataset => !!dataset)
        : datasetsWithRecords;
    const recordIsSelected = (dataset: ResidentialGrowthMonthlyDataset, record: ResidentialGrowthRecord): boolean => {
        const availablePeriods = datasetPeriods(dataset);
        const period = availablePeriods.length <= 1 ? datasetPeriod(dataset) : recordPeriod(record) ?? datasetPeriod(dataset);
        return period ? periodSet.has(period) : false;
    };
    const issued = dedupeRecords(sourceDatasets.flatMap((dataset) => dataset.issued.filter((record) => recordIsSelected(dataset, record))));
    const occupied = dedupeRecords(sourceDatasets.flatMap((dataset) => dataset.occupied.filter((record) => recordIsSelected(dataset, record))));
    const periods = Array.from(new Set([...issued, ...occupied].map(recordPeriod).filter(isPeriod))).sort().reverse();
    const datasetCount = sourceDatasets.filter((dataset) => (
        dataset.issued.some((record) => recordIsSelected(dataset, record))
        || dataset.occupied.some((record) => recordIsSelected(dataset, record))
    )).length;
    const sortedPeriods = [...periods].sort();

    return {
        issued,
        occupied,
        fromDate: sortedPeriods[0] ? monthStart(sortedPeriods[0]) : undefined,
        toDate: sortedPeriods.at(-1) ? monthEnd(sortedPeriods.at(-1)!) : undefined,
        datasetCount,
        periodCount: periods.length,
        periods: sortedPeriods,
    };
}
