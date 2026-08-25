export type TodZoneKind = 'permanent' | 'temporary';

export interface TodZoneDefinition {
    code: string;
    label: string;
    color: string;
    kind: TodZoneKind;
    active: boolean;
}

export interface TodZonePolygon {
    id: string;
    zoneCode: string;
    pocketName: string;
    coordinates: [number, number][];
}

export type TodStopOverrideAction = 'include' | 'exclude' | 'replace';

export interface TodStopOverride {
    stopId: string;
    action: TodStopOverrideAction;
    zoneCodes: string[];
    reason: string;
}

export interface TodZoneDraft {
    schemaVersion: 1;
    revision: number;
    definitions: TodZoneDefinition[];
    polygons: TodZonePolygon[];
    overrides: TodStopOverride[];
    effectiveFrom: string;
    source: string;
    reviewNote: string;
    lastPublishedVersionId?: string;
    updatedAt?: string;
    updatedBy?: string;
}

export interface TodZoneStopSnapshot {
    stopId: string;
    name: string;
    lat: number;
    lon: number;
    zoneCodes: string[];
}

export interface TodZoneVersion extends Omit<TodZoneDraft, 'revision' | 'lastPublishedVersionId' | 'updatedAt' | 'updatedBy'> {
    id: string;
    revision: number;
    stopSnapshot: TodZoneStopSnapshot[];
    publishedAt?: string;
    publishedBy: string;
}

export interface TodCityStop {
    id: string;
    name: string;
    lat: number;
    lon: number;
    status: string;
}

export interface TodZoneMembership {
    zoneCodes: string[];
    source: 'polygon' | 'override' | 'unassigned';
}

export type TodZoneFilter = 'all' | 'multi-zone' | 'unassigned' | string;
