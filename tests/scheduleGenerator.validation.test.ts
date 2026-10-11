import { describe, expect, it } from 'vitest';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import {
    generateSchedule,
    InvalidScheduleGenerationConfigError,
    validateScheduleGenerationConfig,
} from '../utils/schedule/scheduleGenerator';
import type { DirectionBandSummary } from '../utils/ai/runtimeAnalysis';
import type { SegmentRawData } from '../components/NewSchedule/utils/csvParser';

const config = (overrides: Partial<ScheduleConfig> = {}): ScheduleConfig => ({
    routeNumber: '99',
    cycleMode: 'Floating',
    cycleTime: 0,
    recoveryRatio: 15,
    blocks: [{ id: '99-1', startTime: '06:00', endTime: '07:00' }],
    ...overrides,
});

describe('schedule generation configuration validation', () => {
    it.each([-1, 101, Number.POSITIVE_INFINITY, Number.NaN])(
        'rejects unsafe floating recovery value %s',
        recoveryRatio => {
            expect(validateScheduleGenerationConfig(config({ recoveryRatio }))).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ code: 'recovery-ratio' }),
                ])
            );
        }
    );

    it('allows zero recovery but rejects invalid per-band recovery', () => {
        expect(validateScheduleGenerationConfig(config({ recoveryRatio: 0 }))).toEqual([]);
        expect(validateScheduleGenerationConfig(config({
            recoveryRatio: 0,
            bandRecoveryDefaults: [{
                bandId: 'A',
                avgCycleTime: 30,
                avgRecoveryRatio: -5,
                tripCount: 10,
            }],
        }))).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'band-recovery-ratio' }),
        ]));
    });

    it('rejects missing and duplicate block IDs before trip IDs are created', () => {
        const issues = validateScheduleGenerationConfig(config({
            blocks: [
                { id: ' ', startTime: '06:00', endTime: '07:00' },
                { id: 'Bus-1', startTime: '06:00', endTime: '07:00' },
                { id: ' bus-1 ', startTime: '07:00', endTime: '08:00' },
            ],
        }));

        expect(issues.filter(issue => issue.code === 'block-id-empty')).toHaveLength(1);
        expect(issues.filter(issue => issue.code === 'block-id-duplicate')).toHaveLength(2);
    });

    it('fails fast for the -100% recovery configuration that previously could loop forever', () => {
        expect(() => generateSchedule(
            config({ recoveryRatio: -100 }),
            [],
            [],
            {},
            {},
            'Weekday'
        )).toThrow(InvalidScheduleGenerationConfigError);
    });

    it('fails fast when a strict paired leg cannot advance by one schedule minute', () => {
        const segments: Record<string, SegmentRawData[]> = {
            North: [{
                segmentName: 'North Start to Hub',
                timeBuckets: { '06:00 - 06:29': { p50: 1, p80: 1, n: 10 } },
            }],
            South: [{
                segmentName: 'Hub to South End',
                timeBuckets: { '06:00 - 06:29': { p50: 1, p80: 1, n: 10 } },
            }],
        };
        const bandSummary: DirectionBandSummary = {};

        expect(() => generateSchedule(
            config({ cycleMode: 'Strict', cycleTime: 1, recoveryRatio: 0 }),
            [],
            [],
            bandSummary,
            segments,
            'Weekday'
        )).toThrow(/invalid cycle or recovery value/i);
    });
});
