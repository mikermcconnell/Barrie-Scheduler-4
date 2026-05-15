import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const scheduleEditorSpy = vi.fn();
const getMasterScheduleMock = vi.fn();

vi.mock('../components/ScheduleEditor', () => ({
    ScheduleEditor: (props: any) => {
        scheduleEditorSpy(props);
        return <div data-testid="schedule-editor-proxy">schedule editor{props.reviewToolsSlot}</div>;
    },
}));

vi.mock('../utils/services/masterScheduleService', () => ({
    getMasterSchedule: (...args: unknown[]) => getMasterScheduleMock(...args),
}));

import { Step4Schedule } from '../components/NewSchedule/steps/Step4Schedule';
import type { MasterRouteTable, MasterTrip } from '../utils/parsers/masterScheduleParser';

const makeTrip = (
    id: string,
    direction: 'North' | 'South',
    startTime: number,
    overrides: Partial<MasterTrip> = {}
): MasterTrip => ({
    id,
    blockId: '10-1',
    direction,
    tripNumber: 1,
    rowId: startTime,
    startTime,
    endTime: startTime + 30,
    travelTime: 30,
    recoveryTime: 0,
    cycleTime: 30,
    stops: { Terminal: `${Math.floor(startTime / 60)}:${String(startTime % 60).padStart(2, '0')}` },
    arrivalTimes: { Terminal: `${Math.floor(startTime / 60)}:${String(startTime % 60).padStart(2, '0')}` },
    recoveryTimes: {},
    startStopIndex: 0,
    endStopIndex: 0,
    isBlockStart: true,
    isBlockEnd: true,
    ...overrides,
});

const makeTable = (routeName: string, trips: MasterTrip[]): MasterRouteTable => ({
    routeName,
    stops: ['Terminal'],
    stopIds: { Terminal: 'STOP-1' },
    trips,
});

const flushAsyncUpdates = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    flushSync(() => {});
};

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
        getMasterScheduleMock.mockReset();
    });

    it('loads a published master comparison on demand and passes the baseline to the editor', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        const currentTable = makeTable('10 (Weekday) (North)', [
            makeTrip('draft-a', 'North', 365),
            makeTrip('draft-new', 'North', 430, { blockId: '10-2' }),
        ]);
        const masterTable = makeTable('10 (North)', [
            makeTrip('master-a', 'North', 360),
            makeTrip('master-removed', 'North', 500, { blockId: '10-9' }),
        ]);
        getMasterScheduleMock.mockResolvedValue({
            content: {
                northTable: masterTable,
            },
        });

        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={[currentTable]}
                    originalSchedules={[currentTable]}
                    editorSessionKey={1}
                    bands={[]}
                    analysis={[]}
                    segmentNames={[]}
                    onUpdateSchedules={vi.fn()}
                    projectName="Test Project"
                    teamId="team-1"
                    routeIdentity="10-Weekday"
                    routeLabel="Route 10 · Weekday"
                    approvedRuntimeContract={null}
                    approvedRuntimeModel={null}
                />
            );
        });

        expect(container.textContent).toContain('Compare to master');
        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].compactStep4).toBe(true);
        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].reviewToolsSlot).toBeTruthy();
        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].masterBaseline).toBeUndefined();

        const loadButton = Array.from(container.querySelectorAll('button')).find(button => (
            button.textContent?.includes('Load comparison')
        )) as HTMLButtonElement | undefined;
        expect(loadButton).toBeTruthy();

        flushSync(() => {
            loadButton?.click();
        });
        await flushAsyncUpdates();

        expect(getMasterScheduleMock).toHaveBeenCalledWith('team-1', '10-Weekday');
        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].masterBaseline).toEqual([masterTable]);
        expect(container.textContent).toContain('Matched');
        expect(container.textContent).toContain('New');
        expect(container.textContent).toContain('Removed');
    });

    it('can hide loaded master deltas without discarding the comparison summary', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        const currentTable = makeTable('10 (Weekday) (North)', [makeTrip('draft-a', 'North', 365)]);
        const masterTable = makeTable('10 (North)', [makeTrip('master-a', 'North', 360)]);
        getMasterScheduleMock.mockResolvedValue({
            content: {
                northTable: masterTable,
            },
        });

        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={[currentTable]}
                    originalSchedules={[currentTable]}
                    editorSessionKey={1}
                    bands={[]}
                    analysis={[]}
                    segmentNames={[]}
                    onUpdateSchedules={vi.fn()}
                    projectName="Test Project"
                    teamId="team-1"
                    routeIdentity="10-Weekday"
                    routeLabel="Route 10 · Weekday"
                    approvedRuntimeContract={null}
                    approvedRuntimeModel={null}
                />
            );
        });

        const loadButton = Array.from(container.querySelectorAll('button')).find(button => (
            button.textContent?.includes('Load comparison')
        )) as HTMLButtonElement | undefined;

        flushSync(() => {
            loadButton?.click();
        });
        await flushAsyncUpdates();

        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].masterBaseline).toEqual([masterTable]);

        const hideButton = Array.from(container.querySelectorAll('button')).find(button => (
            button.textContent?.includes('Hide deltas')
        )) as HTMLButtonElement | undefined;
        expect(hideButton).toBeTruthy();

        flushSync(() => {
            hideButton?.click();
        });

        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].masterBaseline).toBeNull();
        expect(container.textContent).toContain('Matched');
    });

    it('shows an unavailable state when no published master exists', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        const currentTable = makeTable('10 (Weekday) (North)', [makeTrip('draft-a', 'North', 365)]);
        getMasterScheduleMock.mockResolvedValue(null);

        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={[currentTable]}
                    originalSchedules={[currentTable]}
                    editorSessionKey={1}
                    bands={[]}
                    analysis={[]}
                    segmentNames={[]}
                    onUpdateSchedules={vi.fn()}
                    projectName="Test Project"
                    teamId="team-1"
                    routeIdentity="10-Weekday"
                    routeLabel="Route 10 · Weekday"
                    approvedRuntimeContract={null}
                    approvedRuntimeModel={null}
                />
            );
        });

        const loadButton = Array.from(container.querySelectorAll('button')).find(button => (
            button.textContent?.includes('Load comparison')
        )) as HTMLButtonElement | undefined;

        flushSync(() => {
            loadButton?.click();
        });
        await flushAsyncUpdates();

        expect(container.textContent).toContain('No published master found');
        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].masterBaseline).toBeUndefined();
    });

    it('lets the planner set a Step 4 target headway from the review tools modal', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        const currentTable = makeTable('10 (Weekday) (North)', [
            makeTrip('draft-a', 'North', 365),
            makeTrip('draft-b', 'North', 395, { blockId: '10-2' }),
        ]);

        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={[currentTable]}
                    originalSchedules={[currentTable]}
                    editorSessionKey={1}
                    bands={[]}
                    analysis={[]}
                    segmentNames={[]}
                    onUpdateSchedules={vi.fn()}
                    projectName="Test Project"
                    teamId="team-1"
                    routeIdentity="10-Weekday"
                    routeLabel="Route 10 · Weekday"
                    approvedRuntimeContract={null}
                    approvedRuntimeModel={null}
                />
            );
        });

        expect(container.textContent).toContain('Set target');
        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].targetHeadway).toBeUndefined();

        const setTargetButton = Array.from(container.querySelectorAll('button')).find(button => (
            button.textContent?.trim() === 'Set target'
        )) as HTMLButtonElement | undefined;
        expect(setTargetButton).toBeTruthy();

        flushSync(() => {
            setTargetButton?.click();
        });

        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Set target headway');

        const useTargetButton = Array.from(container.querySelectorAll('button')).find(button => (
            button.textContent?.trim() === 'Use target'
        )) as HTMLButtonElement | undefined;
        expect(useTargetButton).toBeTruthy();

        flushSync(() => {
            useTargetButton?.click();
        });
        await flushAsyncUpdates();

        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].targetHeadway).toBe(30);
        expect(container.textContent).toContain('30 min');
    });

    it('keeps undo available when edited schedules sync back from the parent', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        const originalTable = makeTable('10 (Weekday) (North)', [makeTrip('draft-a', 'North', 365)]);
        const editedTable = makeTable('10 (Weekday) (North)', [makeTrip('draft-a', 'North', 366)]);
        const onUpdateSchedules = vi.fn();

        const renderStep = (initialSchedules: MasterRouteTable[]) => {
            root?.render(
                <Step4Schedule
                    initialSchedules={initialSchedules}
                    originalSchedules={[originalTable]}
                    editorSessionKey={1}
                    bands={[]}
                    analysis={[]}
                    segmentNames={[]}
                    onUpdateSchedules={onUpdateSchedules}
                    projectName="Test Project"
                    teamId="team-1"
                    routeIdentity="10-Weekday"
                    routeLabel="Route 10 · Weekday"
                    approvedRuntimeContract={null}
                    approvedRuntimeModel={null}
                />
            );
        };

        flushSync(() => {
            renderStep([originalTable]);
        });

        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].canUndo).toBe(false);

        flushSync(() => {
            scheduleEditorSpy.mock.calls.at(-1)?.[0].onSchedulesChange([editedTable]);
        });
        await flushAsyncUpdates();

        expect(onUpdateSchedules).toHaveBeenLastCalledWith([editedTable]);
        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].canUndo).toBe(true);

        flushSync(() => {
            renderStep([editedTable]);
        });
        await flushAsyncUpdates();

        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].canUndo).toBe(true);

        flushSync(() => {
            scheduleEditorSpy.mock.calls.at(-1)?.[0].undo();
        });
        await flushAsyncUpdates();

        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].schedules).toEqual([originalTable]);
        expect(scheduleEditorSpy.mock.calls.at(-1)?.[0].canRedo).toBe(true);
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
        expect(latestCall?.initialTimepointOnly).toBe(true);
        expect(latestCall?.condensedTimepointView).toBe(true);
        expect(latestCall?.initialShowDeltas).toBe(false);
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
        expect(latestCall?.initialTimepointOnly).toBe(true);
        expect(latestCall?.condensedTimepointView).toBe(true);
        expect(latestCall?.initialShowDeltas).toBe(false);
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

    it('does not immediately sync unchanged initial schedules back to the wizard parent', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        const initialSchedules = [{ routeName: '10 (Weekday) (North)', stops: [], trips: [] }] as any[];
        const onUpdateSchedules = vi.fn();

        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={initialSchedules}
                    originalSchedules={initialSchedules}
                    editorSessionKey={1}
                    bands={[]}
                    analysis={[]}
                    segmentNames={[]}
                    onUpdateSchedules={onUpdateSchedules}
                    projectName="Test Project"
                    approvedRuntimeContract={null}
                    approvedRuntimeModel={null}
                />
            );
        });

        expect(onUpdateSchedules).not.toHaveBeenCalled();
    });

});
