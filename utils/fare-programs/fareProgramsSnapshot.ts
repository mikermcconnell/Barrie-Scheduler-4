import generatedSnapshot from './fareProgramsSnapshot.generated.json';

export interface FareProgramMonthlyUse {
    month: string;
    label: string;
    uses: number;
}

export interface FareProgramSchoolArea {
    id: 'maple-ridge' | 'innisdale' | 'barrie-north';
    name: string;
    latitude: number;
    longitude: number;
    uses: number;
    evidence: string;
}

export type FareProgramDayType = 'weekday' | 'weekend';
export type FareProgramTimeBandId = 'before-6' | 'morning' | 'school-day' | 'afternoon' | 'evening';

export interface FareProgramOriginArea {
    id: string;
    label: string;
    geocodeQuery: string;
    uses: number;
    buckets: Record<FareProgramDayType, Record<FareProgramTimeBandId, number>>;
}

export interface FareProgramsSnapshot {
    sourceFileName: string;
    sourceRows: number;
    sourceSizeBytes: number | null;
    sourceSha256: string | null;
    coverageStart: string;
    coverageEnd: string;
    coverageLabel: string;
    allSourceMonthlyUses: FareProgramMonthlyUse[];
    sourcePassCounts: Array<{ label: string; uses: number }>;
    serviceMirroring: {
        definition: string;
        uses: number;
        passTypes: Array<{ label: string; uses: number }>;
        excludedReviewPasses: Array<{ label: string; uses: number; reason: string }>;
        monthlyUses: FareProgramMonthlyUse[];
        schoolAreas: FareProgramSchoolArea[];
        ambiguousSchoolUses: number;
        unattributedUses: number;
        authorizedStartLocations: number;
        recordedEndLocations: number;
        usableEndLocations: number;
        originUsage: {
            sourceField: 'Starting Location';
            minimumGroupUses: number;
            locationMethod: string;
            timezone: string;
            timestampAssumption: string;
            timeBands: Array<{ id: FareProgramTimeBandId; label: string }>;
            usableStartUses: number;
            displayedUses: number;
            suppressedUses: number;
            origins: FareProgramOriginArea[];
        };
    };
}

export const FARE_PROGRAMS_SNAPSHOT = generatedSnapshot as FareProgramsSnapshot;

export function getSchoolLinkedUses(snapshot = FARE_PROGRAMS_SNAPSHOT): number {
    return snapshot.serviceMirroring.schoolAreas.reduce((sum, school) => sum + school.uses, 0);
}

export function getMonthlyServiceMirroringUses(snapshot = FARE_PROGRAMS_SNAPSHOT): number {
    return snapshot.serviceMirroring.monthlyUses.reduce((sum, month) => sum + month.uses, 0);
}

export function getSourcePassUses(snapshot = FARE_PROGRAMS_SNAPSHOT): number {
    return snapshot.sourcePassCounts.reduce((sum, pass) => sum + pass.uses, 0);
}

export function getFareProgramOriginUses(
    origin: FareProgramOriginArea,
    dayType: FareProgramDayType | 'all' = 'all',
    timeBand: FareProgramTimeBandId | 'all' = 'all',
): number {
    const dayTypes: FareProgramDayType[] = dayType === 'all' ? ['weekday', 'weekend'] : [dayType];
    const timeBands: FareProgramTimeBandId[] = timeBand === 'all'
        ? ['before-6', 'morning', 'school-day', 'afternoon', 'evening']
        : [timeBand];

    return dayTypes.reduce(
        (sum, selectedDayType) => sum + timeBands.reduce(
            (daySum, selectedTimeBand) => daySum + origin.buckets[selectedDayType][selectedTimeBand],
            0,
        ),
        0,
    );
}

