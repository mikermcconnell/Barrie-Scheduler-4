export type ResidentialGrowthLayer = 'issued' | 'occupied';

export interface ResidentialGrowthGeocode {
    lat: number;
    lon: number;
    displayName: string;
    source: 'mapbox' | 'manual' | 'imported';
    confidence: 'high' | 'medium' | 'low';
}

export interface ResidentialGrowthRecord {
    id: string;
    layer: ResidentialGrowthLayer;
    fileNumber: string;
    address: string;
    date: string;
    units: number;
    category: string;
    subtype?: string;
    workProposed?: string;
    description?: string;
    status?: string;
    floorAreaSqft?: number;
    estimatedValue?: number;
    geocode?: ResidentialGrowthGeocode | null;
    warnings: string[];
}

export interface ResidentialGrowthMonthlyDataset {
    schemaVersion: 1;
    period: string;
    issued: ResidentialGrowthRecord[];
    occupied: ResidentialGrowthRecord[];
    metadata: {
        importedAt: string;
        importedBy: string;
        issuedFileName?: string;
        occupiedFileName?: string;
        issuedImportedAt?: string;
        occupiedImportedAt?: string;
    };
}

export interface ResidentialGrowthSummary {
    issuedRecords: number;
    issuedUnits: number;
    occupiedRecords: number;
    occupiedUnits: number;
    issuedGeocoded: number;
    occupiedGeocoded: number;
    reviewCount: number;
}

export interface ResidentialGrowthParseResult {
    records: ResidentialGrowthRecord[];
    period?: string;
    warnings: string[];
}

export interface ResidentialGrowthImportRecord {
    id: string;
    period: string;
    importedAt: string;
    importedBy: string;
    issuedFileName?: string | null;
    occupiedFileName?: string | null;
    issuedCount: number;
    issuedUnits: number;
    occupiedCount: number;
    occupiedUnits: number;
    storagePath: string;
    isActive: boolean;
}

export interface ResidentialGrowthGeocodeCache {
    addresses: Record<string, ResidentialGrowthGeocode>;
    lastUpdated: string;
}
