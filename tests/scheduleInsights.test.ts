import { describe, expect, it } from 'vitest';
import { getHeadwayInsights, getRowInsights } from '../utils/schedule/scheduleInsights';

describe('scheduleInsights.getHeadwayInsights', () => {
    it('does not warn when the displayed round-trip headway is in the normal cluster', () => {
        const insight = getHeadwayInsights(33, [31, 33, 35, 34]);

        expect(insight).toBeNull();
    });

    it('does not warn on small target drift', () => {
        const insight = getHeadwayInsights(35, [31, 33, 35, 34], 30);

        expect(insight).toBeNull();
    });

    it('warns when the displayed headway is materially different from target', () => {
        const insight = getHeadwayInsights(42, [31, 33, 35, 34], 30);

        expect(insight).toEqual({
            type: 'headway',
            severity: 'warning',
            message: 'Headway 42m is 12m longer than target 30m',
        });
    });

    it('does not warn from tiny sample sets without a target', () => {
        const insight = getHeadwayInsights(20, [20, 22]);

        expect(insight).toBeNull();
    });
});

describe('scheduleInsights.getRowInsights', () => {
    it('keeps recovery warnings independent from a stable headway', () => {
        const insights = getRowInsights(33, [31, 33, 35, 34], 40, 2);

        expect(insights).toEqual([
            {
                type: 'recovery',
                severity: 'warning',
                message: 'Recovery 2m is only 5% of travel time (< 10%)',
            },
        ]);
    });
});
