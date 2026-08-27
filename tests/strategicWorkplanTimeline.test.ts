import { describe, expect, it } from 'vitest';
import {
    calculateStrategicWorkplanTimelineRange,
    strategicWorkplanPointerDeltaDays,
} from '../utils/strategic-plan/workplanTimeline';

describe('strategic work-plan timeline editing', () => {
    it('snaps pointer movement to complete schedule weeks', () => {
        expect(strategicWorkplanPointerDeltaDays(25, 100, '2026-08-03', '2026-10-26')).toBe(21);
        expect(strategicWorkplanPointerDeltaDays(2, 100, '2026-08-03', '2026-10-26')).toBe(0);
    });

    it('moves the full task window while preserving its duration', () => {
        expect(calculateStrategicWorkplanTimelineRange({
            mode: 'move',
            startDate: '2026-08-10',
            endDate: '2026-08-23',
            scheduleStart: '2026-08-03',
            scheduleEnd: '2026-10-26',
            deltaDays: 14,
        })).toEqual({ startDate: '2026-08-24', endDate: '2026-09-06' });
    });

    it('clamps a moved task to the schedule boundary', () => {
        expect(calculateStrategicWorkplanTimelineRange({
            mode: 'move',
            startDate: '2026-08-10',
            endDate: '2026-08-23',
            scheduleStart: '2026-08-03',
            scheduleEnd: '2026-10-26',
            deltaDays: -28,
        })).toEqual({ startDate: '2026-08-03', endDate: '2026-08-16' });
    });

    it('resizes either endpoint without crossing the other endpoint', () => {
        expect(calculateStrategicWorkplanTimelineRange({
            mode: 'resize-start',
            startDate: '2026-08-10',
            endDate: '2026-08-23',
            scheduleStart: '2026-08-03',
            scheduleEnd: '2026-10-26',
            deltaDays: 28,
        })).toEqual({ startDate: '2026-08-23', endDate: '2026-08-23' });

        expect(calculateStrategicWorkplanTimelineRange({
            mode: 'resize-end',
            startDate: '2026-08-10',
            endDate: '2026-08-23',
            scheduleStart: '2026-08-03',
            scheduleEnd: '2026-10-26',
            deltaDays: -28,
        })).toEqual({ startDate: '2026-08-10', endDate: '2026-08-10' });
    });
});
