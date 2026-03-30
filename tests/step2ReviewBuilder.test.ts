import { describe, expect, it } from 'vitest';
import { buildStep2ReviewResult, buildStep2SourceSnapshot } from '../components/NewSchedule/utils/step2ReviewBuilder';
import { buildStep2ReviewFingerprint } from '../components/NewSchedule/utils/step2ReviewFingerprint';
import { buildApprovedRuntimeModel } from '../components/NewSchedule/utils/wizardState';
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

describe('step2ReviewBuilder', () => {
    it('builds a review result that reuses the current planning and health logic', () => {
        const input = {
            routeIdentity: ' 7-Weekday ',
            routeNumber: ' 7 ',
            dayType: 'Weekday' as const,
            importMode: 'performance' as const,
            performanceConfig: {
                routeId: ' 7 ',
                dateRange: {
                    start: ' 2026-03-01 ',
                    end: ' 2026-03-07 ',
                },
            },
            performanceDiagnostics: {
                routeId: ' 7 ',
                dateRange: {
                    start: ' 2026-03-01 ',
                    end: ' 2026-03-07 ',
                },
                runtimeLogicVersion: 2,
                importedAt: ' 2026-03-24T12:00:00.000Z ',
            },
            parsedDataFingerprint: '  runtime-data-v1  ',
            canonicalDirectionStops: {
                North: [' Park Place ', ' Peggy Hill Community Centre ', ' Allandale GO Station '],
                South: [' Allandale GO Station ', ' Peggy Hill Community Centre ', ' Park Place '],
            },
            canonicalRouteSource: {
                type: 'master' as const,
                routeIdentity: ' 7-Weekday ',
                versionHint: ' v1 ',
            },
            plannerOverrides: {
                excludedBuckets: [' 07:00 - 07:29 ', '06:30 - 06:59', '07:00 - 07:29'],
            },
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
                    { segmentName: 'Park Place to Peggy Hill Community Centre', p50: 14, p80: 16, n: 6 },
                    { segmentName: 'Peggy Hill Community Centre to Allandale GO Station', p50: 16, p80: 18, n: 6 },
                    { segmentName: 'Allandale GO Station to Downtime', p50: 18, p80: 20, n: 6 },
                    { segmentName: 'Downtime to Peggy Hill Community Centre', p50: 17, p80: 19, n: 6 },
                ],
            }],
            bands: [{
                id: 'B',
                label: 'Band B',
                min: 90,
                max: 100,
                avg: 98,
                color: '#f97316',
                count: 1,
            }],
            segmentsMap: {
                North: [
                    { segmentName: 'Park Place to Peggy Hill Community Centre', timeBuckets: {} },
                    { segmentName: 'Peggy Hill Community Centre to Allandale GO Station', timeBuckets: {} },
                ],
                South: [
                    { segmentName: 'Allandale GO Station to Downtime', timeBuckets: {} },
                    { segmentName: 'Downtime to Peggy Hill Community Centre', timeBuckets: {} },
                ],
            } as any,
            matrixAnalysis: [{
                timeBucket: '15:00 - 15:29',
                totalP50: 96,
                totalP80: 102,
                assignedBand: 'B',
                isOutlier: false,
                ignored: false,
                details: [] as never[],
            }],
            matrixSegmentsMap: {
                North: [{ segmentName: 'Park Place to Peggy Hill Community Centre', timeBuckets: {} }],
            } as any,
            troubleshootingPatternWarning: 'Full-route troubleshooting path not confirmed',
            canonicalSegmentColumns: [
                { segmentName: 'Park Place to Peggy Hill Community Centre', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Peggy Hill Community Centre to Allandale GO Station', direction: 'North', groupLabel: '7A' },
                { segmentName: 'Allandale GO Station to Downtime', direction: 'South', groupLabel: '7B' },
                { segmentName: 'Downtime to Peggy Hill Community Centre', direction: 'South', groupLabel: '7B' },
            ],
            runtimeDiagnostics: diagnostics,
        };

        const result = buildStep2ReviewResult(input);
        const expectedHealth = result.health;
        const approvedRuntimeModel = buildApprovedRuntimeModel({
            dayType: input.dayType,
            importMode: input.importMode,
            routeNumber: input.routeNumber,
            analysis: input.analysis,
            bands: input.bands,
            segmentsMap: input.segmentsMap,
            canonicalSegmentColumns: input.canonicalSegmentColumns ?? undefined,
            healthReport: expectedHealth,
        });

        expect(result.lifecycle).toBe('reviewable');
        expect(result.routeIdentity).toBe('7-Weekday');
        expect(result.routeNumber).toBe('7');
        expect(result.approvalEligible).toBe(true);
        expect(result.inputFingerprint).toBe(buildStep2ReviewFingerprint({
            routeIdentity: input.routeIdentity,
            routeNumber: input.routeNumber,
            dayType: input.dayType,
            importMode: input.importMode,
            performanceConfig: input.performanceConfig,
            performanceDiagnostics: input.performanceDiagnostics,
            parsedDataFingerprint: input.parsedDataFingerprint,
            canonicalDirectionStops: input.canonicalDirectionStops,
            canonicalRouteSource: input.canonicalRouteSource,
            plannerOverrides: {
                excludedBuckets: [' 07:00 - 07:29 ', '06:30 - 06:59', '07:00 - 07:29'],
            },
        }));
        expect(result.health).toEqual(expectedHealth);
        expect(result.planning).toMatchObject({
            chartBasis: approvedRuntimeModel.chartBasis,
            generationBasis: approvedRuntimeModel.generationBasis,
            usableBucketCount: approvedRuntimeModel.usableBucketCount,
            ignoredBucketCount: approvedRuntimeModel.ignoredBucketCount,
            usableBandCount: approvedRuntimeModel.usableBandCount,
            directions: approvedRuntimeModel.directions,
            canonicalDirectionStops: {
                North: ['Park Place', 'Peggy Hill Community Centre', 'Allandale GO Station'],
                South: ['Allandale GO Station', 'Peggy Hill Community Centre', 'Park Place'],
            },
        });
        expect(result.plannerOverrides.excludedBuckets).toEqual(['06:30 - 06:59', '07:00 - 07:29']);
        expect(result.troubleshooting.fallbackWarning).toBe('Full-route troubleshooting path not confirmed');
        expect(result.troubleshooting.canRenderFullPath).toBe(false);
        expect(result.troubleshooting.matrixAnalysis).toHaveLength(1);
        expect(result.troubleshooting.matrixSegmentsMap).toEqual(input.matrixSegmentsMap);
    });

    it('builds a blocked review result when the current health is blocked', () => {
        const blockedResult = buildStep2ReviewResult({
            routeIdentity: '7-Weekday',
            routeNumber: '7',
            dayType: 'Weekday',
            importMode: 'performance',
            performanceConfig: null,
            performanceDiagnostics: null,
            parsedDataFingerprint: 'runtime-data-v1',
            canonicalDirectionStops: null,
            canonicalRouteSource: null,
            plannerOverrides: { excludedBuckets: [] },
            analysis: [],
            bands: [],
            segmentsMap: {},
            runtimeDiagnostics: null,
        });

        expect(blockedResult.health.status).toBe('blocked');
        expect(blockedResult.approvalEligible).toBe(false);
        expect(blockedResult.troubleshooting.canRenderFullPath).toBe(false);
    });

    it('can build a source snapshot from the performance diagnostics metadata', () => {
        expect(buildStep2SourceSnapshot({
            routeIdentity: '7-Weekday',
            routeNumber: '7',
            dayType: 'Weekday',
            importMode: 'performance',
            performanceConfig: null,
            performanceDiagnostics: {
                routeId: ' 7 ',
                dateRange: {
                    start: ' 2026-03-01 ',
                    end: ' 2026-03-07 ',
                },
                runtimeLogicVersion: 2,
                importedAt: ' 2026-03-24T12:00:00.000Z ',
                stopOrderDecision: 'accept',
                stopOrderConfidence: 'high',
                stopOrderSource: 'runtime-derived',
            },
            parsedDataFingerprint: 'runtime-data-v1',
            canonicalDirectionStops: null,
            canonicalRouteSource: null,
            plannerOverrides: { excludedBuckets: [] },
            analysis: [],
            bands: [],
            segmentsMap: {},
            runtimeDiagnostics: null,
        })).toEqual({
            performanceRouteId: '7',
            performanceDateRange: {
                start: '2026-03-01',
                end: '2026-03-07',
            },
            runtimeLogicVersion: 2,
            importedAt: '2026-03-24T12:00:00.000Z',
            stopOrderDecision: 'accept',
            stopOrderConfidence: 'high',
            stopOrderSource: 'runtime-derived',
        });
    });

    it('surfaces stop-order review state in the Step 2 health summary', () => {
        const result = buildStep2ReviewResult({
            routeIdentity: '7-Weekday',
            routeNumber: '7',
            dayType: 'Weekday',
            importMode: 'performance',
            performanceConfig: null,
            performanceDiagnostics: {
                routeId: '7',
                dateRange: null,
                runtimeLogicVersion: 2,
                importedAt: '2026-03-24T12:00:00.000Z',
                stopOrderDecision: 'review',
                stopOrderConfidence: 'medium',
                stopOrderSource: 'master-fallback',
            },
            parsedDataFingerprint: 'runtime-data-v1',
            canonicalDirectionStops: {
                North: ['Park Place', 'Downtown Hub'],
                South: ['Downtown Hub', 'Park Place'],
            },
            canonicalRouteSource: {
                type: 'master',
                routeIdentity: '7-Weekday',
                versionHint: 'master-schedule',
            },
            plannerOverrides: { excludedBuckets: [] },
            analysis: [{
                timeBucket: '15:00 - 15:29',
                totalP50: 30,
                totalP80: 35,
                observedCycleP50: 30,
                observedCycleP80: 35,
                assignedBand: 'A',
                isOutlier: false,
                ignored: false,
                sampleCountMode: 'days',
                details: [
                    { segmentName: 'Park Place to Downtown Hub', p50: 15, p80: 18, n: 6 },
                    { segmentName: 'Downtown Hub to Park Place', p50: 15, p80: 17, n: 6 },
                ],
            }],
            bands: [{
                id: 'A',
                label: 'Band A',
                min: 25,
                max: 35,
                avg: 30,
                color: '#22c55e',
                count: 1,
            }],
            segmentsMap: {
                North: [{ segmentName: 'Park Place to Downtown Hub', timeBuckets: {} }],
                South: [{ segmentName: 'Downtown Hub to Park Place', timeBuckets: {} }],
            } as any,
            runtimeDiagnostics: diagnostics,
        });

        expect(result.health.status).toBe('warning');
        expect(result.health.runtimeSourceSummary).toContain('Using master schedule stop order fallback');
        expect(result.health.warnings).toContain('Observed stop order still needs planner review before it should replace the current stop chain.');
    });
});
