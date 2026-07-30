import { describe, expect, it } from 'vitest';
import {
    analyzeFareProgramRows,
    sanitizeFareProgramOrigin,
} from '../scripts/generateFareProgramsSnapshot.mjs';

const headers = [
    'Id',
    'Route',
    'Transit Pass',
    'Starting Location',
    'Ending Location',
    'Strat Time',
    'End Time',
];

describe('Fare Programs snapshot generator', () => {
    it('derives the proxy, location quality, and school matching from source rows', () => {
        const snapshot = analyzeFareProgramRows([
            headers,
            [1, 'Barrie Transit', 'High School Student Pass 25/26', '110 Grove St E, Barrie', null, '2026-01-02 08:00', null],
            [2, 'Barrie Transit', 'High School Student Pass 25/26', 'No Data Available - Geolocation Unauthorized', '95 Little Ave, Barrie', '2026-01-03 08:00', null],
            [3, 'Barrie Transit', 'High School Student Pass 25/26', 'Mapleview at Prince William Way, Barrie', '', '2026-02-01 08:00', null],
            [4, 'Barrie Transit', 'High School Student Pass 25/26', 'Downtown Hub, Barrie', 'Geolocation Unauthorized', '2026-02-02 08:00', null],
            [5, 'Barrie Transit', 'Innisdale Student Pass', '95 Little Ave, Barrie', null, '2026-02-03 08:00', null],
        ], { fileName: 'fixture.xlsx', sizeBytes: 123, sha256: 'fixture-hash' });

        expect(snapshot.sourceRows).toBe(5);
        expect(snapshot.sourcePassCounts).toEqual([
            { label: 'High School Student Pass 25/26', uses: 4 },
            { label: 'Innisdale Student Pass', uses: 1 },
        ]);
        expect(snapshot.serviceMirroring.uses).toBe(4);
        expect(snapshot.serviceMirroring.excludedReviewPasses).toEqual([
            expect.objectContaining({ label: 'Innisdale Student Pass', uses: 1 }),
        ]);
        expect(snapshot.serviceMirroring.schoolAreas.map(school => [school.id, school.uses])).toEqual([
            ['barrie-north', 1],
            ['innisdale', 1],
            ['maple-ridge', 1],
        ]);
        expect(snapshot.serviceMirroring.unattributedUses).toBe(1);
        expect(snapshot.serviceMirroring.authorizedStartLocations).toBe(3);
        expect(snapshot.serviceMirroring.recordedEndLocations).toBe(2);
        expect(snapshot.serviceMirroring.usableEndLocations).toBe(1);
        expect(snapshot.serviceMirroring.monthlyUses.map(month => month.uses)).toEqual([2, 2]);
    });

    it('rejects a workbook whose logical columns have drifted', () => {
        expect(() => analyzeFareProgramRows([
            ['Wrong', ...headers.slice(1)],
            [1, 'Barrie Transit', 'High School Student Pass 25/26', '', '', '2026-01-01', ''],
        ])).toThrow(/Unexpected Fare Programs columns/);
    });

    it('removes precise address details and groups origin usage by Barrie-local day and time', () => {
        expect(sanitizeFareProgramOrigin('59 Oakridge Drive, Barrie, ON L4N 5N6, Canada')).toEqual({
            label: 'Oakridge Dr area',
            geocodeQuery: 'Oakridge Dr',
        });

        const snapshot = analyzeFareProgramRows([
            headers,
            [1, 'Barrie Transit', 'High School Student Pass 25/26', '59 Oakridge Drive, Barrie, ON L4N 5N6, Canada', '', '2025-12-15 11:00', ''],
            [2, 'Barrie Transit', 'High School Student Pass 25/26', '61 Oakridge Dr, Barrie, ON L4N 5N6, Canada', '', '2025-12-15 14:00', ''],
            [3, 'Barrie Transit', 'High School Student Pass 25/26', '63 Oakridge Dr, Barrie, ON L4N 5N6, Canada', '', '2025-12-20 20:00', ''],
        ]);

        expect(snapshot.serviceMirroring.originUsage.origins).toEqual([
            expect.objectContaining({
                label: 'Oakridge Dr area',
                uses: 3,
                buckets: {
                    weekday: { 'before-6': 0, morning: 1, 'school-day': 1, afternoon: 0, evening: 0 },
                    weekend: { 'before-6': 0, morning: 0, 'school-day': 0, afternoon: 1, evening: 0 },
                },
            }),
        ]);
        expect(snapshot.serviceMirroring.originUsage.displayedUses).toBe(3);
        expect(snapshot.serviceMirroring.originUsage.suppressedUses).toBe(0);
    });
});
