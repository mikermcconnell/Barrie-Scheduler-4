import { describe, expect, it } from 'vitest';
import { evaluateStep2ReviewHealth } from '../components/NewSchedule/utils/step2HealthEvaluator';
import { buildStep2DataHealthReport } from '../components/NewSchedule/utils/wizardState';
import type { PerformanceRuntimeDiagnostics } from '../utils/performanceRuntimeComputer';

const diagnostics: PerformanceRuntimeDiagnostics = {
    selectedRouteId: '7',
    canonicalRouteId: '7',
    filteredDayCount: 6,
    matchedRouteDayCount: 6,
    coarseEntryCount: 0,
    stopEntryCount: 12,
    tripEntryCount: 0,
    matchedRouteIds: ['7'],
    directions: ['North', 'South'],
    importedAt: '2026-03-24T12:00:00.000Z',
    runtimeLogicVersion: 2,
    isCurrentRuntimeLogic: true,
    usesLegacyRuntimeLogic: false,
    excludedLegacyDayCount: 0,
    usesCleanHistoryCutoff: false,
};

describe('step2HealthEvaluator', () => {
    it('wraps the current health report logic into the new review health shape', () => {
        const input = {
            routeNumber: '7',
            analysis: [{
                timeBucket: '15:00 - 15:29',
                totalP50: 96,
                totalP80: 102,
                observedCycleP50: 98,
                observedCycleP80: 104,
                assignedBand: 'B',
                isOutlier: false,
                ignored: false,
                sampleCountMode: 'days' as const,
                details: [
                    { segmentName: 'Park Place to Peggy Hill', p50: 14, p80: 16, n: 6 },
                    { segmentName: 'Peggy Hill to Allandale GO Station', p50: 16, p80: 18, n: 6 },
                    { segmentName: 'Allandale GO Station to Downtown', p50: 18, p80: 20, n: 6 },
                    { segmentName: 'Downtown to Peggy Hill', p50: 17, p80: 19, n: 6 },
                ],
            }],
            segmentsMap: {
                North: [
                    { segmentName: 'Park Place to Peggy Hill', timeBuckets: {} },
                    { segmentName: 'Peggy Hill to Allandale GO Station', timeBuckets: {} },
                ],
                South: [
                    { segmentName: 'Allandale GO Station to Downtown', timeBuckets: {} },
                    { segmentName: 'Downtown to Peggy Hill', timeBuckets: {} },
                ],
            } as any,
            canonicalSegmentColumns: [
                { segmentName: 'Park Place to Peggy Hill', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Peggy Hill to Allandale GO Station', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Allandale GO Station to Downtown', direction: 'South', groupLabel: '7B' },
                { segmentName: 'Downtown to Peggy Hill', direction: 'South', groupLabel: '7B' },
            ],
            performanceDiagnostics: diagnostics,
        };

        const evaluated = evaluateStep2ReviewHealth(input);
        const expected = buildStep2DataHealthReport(input);

        expect(evaluated).toEqual(expected);
        expect(evaluated).not.toBe(expected);
        expect(evaluated.status).toBe('ready');
        expect(evaluated.completeBucketCount).toBe(1);
    });

    it('preserves blocked health and legacy runtime warnings', () => {
        const blocked = evaluateStep2ReviewHealth({
            routeNumber: '7',
            analysis: [{
                timeBucket: '15:00 - 15:29',
                totalP50: 46,
                totalP80: 50,
                assignedBand: undefined,
                isOutlier: false,
                ignored: false,
                sampleCountMode: 'days' as const,
                details: [
                    { segmentName: 'Park Place to Peggy Hill', p50: 12, p80: 14, n: 3 },
                    { segmentName: 'Peggy Hill to Allandale GO Station', p50: 14, p80: 16, n: 3 },
                ],
            }],
            segmentsMap: {
                North: [
                    { segmentName: 'Park Place to Peggy Hill', timeBuckets: {} },
                    { segmentName: 'Peggy Hill to Allandale GO Station', timeBuckets: {} },
                ],
            } as any,
            canonicalSegmentColumns: [
                { segmentName: 'Park Place to Peggy Hill', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Peggy Hill to Allandale GO Station', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Allandale GO Station to Downtown', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Downtown to Peggy Hill', direction: 'South', groupLabel: '7B' },
            ],
            performanceDiagnostics: {
                ...diagnostics,
                filteredDayCount: 3,
                matchedRouteDayCount: 3,
                directions: ['North'],
                usesLegacyRuntimeLogic: true,
                isCurrentRuntimeLogic: false,
            },
        });

        expect(blocked.status).toBe('blocked');
        expect(blocked.blockers).toContain('Only 1 of 2 directions were found for this route.');
        expect(blocked.blockers).toContain('No complete cycle buckets are currently available for scheduling.');
        expect(blocked.warnings).toContain('This performance import was built with older runtime logic. Re-importing is recommended.');
    });
});
