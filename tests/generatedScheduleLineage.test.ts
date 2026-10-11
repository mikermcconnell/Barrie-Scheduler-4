import { describe, expect, it } from 'vitest';
import { buildGeneratedScheduleInputFingerprint } from '../components/NewSchedule/utils/generatedScheduleLineage';

const baseInput = () => ({
    approvedRuntimeFingerprint: 'step2-review:v1:trusted',
    dayType: 'Weekday' as const,
    autofillFromMaster: true,
    config: {
        routeNumber: '8',
        cycleMode: 'Floating' as const,
        cycleTime: 60,
        recoveryRatio: 15,
        blocks: [{
            id: '8-1',
            startTime: '06:00',
            endTime: '22:00',
            startDirection: 'North' as const,
        }],
        bandRecoveryDefaults: [
            { bandId: 'B', avgCycleTime: 62, avgRecoveryRatio: 15, tripCount: 4 },
            { bandId: 'A', avgCycleTime: 58, avgRecoveryRatio: 12, tripCount: 5 },
        ],
    },
});

describe('generated schedule lineage', () => {
    it('is stable when lookup-only band defaults have a different order', () => {
        const input = baseInput();
        const reordered = baseInput();
        reordered.config.bandRecoveryDefaults.reverse();

        expect(buildGeneratedScheduleInputFingerprint(input))
            .toBe(buildGeneratedScheduleInputFingerprint(reordered));
    });

    it('changes when runtime approval or a generation input changes', () => {
        const baseline = buildGeneratedScheduleInputFingerprint(baseInput());
        expect(buildGeneratedScheduleInputFingerprint({
            ...baseInput(),
            approvedRuntimeFingerprint: 'step2-review:v1:new',
        })).not.toBe(baseline);

        const changedConfig = baseInput();
        changedConfig.config.recoveryRatio = 20;
        expect(buildGeneratedScheduleInputFingerprint(changedConfig)).not.toBe(baseline);
    });
});
