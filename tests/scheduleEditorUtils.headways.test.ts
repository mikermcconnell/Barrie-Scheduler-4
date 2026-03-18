import { describe, expect, it } from 'vitest';
import { calculateOrderedHeadways } from '../utils/schedule/scheduleEditorUtils';

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
