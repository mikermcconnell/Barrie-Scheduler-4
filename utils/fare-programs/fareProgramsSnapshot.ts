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

export interface FareProgramsSnapshot {
    sourceFileName: string;
    sourceRows: number;
    sourceSizeBytes: number | null;
    sourceSha256: string | null;
    coverageStart: string;
    coverageEnd: string;
    coverageLabel: string;
    allSourceMonthlyUses: FareProgramMonthlyUse[];
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
    };
    fieldTripPass: {
        uses: number;
        source: string;
        mappingStatus: string;
    };
}

export const FARE_PROGRAMS_SNAPSHOT = generatedSnapshot as FareProgramsSnapshot;

export function getSchoolLinkedUses(snapshot = FARE_PROGRAMS_SNAPSHOT): number {
    return snapshot.serviceMirroring.schoolAreas.reduce((sum, school) => sum + school.uses, 0);
}

export function getMonthlyServiceMirroringUses(snapshot = FARE_PROGRAMS_SNAPSHOT): number {
    return snapshot.serviceMirroring.monthlyUses.reduce((sum, month) => sum + month.uses, 0);
}

