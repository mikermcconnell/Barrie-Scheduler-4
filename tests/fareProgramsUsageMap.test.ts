import { describe, expect, it } from 'vitest';
import { groupFareProgramUsageMapOrigins } from '../utils/fare-programs/fareProgramsUsageMap';

describe('fareProgramsUsageMap', () => {
    it('combines workbook locations mapped to the same coordinate', () => {
        const points = groupFareProgramUsageMapOrigins([
            {
                id: 'origin-a',
                label: 'Bayfield stop',
                longitude: -79.7000001,
                latitude: 44.4000001,
                filteredUses: 8,
                uses: 12,
            },
            {
                id: 'origin-b',
                label: 'Bayfield street address',
                longitude: -79.7000002,
                latitude: 44.4000002,
                filteredUses: 3,
                uses: 5,
            },
            {
                id: 'origin-c',
                label: 'South-end stop',
                longitude: -79.6501,
                latitude: 44.3501,
                filteredUses: 4,
                uses: 7,
            },
        ]);

        expect(points).toHaveLength(2);
        expect(points[0]).toMatchObject({
            filteredUses: 11,
            totalUses: 17,
            locationCount: 2,
        });
        expect(points[0].origins.map((origin) => origin.label)).toEqual([
            'Bayfield stop',
            'Bayfield street address',
        ]);
    });

    it('orders coordinate groups by the selected measure', () => {
        const points = groupFareProgramUsageMapOrigins([
            {
                id: 'low',
                label: 'Low use',
                longitude: -79.7,
                latitude: 44.4,
                filteredUses: 1,
                uses: 10,
            },
            {
                id: 'high',
                label: 'High use',
                longitude: -79.6,
                latitude: 44.3,
                filteredUses: 9,
                uses: 9,
            },
        ]);

        expect(points.map((point) => point.origins[0].id)).toEqual(['high', 'low']);
    });
});
