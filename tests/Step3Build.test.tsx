import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Step3Build } from '../components/NewSchedule/steps/Step3Build';
import { getMasterSchedule } from '../utils/services/masterScheduleService';

vi.mock('../utils/services/masterScheduleService', () => ({
    getMasterSchedule: vi.fn(),
}));

describe('Step3Build', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) {
            flushSync(() => {
                root?.unmount();
            });
        }
        container?.remove();
        root = null;
        container = null;
        vi.clearAllMocks();
    });

    it('clears stale blocks when master autofill finds no schedule', async () => {
        vi.mocked(getMasterSchedule).mockResolvedValue(null);
        const setConfig = vi.fn();

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step3Build
                    dayType="Weekday"
                    bands={[]}
                    config={{
                        routeNumber: '8',
                        cycleTime: 60,
                        blocks: [{ id: '7-1', startTime: '06:00', endTime: '22:00' }],
                    }}
                    setConfig={setConfig}
                    teamId="team-1"
                    stopSuggestions={[]}
                    autofillFromMaster={true}
                    onAutofillFromMasterChange={() => {}}
                />
            );
        });

        await Promise.resolve();
        await Promise.resolve();

        expect(getMasterSchedule).toHaveBeenCalledWith('team-1', '8-Weekday');
        expect(setConfig).toHaveBeenCalledWith({
            routeNumber: '8',
            cycleTime: 60,
            blocks: [],
            bandRecoveryDefaults: undefined,
        });
    });

    it('prefers the approved runtime contract for the Step 2 summary guidance', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step3Build
                    dayType="Weekday"
                    bands={[]}
                    analysis={[]}
                    approvedRuntimeContract={{
                        schemaVersion: 1,
                        routeIdentity: '7-Weekday',
                        routeNumber: '7',
                        dayType: 'Weekday',
                        importMode: 'performance',
                        inputFingerprint: 'step2-review:v1:test',
                        approvalState: 'approved',
                        readinessStatus: 'ready',
                        approvedAt: '2026-03-27T12:00:00.000Z',
                        sourceSnapshot: {},
                        planning: {
                            chartBasis: 'observed-cycle',
                            generationBasis: 'direction-band-summary',
                            buckets: [
                                {
                                    timeBucket: '06:00 - 06:29',
                                    totalP50: 40,
                                    totalP80: 44,
                                    assignedBand: 'A',
                                    isOutlier: false,
                                    ignored: false,
                                    details: [],
                                },
                            ],
                            bands: [
                                {
                                    id: 'A',
                                    label: 'Band A',
                                    min: 35,
                                    max: 45,
                                    avg: 40,
                                    color: '#2563eb',
                                    count: 1,
                                },
                            ],
                            directionBandSummary: {},
                            segmentColumns: [{ segmentName: 'Stop A to Stop B' }],
                            usableBucketCount: 1,
                            ignoredBucketCount: 0,
                            usableBandCount: 1,
                            directions: ['North'],
                        },
                        healthSnapshot: {
                            status: 'ready',
                            blockers: [],
                            warnings: [],
                            expectedDirections: 1,
                            matchedDirections: ['North'],
                            expectedSegmentCount: 1,
                            matchedSegmentCount: 1,
                            missingSegments: [],
                            availableBucketCount: 1,
                            completeBucketCount: 1,
                            incompleteBucketCount: 0,
                            lowConfidenceBucketCount: 0,
                            runtimeSourceSummary: 'stop-level',
                            confidenceThreshold: 5,
                            usesLegacyRuntimeLogic: false,
                        },
                    } as any}
                    approvedRuntimeModel={{
                        dayType: 'Weekday',
                        importMode: 'performance',
                        status: 'ready',
                        chartBasis: 'observed-cycle',
                        generationBasis: 'direction-band-summary',
                        buckets: [],
                        bands: [],
                        directionBandSummary: {},
                        segmentColumns: [],
                        healthReport: {
                            status: 'ready',
                            blockers: [],
                            warnings: [],
                            expectedDirections: 0,
                            matchedDirections: [],
                            expectedSegmentCount: 0,
                            matchedSegmentCount: 0,
                            missingSegments: [],
                            completeBucketCount: 0,
                            incompleteBucketCount: 0,
                            lowConfidenceBucketCount: 0,
                            availableBucketCount: 0,
                            runtimeSourceSummary: 'none',
                            confidenceThreshold: 10,
                            usesLegacyRuntimeLogic: false,
                        },
                        usableBucketCount: 9,
                        ignoredBucketCount: 0,
                        usableBandCount: 9,
                        directions: [],
                        bandPreviews: [],
                    }}
                    config={{
                        routeNumber: '7',
                        cycleTime: 60,
                        blocks: [],
                    }}
                    setConfig={() => {}}
                    teamId={undefined}
                    stopSuggestions={[]}
                    autofillFromMaster={false}
                    onAutofillFromMasterChange={() => {}}
                />
            );
        });

        expect(container.textContent).toContain('Using the approved Step 2 runtime model: 1 active bucket across 1 band.');
        expect(container.textContent).not.toContain('9 active bucket');
    });

    it('does not trust a legacy approved runtime model when no approved contract is present', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step3Build
                    dayType="Weekday"
                    bands={[]}
                    analysis={[]}
                    approvedRuntimeContract={null}
                    approvedRuntimeModel={{
                        dayType: 'Weekday',
                        importMode: 'performance',
                        status: 'ready',
                        chartBasis: 'observed-cycle',
                        generationBasis: 'direction-band-summary',
                        buckets: [],
                        bands: [],
                        directionBandSummary: {},
                        segmentColumns: [],
                        healthReport: {
                            status: 'ready',
                            blockers: [],
                            warnings: [],
                            expectedDirections: 0,
                            matchedDirections: [],
                            expectedSegmentCount: 0,
                            matchedSegmentCount: 0,
                            missingSegments: [],
                            completeBucketCount: 0,
                            incompleteBucketCount: 0,
                            lowConfidenceBucketCount: 0,
                            availableBucketCount: 0,
                            runtimeSourceSummary: 'none',
                            confidenceThreshold: 10,
                            usesLegacyRuntimeLogic: false,
                        },
                        usableBucketCount: 9,
                        ignoredBucketCount: 0,
                        usableBandCount: 9,
                        directions: [],
                        bandPreviews: [],
                    }}
                    config={{
                        routeNumber: '7',
                        cycleTime: 60,
                        blocks: [],
                    }}
                    setConfig={() => {}}
                    teamId={undefined}
                    stopSuggestions={[]}
                    autofillFromMaster={false}
                    onAutofillFromMasterChange={() => {}}
                />
            );
        });

        expect(container.textContent).not.toContain('Using the approved Step 2 runtime model');
        expect(container.textContent).not.toContain('9 active bucket');
    });
});
