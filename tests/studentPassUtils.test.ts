import { describe, expect, it } from 'vitest';
import {
    isPointInPolygon,
    getTransferQuality,
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
