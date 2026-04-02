import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const scheduleEditorSpy = vi.fn();

vi.mock('../components/ScheduleEditor', () => ({
    ScheduleEditor: (props: any) => {
        scheduleEditorSpy(props);
        return <div data-testid="schedule-editor-proxy">schedule editor</div>;
    },
}));

import { Step4Schedule } from '../components/NewSchedule/steps/Step4Schedule';

describe('Step4Schedule', () => {
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
        scheduleEditorSpy.mockReset();
    });

    it('prefers the approved runtime contract when handing data to the schedule editor', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        const onUpdateSchedules = vi.fn();

        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={[]}
                    originalSchedules={[]}
                    editorSessionKey={1}
                    bands={[
                        { id: 'Z', label: 'Legacy', min: 1, max: 2, avg: 1, color: '#999999', count: 1 },
                    ]}
                    analysis={[
                        {
                            timeBucket: '05:00 - 05:29',
                            totalP50: 10,
                            totalP80: 12,
                            assignedBand: 'Z',
                            isOutlier: false,
                            ignored: false,
                            details: [],
                        },
                    ]}
                    segmentNames={['Legacy Segment']}
                    onUpdateSchedules={onUpdateSchedules}
                    projectName="Test Project"
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
                            segmentColumns: [{ segmentName: 'Contract Segment' }],
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
                        chartBasis: 'uploaded-percentiles',
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
                />
            );
        });

        const latestCall = scheduleEditorSpy.mock.calls.at(-1)?.[0];
        expect(latestCall?.useAuthoritativeTimepoints).toBe(true);
        expect(latestCall?.bands).toEqual([
            { id: 'A', label: 'Band A', min: 35, max: 45, avg: 40, color: '#2563eb', count: 1 },
        ]);
        expect(latestCall?.analysis).toEqual([
            {
                timeBucket: '06:00 - 06:29',
                totalP50: 40,
                totalP80: 44,
                assignedBand: 'A',
                isOutlier: false,
                ignored: false,
                details: [],
            },
        ]);
        expect(latestCall?.segmentNames).toEqual(['Contract Segment']);
        expect(container.textContent).toContain('Approved runtime contract');
    });

    it('falls back to the live Step 4 inputs when no approved contract is present', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        const onUpdateSchedules = vi.fn();

        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={[]}
                    originalSchedules={[]}
                    editorSessionKey={1}
                    bands={[
                        { id: 'Z', label: 'Legacy', min: 1, max: 2, avg: 1, color: '#999999', count: 1 },
                    ]}
                    analysis={[
                        {
                            timeBucket: '05:00 - 05:29',
                            totalP50: 10,
                            totalP80: 12,
                            assignedBand: 'Z',
                            isOutlier: false,
                            ignored: false,
                            details: [],
                        },
                    ]}
                    segmentNames={['Live Step 4 Segment']}
                    onUpdateSchedules={onUpdateSchedules}
                    projectName="Test Project"
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
                />
            );
        });

        const latestCall = scheduleEditorSpy.mock.calls.at(-1)?.[0];
        expect(latestCall?.useAuthoritativeTimepoints).toBe(true);
        expect(latestCall?.bands).toEqual([
            { id: 'Z', label: 'Legacy', min: 1, max: 2, avg: 1, color: '#999999', count: 1 },
        ]);
        expect(latestCall?.analysis).toEqual([
            {
                timeBucket: '05:00 - 05:29',
                totalP50: 10,
                totalP80: 12,
                assignedBand: 'Z',
                isOutlier: false,
                ignored: false,
                details: [],
            },
        ]);
        expect(latestCall?.segmentNames).toEqual(['Live Step 4 Segment']);
        expect(container.textContent).not.toContain('Approved runtime contract');
    });

});
