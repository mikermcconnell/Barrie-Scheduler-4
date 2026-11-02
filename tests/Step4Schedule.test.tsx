import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

const scheduleEditorSpy = vi.fn();
const getMasterScheduleMock = vi.fn();

vi.mock('../components/ScheduleEditor', () => ({
    ScheduleEditor: (props: any) => {
        scheduleEditorSpy(props);
        return (
            <div data-testid={props.readOnly ? 'compare-schedule-editor-proxy' : 'schedule-editor-proxy'}>
                {props.readOnly ? 'read-only compare schedule editor' : 'schedule editor'}
                {props.reviewToolsSlot}
            </div>
        );
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

    it('loads a published master comparison on demand and opens a read-only schedule/delta popup', async () => {
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
        expect(container.querySelector('[data-testid="step4-schedule-shell"]')?.className).not.toContain('-m-8');
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
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Compare to master');
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('read-only compare schedule editor');
        const compareEditorProps = scheduleEditorSpy.mock.calls
            .map(call => call[0])
            .find(props => props.readOnly === true);
        expect(compareEditorProps).toMatchObject({
            schedules: [currentTable],
            masterBaseline: [masterTable],
            readOnly: true,
            embedded: true,
            hideSidebar: true,
            useAuthoritativeTimepoints: true,
            initialTimepointOnly: true,
            condensedTimepointView: true,
        });
        expect(compareEditorProps?.initialShowDeltas).toBe(true);
        expect(container.textContent).toContain('Matched');
        expect(container.textContent).toContain('New');
        expect(container.textContent).toContain('Removed');
    });

    it('can reopen and close the loaded master comparison popup without adding deltas to the main editor', async () => {
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

        expect(container.querySelector('[role="dialog"]')).toBeTruthy();
        expect(scheduleEditorSpy.mock.calls[0]?.[0].masterBaseline).toBeUndefined();

        const closeButton = Array.from(container.querySelectorAll('button')).find(button => (
            button.getAttribute('aria-label') === 'Close master comparison popup'
        )) as HTMLButtonElement | undefined;
        expect(closeButton).toBeTruthy();

        flushSync(() => {
            closeButton?.click();
        });

        expect(container.querySelector('[role="dialog"]')).toBeNull();
        expect(container.textContent).toContain('Matched');

        const openButton = Array.from(container.querySelectorAll('button')).find(button => (
            button.textContent?.includes('Open schedule comparison')
        )) as HTMLButtonElement | undefined;
        expect(openButton).toBeTruthy();

        flushSync(() => {
            openButton?.click();
        });

        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('read-only compare schedule editor');
        const reopenedCompareEditorProps = scheduleEditorSpy.mock.calls
            .map(call => call[0])
            .filter(props => props.readOnly === true)
            .at(-1);
        expect(reopenedCompareEditorProps?.masterBaseline).toEqual([masterTable]);
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

    // Two blocks, 30 min apart, with a fixed recovery that lets the headway drift.
    const buildDriftingRoute = (): MasterRouteTable[] => {
        const leg = (id: string, blockId: string, direction: 'North' | 'South', start: number, travel: number, recovery: number): MasterTrip => {
            const [first, last] = direction === 'North' ? ['Park Place', 'Downtown'] : ['Downtown', 'Park Place'];
            const toClock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
            return {
                id,
                blockId,
                direction,
                tripNumber: 1,
                rowId: start,
                startTime: start,
                endTime: start + travel + recovery,
                travelTime: travel,
                recoveryTime: recovery,
                cycleTime: travel + recovery,
                stops: { [first]: toClock(start), [last]: toClock(start + travel + recovery) },
                stopMinutes: { [first]: start, [last]: start + travel + recovery },
                arrivalTimes: { [first]: toClock(start), [last]: toClock(start + travel) },
                recoveryTimes: { [last]: recovery },
            } as MasterTrip;
        };
        const north: MasterTrip[] = [];
        const south: MasterTrip[] = [];
        ['2-1', '2-2'].forEach((blockId, blockIndex) => {
            let start = 360 + blockIndex * 30;
            for (let n = 0; n < 4; n += 1) {
                north.push(leg(`${blockId}-n${n}`, blockId, 'North', start, 25, 5));
                const southTrip = leg(`${blockId}-s${n}`, blockId, 'South', start + 30, 25 + n * 2, 12);
                south.push(southTrip);
                start = southTrip.endTime;
            }
        });
        return [
            { routeName: '2 (Weekday) (North)', stops: ['Park Place', 'Downtown'], stopIds: {}, trips: north },
            { routeName: '2 (Weekday) (South)', stops: ['Downtown', 'Park Place'], stopIds: {}, trips: south },
        ];
    };

    it('passes estimated target headways to the editor and reports a typed target', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        const onHeadwayTargetsChange = vi.fn();
        const schedules = buildDriftingRoute();

        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={schedules}
                    originalSchedules={schedules}
                    editorSessionKey={1}
                    bands={[]}
                    analysis={[]}
                    segmentNames={[]}
                    onUpdateSchedules={vi.fn()}
                    projectName="Test Project"
                    approvedRuntimeContract={null}
                    approvedRuntimeModel={null}
                    headwayTargets={{}}
                    onHeadwayTargetsChange={onHeadwayTargetsChange}
                />
            );
        });

        const props = scheduleEditorSpy.mock.calls.at(-1)?.[0];
        const cells = Object.entries(props.headwayTargets as Record<string, { value: number; typed: boolean }>);
        expect(cells.length).toBeGreaterThan(0);
        expect(cells.every(([, cell]) => !cell.typed && [10, 15, 30, 45, 60].includes(cell.value))).toBe(true);

        const [rowKey] = cells[0];
        props.onHeadwayTargetChange(rowKey, 45);
        expect(onHeadwayTargetsChange).toHaveBeenCalledWith({ [rowKey]: 45 });
    });

    it('fixes headways in one schedule update and keeps trips and blocks', async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        const onUpdateSchedules = vi.fn();
        const schedules = buildDriftingRoute();

        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={schedules}
                    originalSchedules={schedules}
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

        const fixButton = Array.from(container.querySelectorAll('button')).find(button => (
            button.textContent?.trim() === 'Fix headways'
        )) as HTMLButtonElement | undefined;
        expect(fixButton).toBeTruthy();

        flushSync(() => {
            fixButton?.click();
        });
        await flushAsyncUpdates();

        expect(onUpdateSchedules).toHaveBeenCalledTimes(1);
        const fixed = onUpdateSchedules.mock.calls[0][0] as MasterRouteTable[];
        const tripIds = (tables: MasterRouteTable[]) => tables.flatMap(table => table.trips.map(trip => `${trip.id}:${trip.blockId}`)).sort();
        expect(tripIds(fixed)).toEqual(tripIds(schedules));
        expect(container.querySelector('[role="status"]')?.textContent).toMatch(/^Set \d+ recover/);
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
                        schemaVersion: 2,
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
                            reviewBuckets: [],
                            approvedBuckets: [{
                                timeBucket: '06:00 - 06:29', totalP50: 40, totalP80: 44,
                                assignedBand: 'A', isOutlier: false, ignored: false, details: [],
                            }],
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

    it('fails closed instead of using live Step 4 runtime inputs without an approved contract', () => {
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
        expect(latestCall?.bands).toEqual([]);
        expect(latestCall?.analysis).toEqual([]);
        expect(latestCall?.segmentNames).toEqual([]);
        expect(container.textContent).not.toContain('Approved runtime contract');
        expect(container.textContent).toContain('Current runtime approval required');
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

    it('opens the editor comparing against the generated baseline when asked', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        const initialSchedules = [{ routeName: '10 (Weekday) (North)', stops: [], trips: [] }] as any[];

        flushSync(() => {
            root?.render(
                <Step4Schedule
                    initialSchedules={initialSchedules}
                    originalSchedules={initialSchedules}
                    editorSessionKey={1}
                    bands={[]}
                    analysis={[]}
                    segmentNames={[]}
                    onUpdateSchedules={vi.fn()}
                    projectName="Test Project"
                    approvedRuntimeContract={null}
                    approvedRuntimeModel={null}
                    compareGeneratedByDefault
                />
            );
        });

        const editorCall = scheduleEditorSpy.mock.calls.map(call => call[0]).filter(props => !props.readOnly).at(-1);
        expect(editorCall?.initialShowDeltas).toBe(true);
        expect(editorCall?.originalSchedules).toEqual(initialSchedules);
    });

});
