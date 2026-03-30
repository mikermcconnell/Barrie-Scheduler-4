import { describe, expect, it } from 'vitest';
import {
    analyzeHeadways,
    calculateOrderedHeadways,
    calculateSequentialHeadways,
    calculateServiceSpan,
    parseTimeInput,
    validateSchedule
} from '../utils/schedule/scheduleEditorUtils';
import type { MasterTrip } from '../utils/parsers/masterScheduleParser';

const trip = (overrides: Partial<MasterTrip> & Pick<MasterTrip, 'id' | 'startTime' | 'endTime'>): MasterTrip => ({
    blockId: 'block-1',
    direction: 'North',
    tripNumber: 1,
    travelTime: 20,
    recoveryTime: 5,
    ...overrides
} as MasterTrip);

describe('scheduleEditorUtils.calculateOrderedHeadways', () => {
    it('calculates headways from the supplied anchor times instead of relying on source order', () => {
        const headways = calculateOrderedHeadways(
            [
                { id: 'row-7-3', anchorTime: 390 }, // 6:30
                { id: 'row-7-1', anchorTime: 329 }, // 5:29
                { id: 'row-7-2', anchorTime: 359 }, // 5:59
            ],
            row => row.anchorTime
        );

        expect(headways['row-7-2']).toBe(30);
        expect(headways['row-7-3']).toBe(31);
    });

    it('uses operational ordering for post-midnight anchor times', () => {
        const headways = calculateOrderedHeadways(
            [
                { id: 'late-night', anchorTime: 1430 }, // 11:50 PM
                { id: 'after-midnight', anchorTime: 15 }, // 12:15 AM next operating day
            ],
            row => row.anchorTime
        );

        expect(headways['after-midnight']).toBe(25);
    });
});

describe('scheduleEditorUtils.calculateSequentialHeadways', () => {
    it('uses the supplied display order instead of re-sorting by time', () => {
        const headways = calculateSequentialHeadways(
            [
                { id: 'display-first', anchorTime: 390 },  // 6:30
                { id: 'display-second', anchorTime: 420 }, // 7:00
                { id: 'display-third', anchorTime: 359 },  // 5:59, shown third on purpose
            ],
            row => row.anchorTime
        );

        expect(headways['display-first']).toBeUndefined();
        expect(headways['display-second']).toBe(30);
        expect(headways['display-third']).toBe(-61);
    });

    it('uses operational ordering for post-midnight times while preserving display order', () => {
        const headways = calculateSequentialHeadways(
            [
                { id: 'late-night', anchorTime: 1430 },   // 11:50 PM
                { id: 'after-midnight', anchorTime: 15 }, // 12:15 AM
            ],
            row => row.anchorTime
        );

        expect(headways['late-night']).toBeUndefined();
        expect(headways['after-midnight']).toBe(25);
    });
});

describe('scheduleEditorUtils.overnight service math', () => {
    it('analyzeHeadways treats post-midnight trips as the next operational sequence', () => {
        const result = analyzeHeadways([
            trip({ id: 'late-night', startTime: 1430, endTime: 1435 }),
            trip({ id: 'after-midnight', startTime: 15, endTime: 20 })
        ]);

        expect(result.avg).toBe(25);
        expect(result.irregular).toEqual([]);
    });

    it('calculateServiceSpan keeps overnight spans positive', () => {
        const result = calculateServiceSpan([
            trip({ id: 'overnight-trip', startTime: 1430, endTime: 15 })
        ]);

        expect(result).toEqual({
            start: '11:50 PM',
            end: '12:15 AM',
            hours: 0.4
        });
    });

    it('validateSchedule flags real gaps across midnight instead of treating them as negative time', () => {
        const warnings = validateSchedule([
            trip({ id: 'late-night', startTime: 1430, endTime: 1435 }),
            trip({ id: 'after-midnight', startTime: 95, endTime: 100 })
        ]);

        expect(warnings).toContainEqual({
            type: 'warning',
            message: 'North: 100 min gap between trips',
            tripId: 'after-midnight'
        });
    });
});

describe('scheduleEditorUtils.parseTimeInput', () => {
    it('preserves the original period for ambiguous edits, including 12 o’clock times', () => {
        expect(parseTimeInput('730', '7:00 AM')).toBe('7:30 AM');
        expect(parseTimeInput('12:15', '12:30 AM')).toBe('12:15 AM');
        expect(parseTimeInput('12:15', '12:30 PM')).toBe('12:15 PM');
    });

    it('rejects explicit invalid 12-hour inputs instead of silently normalizing them', () => {
        expect(parseTimeInput('13:15pm')).toBeNull();
        expect(parseTimeInput('13:15am')).toBeNull();
        expect(parseTimeInput('0:30am')).toBeNull();
    });

    it('rejects non-numeric or malformed input instead of turning it into midnight', () => {
        expect(parseTimeInput('abc')).toBeNull();
        expect(parseTimeInput(':30')).toBeNull();
        expect(parseTimeInput('7:15:00')).toBeNull();
    });
});
