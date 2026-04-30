import { describe, expect, it } from 'vitest';
import { buildRuntimeAxisDomain } from '../components/NewSchedule/step2/Step2PlanningReviewPanel';

describe('Step2PlanningReviewPanel runtime axis', () => {
    it('scales from active buckets only so ignored outliers do not stretch the chart', () => {
        const domain = buildRuntimeAxisDomain([
            { runtime: 100, ignored: false },
            { runtime: 110, ignored: false },
            { runtime: 217.2, ignored: true },
        ]);

        expect(domain).toEqual([95, 115]);
    });
});
