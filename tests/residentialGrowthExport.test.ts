// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
    buildResidentialGrowthBaseMapUrl,
    buildResidentialGrowthExportMarkers,
    fitResidentialGrowthExportCamera,
    buildResidentialGrowthStaticMapUrl,
    getResidentialGrowthExportLayerSummaries,
    getResidentialGrowthExportPoints,
    getResidentialGrowthExportSummaryLines,
    getResidentialGrowthMapCircleStyle,
    getResidentialGrowthTopSiteIconType,
    getResidentialGrowthUnitLabel,
    getResidentialGrowthUnitCircleStyle,
    projectResidentialGrowthExportPoint,
} from '../utils/residential-growth/export';
import type { ResidentialGrowthMonthlyDataset, ResidentialGrowthRecord } from '../utils/residential-growth/types';

function record(id: string, lon: number | null, lat: number | null, units: number, layer: 'issued' | 'occupied' = 'issued'): ResidentialGrowthRecord {
    return {
        id,
        layer,
        fileNumber: id,
        address: `${id} Test Street`,
        date: '2026-04-15',
        units,
        category: 'Residential',
        geocode: lon == null || lat == null ? null : {
            lon,
            lat,
            displayName: `${id} Test Street, Barrie`,
            source: 'mapbox',
            confidence: 'high',
        },
        warnings: [],
    };
}

function dataset(issued: ResidentialGrowthRecord[], occupied: ResidentialGrowthRecord[]): Pick<ResidentialGrowthMonthlyDataset, 'issued' | 'occupied'> {
    return { issued, occupied };
}

describe('residential growth export map utilities', () => {
    it('groups export points by coordinate and sorts the largest concentrations first', () => {
        const points = getResidentialGrowthExportPoints([
            record('small', -79.69, 44.38, 2),
            record('stack-a', -79.7, 44.39, 25),
            record('stack-b', -79.7, 44.39, 30),
            record('missing', null, null, 99),
        ]);

        expect(points).toEqual([
            expect.objectContaining({
                lon: -79.7,
                lat: 44.39,
                units: 55,
                recordCount: 2,
            }),
            expect.objectContaining({
                lon: -79.69,
                lat: 44.38,
                units: 2,
                recordCount: 1,
            }),
        ]);
    });

    it('builds a base map URL fitted to the currently filtered records', () => {
        const url = buildResidentialGrowthStaticMapUrl({
            records: [
                record('west', -79.75, 44.38, 8),
                record('east', -79.63, 44.38, 18),
            ],
            layer: 'issued',
            mapboxToken: 'test-token',
            width: 1200,
            height: 800,
        });

        expect(url).toContain('https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/');
        expect(url).not.toContain('pin-');
        expect(url).toContain('/1200x800@2x?');
        expect(url).toContain('access_token=test-token');
    });

    it('projects all fitted points inside the export image padding', () => {
        const points = getResidentialGrowthExportPoints([
            record('north-west', -79.75, 44.43, 8),
            record('south-east', -79.62, 44.31, 18),
        ]);
        const camera = fitResidentialGrowthExportCamera(points, 1200, 800, 80);
        const projected = points.map((point) => projectResidentialGrowthExportPoint(point, camera, 1200, 800));

        projected.forEach((point) => {
            expect(point.x).toBeGreaterThanOrEqual(80);
            expect(point.x).toBeLessThanOrEqual(1120);
            expect(point.y).toBeGreaterThanOrEqual(80);
            expect(point.y).toBeLessThanOrEqual(720);
        });
    });

    it('uses the same unit-scaled circle colors and sizes as the app map', () => {
        expect(getResidentialGrowthUnitCircleStyle(1)).toEqual({ color: '#16a34a', radius: 7 });
        expect(getResidentialGrowthUnitCircleStyle(25)).toEqual({ color: '#eab308', radius: 15 });
        expect(getResidentialGrowthUnitCircleStyle(125)).toEqual({ color: '#dc2626', radius: 30 });
        expect(getResidentialGrowthMapCircleStyle(75, true)).toEqual({ color: '#f97316', radius: 30 });
    });

    it('labels map icons with their unit count', () => {
        expect(getResidentialGrowthUnitLabel(1)).toBe('1');
        expect(getResidentialGrowthUnitLabel(16)).toBe('16');
        expect(getResidentialGrowthUnitLabel(1200)).toBe('1k');
    });

    it('uses house icons for small top sites and apartment icons for larger top sites', () => {
        expect(getResidentialGrowthTopSiteIconType(1)).toBe('house');
        expect(getResidentialGrowthTopSiteIconType(3)).toBe('house');
        expect(getResidentialGrowthTopSiteIconType(4)).toBe('apartment');
    });

    it('builds default PDF layer summaries for permits then occupied from the current filtered range', () => {
        const summaries = getResidentialGrowthExportLayerSummaries(dataset(
            [record('permit', -79.69, 44.38, 16, 'issued')],
            [record('occupied', -79.68, 44.37, 4, 'occupied')],
        ));

        expect(summaries.map((summary) => summary.layer)).toEqual(['issued', 'occupied']);
        expect(summaries[0]).toEqual(expect.objectContaining({
            title: 'Issued Permits',
            metricLabel: 'mapped permits',
            records: expect.arrayContaining([expect.objectContaining({ id: 'permit' })]),
        }));
        expect(summaries[1]).toEqual(expect.objectContaining({
            title: 'Occupied Units',
            metricLabel: 'mapped units',
            records: expect.arrayContaining([expect.objectContaining({ id: 'occupied' })]),
        }));
    });

    it('summarizes the exact filters used by the export', () => {
        const summary = getResidentialGrowthExportSummaryLines({
            rangeLabel: 'Mar 2026',
            periodCount: 1,
            subtypeFilter: 'Apartment',
            searchText: 'Dunlop',
            dateFrom: '2026-03-01',
            dateTo: '2026-03-31',
            accuracyFilter: 'exact',
        });

        expect(summary.primary).toBe('Mar 2026 | 1 month | Apartment');
        expect(summary.details).toEqual([
            'Search: Dunlop',
            'Dates: 2026-03-01 to 2026-03-31',
            'Exact geocodes only',
        ]);
    });

    it('uses clear default wording when no extra export filters are active', () => {
        const summary = getResidentialGrowthExportSummaryLines({
            rangeLabel: 'Apr 2026',
            periodCount: 2,
            subtypeFilter: 'all',
            searchText: '',
            dateFrom: '',
            dateTo: '',
            accuracyFilter: 'all',
        });

        expect(summary.primary).toBe('Apr 2026 | 2 months | All residential types');
        expect(summary.details).toEqual(['All geocodes']);
    });

    it('clusters nearby export points and sums their units like the app map', () => {
        const points = getResidentialGrowthExportPoints([
            record('near-a', -79.69, 44.38, 6),
            record('near-b', -79.69005, 44.38005, 10),
            record('far', -79.64, 44.38, 4),
        ]);
        const camera = { longitude: -79.69, latitude: 44.38, zoom: 14 };
        const markers = buildResidentialGrowthExportMarkers(points, camera, 1200, 800, 42);

        expect(markers).toEqual(expect.arrayContaining([
            expect.objectContaining({ clustered: true, units: 16, recordCount: 2 }),
            expect.objectContaining({ clustered: false, units: 4, recordCount: 1 }),
        ]));
    });

    it('keeps base map URLs short because points are drawn by the export renderer', () => {
        const url = buildResidentialGrowthBaseMapUrl({
            camera: { longitude: -79.69, latitude: 44.38, zoom: 11.5 },
            mapboxToken: 'test-token',
            width: 1280,
            height: 700,
        });

        expect(url.length).toBeLessThan(250);
        expect(url).toContain('/static/-79.69,44.38,11.5/1280x700@2x?');
    });

    it('returns null when there is no token or no geocoded data', () => {
        expect(buildResidentialGrowthStaticMapUrl({
            records: [record('missing', null, null, 5)],
            layer: 'occupied',
            mapboxToken: 'test-token',
        })).toBeNull();

        expect(buildResidentialGrowthStaticMapUrl({
            records: [record('one', -79.69, 44.38, 5)],
            layer: 'occupied',
            mapboxToken: '',
        })).toBeNull();
    });
});
