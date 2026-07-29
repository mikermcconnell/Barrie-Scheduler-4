import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Step3Build, type ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
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

    it('autofills route-based strict defaults from the route number', async () => {
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
                        routeNumber: '2',
                        cycleTime: 60,
                        blocks: [],
                    }}
                    setConfig={setConfig}
                    teamId={undefined}
                    stopSuggestions={[]}
                    autofillFromMaster={false}
                    onAutofillFromMasterChange={() => {}}
                />
            );
        });

        await Promise.resolve();
        await Promise.resolve();

        expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({
            routeNumber: '2',
            cycleMode: 'Strict',
            cycleTime: 90,
        }));
    });

    it('autofills floating routes once and still lets the planner override the reference cycle', async () => {
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
                        routeNumber: '12',
                        cycleMode: 'Strict',
                        cycleTime: 60,
                        recoveryRatio: 0,
                        blocks: [],
                        recoveryDistribution: 'End',
                    }}
                    setConfig={setConfig}
                    teamId={undefined}
                    stopSuggestions={[]}
                    autofillFromMaster={false}
                    onAutofillFromMasterChange={() => {}}
                />
            );
        });

        await Promise.resolve();
        await Promise.resolve();

        expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({
            routeNumber: '12',
            cycleMode: 'Floating',
            cycleTime: 60,
            recoveryRatio: 15,
        }));

        setConfig.mockClear();

        const numberInputs = Array.from(container.querySelectorAll('input[type="number"]')) as HTMLInputElement[];

        flushSync(() => {
            const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setNativeValue?.call(numberInputs[0], '72');
            numberInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
            numberInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({
            routeNumber: '12',
            cycleTime: 72,
        }));
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

    it('autofills cycle mode from saved master metadata when available', async () => {
        vi.mocked(getMasterSchedule).mockResolvedValue({
            entry: {} as any,
            content: {
                northTable: {
                    routeName: '8 (Weekday) (North)',
                    stops: ['A', 'B'],
                    stopIds: {},
                    trips: [
                        {
                            id: 'n1',
                            blockId: '8-1',
                            direction: 'North',
                            tripNumber: 1,
                            rowId: 1,
                            startTime: 360,
                            endTime: 390,
                            recoveryTime: 8,
                            travelTime: 30,
                            cycleTime: 38,
                            stops: { A: '6:00 AM', B: '6:30 AM' },
                            assignedBand: 'A',
                        },
                    ],
                },
                southTable: {
                    routeName: '8 (Weekday) (South)',
                    stops: ['B', 'A'],
                    stopIds: {},
                    trips: [
                        {
                            id: 's1',
                            blockId: '8-1',
                            direction: 'South',
                            tripNumber: 2,
                            rowId: 2,
                            startTime: 400,
                            endTime: 430,
                            recoveryTime: 10,
                            travelTime: 30,
                            cycleTime: 40,
                            stops: { B: '6:40 AM', A: '7:10 AM' },
                            assignedBand: 'B',
                        },
                    ],
                },
                metadata: {
                    routeNumber: '8',
                    dayType: 'Weekday',
                    uploadedAt: '2026-03-31T12:00:00.000Z',
                    cycleMode: 'Floating',
                },
            },
        } as any);

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
                        cycleMode: 'Strict',
                        cycleTime: 60,
                        recoveryRatio: 15,
                        blocks: [],
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

        expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({
            cycleMode: 'Floating',
        }));
    });

    it('normalizes master block starts back onto a strict clockface grid', async () => {
        vi.mocked(getMasterSchedule).mockResolvedValue({
            entry: {} as any,
            content: {
                northTable: {
                    routeName: '2 (Weekday) (North)',
                    stops: ['Terminal', 'North End'],
                    stopIds: {},
                    trips: [
                        {
                            id: 'n1',
                            blockId: '2-1',
                            direction: 'North',
                            tripNumber: 1,
                            rowId: 1,
                            startTime: 360,
                            endTime: 386,
                            recoveryTime: 4,
                            travelTime: 26,
                            cycleTime: 30,
                            stops: { Terminal: '6:00 AM', 'North End': '6:26 AM' },
                            assignedBand: 'C',
                        },
                        {
                            id: 'n2',
                            blockId: '2-2',
                            direction: 'North',
                            tripNumber: 1,
                            rowId: 2,
                            startTime: 393,
                            endTime: 419,
                            recoveryTime: 4,
                            travelTime: 26,
                            cycleTime: 30,
                            stops: { Terminal: '6:33 AM', 'North End': '6:59 AM' },
                            assignedBand: 'C',
                        },
                    ],
                },
                southTable: {
                    routeName: '2 (Weekday) (South)',
                    stops: ['North End', 'Terminal'],
                    stopIds: {},
                    trips: [
                        {
                            id: 's1',
                            blockId: '2-1',
                            direction: 'South',
                            tripNumber: 2,
                            rowId: 3,
                            startTime: 390,
                            endTime: 416,
                            recoveryTime: 4,
                            travelTime: 26,
                            cycleTime: 30,
                            stops: { 'North End': '6:30 AM', Terminal: '6:56 AM' },
                            assignedBand: 'C',
                        },
                        {
                            id: 's2',
                            blockId: '2-2',
                            direction: 'South',
                            tripNumber: 2,
                            rowId: 4,
                            startTime: 423,
                            endTime: 449,
                            recoveryTime: 4,
                            travelTime: 26,
                            cycleTime: 30,
                            stops: { 'North End': '7:03 AM', Terminal: '7:29 AM' },
                            assignedBand: 'C',
                        },
                    ],
                },
                metadata: {
                    routeNumber: '2',
                    dayType: 'Weekday',
                    uploadedAt: '2026-03-31T12:00:00.000Z',
                    cycleMode: 'Strict',
                },
            },
        } as any);

        const Wrapper = () => {
            const [config, setConfig] = React.useState<ScheduleConfig>({
                routeNumber: '2',
                cycleMode: 'Strict',
                cycleTime: 60,
                recoveryRatio: 15,
                blocks: [],
            });

            return (
                <Step3Build
                    dayType="Weekday"
                    bands={[]}
                    config={config}
                    setConfig={setConfig}
                    teamId="team-1"
                    stopSuggestions={[]}
                    autofillFromMaster={true}
                    onAutofillFromMasterChange={() => {}}
                />
            );
        };

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(<Wrapper />);
        });

        for (let i = 0; i < 5; i++) {
            await Promise.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        const timeInputs = Array.from(container.querySelectorAll('input[type="time"]')) as HTMLInputElement[];
        expect(timeInputs.length).toBeGreaterThanOrEqual(4);
        expect(timeInputs[0]?.value).toBe('06:00');
        expect(timeInputs[2]?.value).toBe('06:30');
    });

    it('presents the Master as the baseline, marks planner edits, and can reset or start blank', async () => {
        vi.mocked(getMasterSchedule).mockResolvedValue({
            entry: {
                currentVersion: 4,
                publishedAt: new Date('2026-07-20T12:00:00.000Z'),
            } as any,
            content: {
                northTable: {
                    routeName: '8 (Weekday) (North)',
                    stops: ['Park Place', 'Georgian College'],
                    stopIds: {},
                    trips: [{
                        id: 'n1', blockId: '8-1', direction: 'North', tripNumber: 1, rowId: 1,
                        startTime: 360, endTime: 390, recoveryTime: 8, travelTime: 30, cycleTime: 38,
                        stops: { 'Park Place': '6:00 AM', 'Georgian College': '6:30 AM' }, assignedBand: 'A',
                    }],
                },
                southTable: {
                    routeName: '8 (Weekday) (South)',
                    stops: ['Georgian College', 'Park Place'],
                    stopIds: {},
                    trips: [{
                        id: 's1', blockId: '8-1', direction: 'South', tripNumber: 2, rowId: 2,
                        startTime: 400, endTime: 430, recoveryTime: 10, travelTime: 30, cycleTime: 40,
                        stops: { 'Georgian College': '6:40 AM', 'Park Place': '7:10 AM' }, assignedBand: 'B',
                    }],
                },
                metadata: {
                    routeNumber: '8', dayType: 'Weekday', uploadedAt: '2026-07-20T12:00:00.000Z', cycleMode: 'Floating',
                },
            },
        } as any);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const changeRoute = vi.fn();

        const Wrapper = () => {
            const [autofill, setAutofill] = React.useState(true);
            const [config, setConfig] = React.useState<ScheduleConfig>({
                routeNumber: '8', cycleMode: 'Floating', cycleTime: 60, recoveryRatio: 15, blocks: [],
            });
            return (
                <Step3Build
                    dayType="Weekday"
                    bands={[]}
                    config={config}
                    setConfig={setConfig}
                    teamId="team-1"
                    stopSuggestions={[]}
                    autofillFromMaster={autofill}
                    onAutofillFromMasterChange={setAutofill}
                    onChangeRoute={changeRoute}
                />
            );
        };

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        flushSync(() => root?.render(<Wrapper />));

        for (let i = 0; i < 5; i++) {
            await Promise.resolve();
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        expect(container.textContent).toContain('Current Master v4 · Route 8 · Weekday');
        expect(container.textContent).toContain('1 block carried forward');
        expect(container.textContent).toContain('Proposed Block Configuration');
        expect(container.textContent).toContain('Matches Master · 1 block');
        expect(container.textContent).not.toContain('From Master');
        const changeRouteButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Change in Step 1')) as HTMLButtonElement;
        flushSync(() => changeRouteButton.click());
        expect(changeRoute).toHaveBeenCalledOnce();

        const startTime = container.querySelector('input[type="time"]') as HTMLInputElement;
        flushSync(() => {
            const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setNativeValue?.call(startTime, '06:05');
            startTime.dispatchEvent(new Event('input', { bubbles: true }));
            startTime.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(container.textContent).toContain('1 edited');
        const resetButton = container.querySelector('button[aria-label="Reset 8-1 to Master"]') as HTMLButtonElement;
        expect(resetButton).not.toBeNull();
        flushSync(() => resetButton.click());
        expect((container.querySelector('input[type="time"]') as HTMLInputElement).value).toBe('06:00');

        const startBlankButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent?.includes('Start blank')) as HTMLButtonElement;
        flushSync(() => startBlankButton.click());

        expect(confirmSpy).toHaveBeenCalled();
        expect(container.textContent).toContain('Blank / manually configured');
        expect(container.textContent).toContain('No blocks defined. Add a block to start.');
    });

    it('labels post-midnight block endings as the next service day', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <Step3Build
                    dayType="Weekday"
                    bands={[]}
                    config={{
                        routeNumber: '12',
                        cycleMode: 'Floating',
                        cycleTime: 60,
                        recoveryRatio: 15,
                        blocks: [{
                            id: '12-1',
                            startTime: '05:09',
                            endTime: '00:33',
                            startStop: 'Georgian Mall',
                            endStop: 'Georgian Mall',
                        }],
                    }}
                    setConfig={() => {}}
                    teamId={undefined}
                    stopSuggestions={[]}
                    autofillFromMaster={false}
                    onAutofillFromMasterChange={() => {}}
                />
            );
        });

        expect(container.textContent).toContain('+1 day');
        expect(container.querySelector('[aria-label="Calculated from generated trips"]')).not.toBeNull();
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
