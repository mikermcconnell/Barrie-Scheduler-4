import { describe, expect, it } from 'vitest';
import {
    BARRIE_SCHOOLS,
    findBestTrip,
    isPointInPolygon,
    getTransferQuality,
    getClusterStopIds,
    parseTimeToMinutes,
    minutesToDisplayTime,
} from '../utils/transit-app/studentPassUtils';

// ─── isPointInPolygon ─────────────────────────────────────────────────────────

describe('isPointInPolygon', () => {
    // Simple square: corners at (0,0), (0,1), (1,1), (1,0)
    const square: [number, number][] = [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
    ];

    it('returns true for a point clearly inside the polygon', () => {
        expect(isPointInPolygon([0.5, 0.5], square)).toBe(true);
    });

    it('returns false for a point clearly outside the polygon', () => {
        expect(isPointInPolygon([2, 2], square)).toBe(false);
    });

    it('returns false for a point on the negative side', () => {
        expect(isPointInPolygon([-0.5, 0.5], square)).toBe(false);
    });

    it('returns false for a polygon with fewer than 3 vertices', () => {
        const line: [number, number][] = [
            [0, 0],
            [1, 1],
        ];
        expect(isPointInPolygon([0.5, 0.5], line)).toBe(false);
    });

    it('returns false for an empty polygon', () => {
        expect(isPointInPolygon([0, 0], [])).toBe(false);
    });

    // Triangle with vertices at (0,0), (2,0), (1,2)
    const triangle: [number, number][] = [
        [0, 0],
        [2, 0],
        [1, 2],
    ];

    it('returns true for a point inside a triangle', () => {
        expect(isPointInPolygon([1, 0.5], triangle)).toBe(true);
    });

    it('returns false for a point outside a triangle', () => {
        expect(isPointInPolygon([0.1, 1.5], triangle)).toBe(false);
    });

    // Barrie-scale test: small polygon around a real area
    const barrieBlock: [number, number][] = [
        [44.390, -79.680],
        [44.390, -79.670],
        [44.395, -79.670],
        [44.395, -79.680],
    ];

    it('returns true for a point inside a Barrie-scale polygon', () => {
        // Center of the block
        expect(isPointInPolygon([44.392, -79.675], barrieBlock)).toBe(true);
    });

    it('returns false for a point outside a Barrie-scale polygon', () => {
        // Well outside to the east
        expect(isPointInPolygon([44.392, -79.650], barrieBlock)).toBe(false);
    });

    it('returns false for a point north of the Barrie-scale polygon', () => {
        expect(isPointInPolygon([44.400, -79.675], barrieBlock)).toBe(false);
    });
});

// ─── getTransferQuality ───────────────────────────────────────────────────────

describe('getTransferQuality', () => {
    it('rates 0 minutes as tight', () => {
        const result = getTransferQuality(0);
        expect(result.quality).toBe('tight');
        expect(result.label).toBe('Tight connection');
        expect(result.color).toBe('#EF4444');
        expect(result.waitMinutes).toBe(0);
    });

    it('rates 4 minutes as tight', () => {
        const result = getTransferQuality(4);
        expect(result.quality).toBe('tight');
    });

    it('rates exactly 5 minutes as good', () => {
        const result = getTransferQuality(5);
        expect(result.quality).toBe('good');
        expect(result.label).toBe('Good connection');
        expect(result.color).toBe('#22C55E');
    });

    it('rates 8 minutes as good', () => {
        const result = getTransferQuality(8);
        expect(result.quality).toBe('good');
    });

    it('rates exactly 10 minutes as good', () => {
        const result = getTransferQuality(10);
        expect(result.quality).toBe('good');
    });

    it('rates 11 minutes as ok', () => {
        const result = getTransferQuality(11);
        expect(result.quality).toBe('ok');
        expect(result.label).toBe('OK connection');
        expect(result.color).toBe('#F59E0B');
    });

    it('rates exactly 15 minutes as ok', () => {
        const result = getTransferQuality(15);
        expect(result.quality).toBe('ok');
    });

    it('rates 16 minutes as long', () => {
        const result = getTransferQuality(16);
        expect(result.quality).toBe('long');
        expect(result.label).toBe('Long wait');
        expect(result.color).toBe('#EF4444');
    });

    it('rates 30 minutes as long', () => {
        const result = getTransferQuality(30);
        expect(result.quality).toBe('long');
    });

    it('preserves waitMinutes in result', () => {
        expect(getTransferQuality(7).waitMinutes).toBe(7);
        expect(getTransferQuality(20).waitMinutes).toBe(20);
    });

    it('uses red for tight and long, green for good, amber for ok', () => {
        expect(getTransferQuality(2).color).toBe('#EF4444'); // tight = red
        expect(getTransferQuality(7).color).toBe('#22C55E'); // good = green
        expect(getTransferQuality(12).color).toBe('#F59E0B'); // ok = amber
        expect(getTransferQuality(20).color).toBe('#EF4444'); // long = red
    });
});

// ─── parseTimeToMinutes ───────────────────────────────────────────────────────

describe('parseTimeToMinutes', () => {
    it('parses standard morning time', () => {
        expect(parseTimeToMinutes('08:30:00')).toBe(510);
    });

    it('parses standard afternoon time', () => {
        expect(parseTimeToMinutes('17:40:00')).toBe(1060);
    });

    it('parses post-midnight GTFS time (>= 24:00)', () => {
        expect(parseTimeToMinutes('24:10:00')).toBe(1450);
        expect(parseTimeToMinutes('25:00:00')).toBe(1500);
    });

    it('parses midnight as 0', () => {
        expect(parseTimeToMinutes('00:00:00')).toBe(0);
    });
});

// ─── minutesToDisplayTime ─────────────────────────────────────────────────────

describe('minutesToDisplayTime', () => {
    it('formats morning time correctly', () => {
        expect(minutesToDisplayTime(510)).toBe('8:30 AM');
    });

    it('formats afternoon time correctly', () => {
        expect(minutesToDisplayTime(780)).toBe('1:00 PM');
    });

    it('formats noon correctly', () => {
        expect(minutesToDisplayTime(720)).toBe('12:00 PM');
    });

    it('formats midnight correctly', () => {
        expect(minutesToDisplayTime(0)).toBe('12:00 AM');
    });
});

// ─── findBestTrip (integration invariants) ────────────────────────────────────

describe('findBestTrip', () => {
    const cityWideZone: [number, number][] = [
        [44.20, -79.95],
        [44.20, -79.40],
        [44.60, -79.40],
        [44.60, -79.95],
    ];

    it('returns stop ids for each leg when a trip is found', { timeout: 60000 }, () => {
        const results = BARRIE_SCHOOLS.map((school) => findBestTrip(cityWideZone, school));
        const foundResults = results.filter((r) => r.found);

        expect(foundResults.length).toBeGreaterThan(0);

        for (const result of foundResults) {
            const allLegs = [...result.morningLegs, ...result.afternoonLegs];
            expect(allLegs.length).toBeGreaterThan(0);
            for (const leg of allLegs) {
                expect(leg.fromStopId).toBeTruthy();
                expect(leg.toStopId).toBeTruthy();
            }
        }
    });

    it('prefers direct or 1-transfer over 2-transfer when available', () => {
        // Zone near school should produce direct, not 2-transfer
        const nearSchoolZone: [number, number][] = [
            [44.398, -79.695],
            [44.398, -79.685],
            [44.404, -79.685],
            [44.404, -79.695],
        ];
        const school = BARRIE_SCHOOLS.find((s) => s.id === 'barrie-north')!;
        const result = findBestTrip(nearSchoolZone, school);
        if (result.found) {
            // Should be direct or 1-transfer, not 2-transfer
            expect(result.morningLegs.length).toBeLessThanOrEqual(2);
        }
    });
});

// ─── Transfer clusters ───────────────────────────────────────────────────────

describe('getClusterStopIds', () => {
    it('returns a set containing at least the queried stop', () => {
        // Stop 1 (Downtown Hub) should always cluster with itself
        const cluster = getClusterStopIds('1');
        expect(cluster.has('1')).toBe(true);
        expect(cluster.size).toBeGreaterThanOrEqual(1);
    });

    it('clusters co-located Downtown Hub stops together', () => {
        // Stops 1 and 2 are Downtown Hub platforms ~16m apart
        const cluster1 = getClusterStopIds('1');
        const cluster2 = getClusterStopIds('2');
        expect(cluster1.has('2')).toBe(true);
        expect(cluster2.has('1')).toBe(true);
    });

    it('does not cluster distant stops together', () => {
        // Stop 1 (Downtown) should not cluster with stop 339 (school in north Barrie)
        const cluster = getClusterStopIds('1');
        expect(cluster.has('339')).toBe(false);
    });
});

// ─── 2-transfer integration ──────────────────────────────────────────────────

describe('findBestTrip — 2-transfer fallback', () => {
    it('finds a trip for a zone far from Barrie North Collegiate', () => {
        // South/central Barrie zone — far from school, likely needs 2 transfers
        const southZone: [number, number][] = [
            [44.355, -79.700],
            [44.355, -79.690],
            [44.365, -79.690],
            [44.365, -79.700],
        ];
        const school = BARRIE_SCHOOLS.find((s) => s.id === 'barrie-north')!;
        const result = findBestTrip(southZone, school);

        // The key assertion: this zone should find SOME trip (direct, 1-transfer, or 2-transfer)
        // Previously this would return found: false for many zones
        expect(result.found).toBe(true);
        expect(result.morningLegs.length).toBeGreaterThanOrEqual(1);

        // If it's a 2-transfer result, verify structure
        if (result.morningLegs.length === 3) {
            expect(result.transfers).toBeDefined();
            expect(result.transfers!.length).toBe(2);
            expect(result.transfers![0].waitMinutes).toBeGreaterThanOrEqual(0);
            expect(result.transfers![1].waitMinutes).toBeGreaterThanOrEqual(0);
        }
    });
});
