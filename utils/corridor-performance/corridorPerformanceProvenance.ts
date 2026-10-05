import feedInfoRaw from '../../gtfs/feed_info.txt?raw';
import type { PerformanceMetadata } from '../performanceDataTypes';
import { buildHeaderIndex, parseCsvRow } from '../transit-app/transitAppGtfsNormalization';

export interface CorridorGtfsProvenance {
    feedVersion: string | null;
    feedStartDate: string | null;
    feedEndDate: string | null;
}

export type CorridorBaselineCoverage = 'covered' | 'partial' | 'unknown';

function formatGtfsDate(value: string | undefined): string | null {
    const normalized = value?.trim() ?? '';
    if (!/^\d{8}$/.test(normalized)) return null;
    return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

export function parseCorridorGtfsProvenance(raw: string): CorridorGtfsProvenance {
    const lines = raw.trim().split(/\r?\n/);
    if (lines.length < 2) {
        return { feedVersion: null, feedStartDate: null, feedEndDate: null };
    }

    const header = buildHeaderIndex(lines[0]);
    const values = parseCsvRow(lines[1]);
    const read = (field: string): string | undefined => {
        const index = header.get(field);
        return index === undefined ? undefined : values[index];
    };

    return {
        feedVersion: read('feed_version')?.trim() || null,
        feedStartDate: formatGtfsDate(read('feed_start_date')),
        feedEndDate: formatGtfsDate(read('feed_end_date')),
    };
}

export const BUNDLED_CORRIDOR_GTFS_PROVENANCE = parseCorridorGtfsProvenance(feedInfoRaw);

export function isCorridorServiceDateCovered(
    serviceDate: string,
    provenance: CorridorGtfsProvenance = BUNDLED_CORRIDOR_GTFS_PROVENANCE,
): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return false;
    if (!provenance.feedStartDate || !provenance.feedEndDate) return false;
    return serviceDate >= provenance.feedStartDate && serviceDate <= provenance.feedEndDate;
}

export function assessCorridorBaselineCoverage(
    metadata: Pick<PerformanceMetadata, 'dateRange'> | null | undefined,
    provenance: CorridorGtfsProvenance = BUNDLED_CORRIDOR_GTFS_PROVENANCE,
): CorridorBaselineCoverage {
    if (!metadata || !provenance.feedStartDate || !provenance.feedEndDate) return 'unknown';
    return metadata.dateRange.start >= provenance.feedStartDate
        && metadata.dateRange.end <= provenance.feedEndDate
        ? 'covered'
        : 'partial';
}
