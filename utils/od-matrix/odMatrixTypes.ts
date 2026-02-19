/**
 * OD Matrix Types
 *
 * Type definitions for origin-destination matrix analysis.
 * Supports any agency's pre-aggregated OD ridership data.
 */

// ============ GEOCODING ============

export interface GeocodedLocation {
    lat: number;
    lon: number;
    displayName: string;
    source: 'auto' | 'manual';
    confidence: 'high' | 'medium' | 'low';
}

export interface GeocodeCache {
    stations: Record<string, GeocodedLocation>;
    lastUpdated: string;
}

// ============ STATION & PAIR DATA ============

export interface ODStation {
    name: string;
    totalOrigin: number;
    totalDestination: number;
    totalVolume: number;
    geocode?: GeocodedLocation | null;
}

export interface ODPairRecord {
    origin: string;
    destination: string;
    journeys: number;
}

// ============ SUMMARY (stored in Cloud Storage) ============

export interface ODMatrixDataSummary {
    schemaVersion: 1;
    stations: ODStation[];
    pairs: ODPairRecord[];
    totalJourneys: number;
    stationCount: number;
    topPairs: ODPairRecord[];
    metadata: ODMatrixMetadata;
}

export interface ODMatrixMetadata {
    importedAt: string;
    importedBy: string;
    fileName: string;
    dateRange?: string;
    stationCount: number;
    totalJourneys: number;
}

// ============ IMPORT HISTORY ============

export interface ODMatrixImportRecord {
    id: string;
    importedAt: string;
    importedBy: string;
    fileName: string;
    dateRange?: string;
    stationCount: number;
    totalJourneys: number;
    storagePath: string;
    isActive: boolean;
}

// ============ PARSER OUTPUT ============

export interface ODMatrixParseResult {
    stations: ODStation[];
    pairs: ODPairRecord[];
    totalJourneys: number;
    stationCount: number;
    topPairs: ODPairRecord[];
    warnings: string[];
}
