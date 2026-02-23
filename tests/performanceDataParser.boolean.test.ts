import { describe, expect, it } from 'vitest';
import { parseRow } from '../utils/performanceDataParser';

function baseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        Date: '2026-02-20',
        Day: 'FRIDAY',
        TimePoint: 'Y',
        InBetween: 'N',
        IsTripper: 'N',
        IsDetour: 'N',
        ...overrides,
    };
}

describe('performanceDataParser boolean coercion', () => {
    it('parses Y/N string booleans from STREETS exports', () => {
        const parsed = parseRow(baseRow(), 2);
        expect(parsed).not.toBeNull();
        expect(parsed?.timePoint).toBe(true);
        expect(parsed?.inBetween).toBe(false);
        expect(parsed?.isTripper).toBe(false);
        expect(parsed?.isDetour).toBe(false);
    });

    it('parses true/false shorthand tokens', () => {
        const parsed = parseRow(baseRow({
            TimePoint: 't',
            InBetween: 'f',
        }), 2);
        expect(parsed).not.toBeNull();
        expect(parsed?.timePoint).toBe(true);
        expect(parsed?.inBetween).toBe(false);
    });
});
