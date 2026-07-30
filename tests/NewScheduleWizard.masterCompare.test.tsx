import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { NewScheduleWizard } from '../components/NewSchedule/NewScheduleWizard';
import { getAllStopsWithCodes, getMasterSchedule } from '../utils/services/masterScheduleService';
import { resetLegacyRuntimeProject, saveProject } from '../utils/services/newScheduleProjectService';
import type { NewScheduleProject } from '../utils/services/newScheduleProjectService';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';
import type { BandSegmentAverage, TripBucketAnalysis, TimeBand } from '../utils/ai/runtimeAnalysis';
import type { ScheduleConfig } from '../components/NewSchedule/steps/Step3Build';
import type { RuntimeData } from '../components/NewSchedule/utils/csvParser';
import type { ApprovedRuntimeContract } from '../components/NewSchedule/utils/step2ReviewTypes';
import type { OrderedSegmentColumn } from '../components/NewSchedule/utils/wizardState';

const {
    toast,
    saveMock,
    clearMock,
    step4Spy,
    headerSpy,
    generatedProject,
    completeMasterResult,
} = vi.hoisted(() => {
    const emptyBlocks: ScheduleConfig['blocks'] = [];
    const emptyAnalysis: TripBucketAnalysis[] = [];
    const emptyBands: TimeBand[] = [];
    const emptyParsedData: RuntimeData[] = [];
    const emptyStrings: string[] = [];
    const eligibleBucket: TripBucketAnalysis = {
        timeBucket: '06:30 - 06:59',
        totalP50: 20,
        totalP80: 24,
        assignedBand: 'A',
        ignored: false,
        isOutlier: false,
        expectedSegmentCount: 1,
        observedSegmentCount: 1,
        sampleCountMode: 'observations',
        details: [{ segmentName: 'A to B', p50: 20, p80: 24, n: 10 }],
        evidence: {
            kind: 'uploaded-percentiles',
            qualifyingCount: 10,
            requiredCount: 10,
            planningEligible: true,
            exclusionReasons: emptyStrings,
        },
    };

    const baseTable = (routeName: string): MasterRouteTable => ({
        routeName,
        stops: ['Terminal'],
        stopIds: {},
        trips: [],
    });

    return {
        toast: {
            success: vi.fn(),
            error: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
        },
        saveMock: vi.fn(),
        clearMock: vi.fn(),
        step4Spy: vi.fn(),
        headerSpy: vi.fn(),
        generatedProject: {
            id: 'project-1',
            name: 'Loaded Project',
            dayType: 'Weekday' as const,
            isGenerated: true,
            config: {
                routeNumber: '10',
                cycleTime: 60,
                recoveryRatio: 15,
                blocks: emptyBlocks,
            },
            generatedSchedules: [
                baseTable('10 (Weekday) (North)'),
                baseTable('10 (Weekday) (South)'),
            ],
            originalGeneratedSchedules: [
                baseTable('10 (Weekday) (North)'),
                baseTable('10 (Weekday) (South)'),
            ],
            analysis: emptyAnalysis,
            bands: emptyBands,
            parsedData: emptyParsedData,
            approvedRuntimeContract: {
                schemaVersion: 2,
                routeIdentity: '10-Weekday',
                routeNumber: '10',
                dayType: 'Weekday',
                importMode: 'csv',
                inputFingerprint: 'test',
                approvalState: 'approved',
                readinessStatus: 'ready',
                approvedAt: '2026-04-01T00:00:00.000Z',
                sourceSnapshot: {},
                planning: {
                    chartBasis: 'uploaded-percentiles',
                    generationBasis: 'direction-band-summary',
                    buckets: [eligibleBucket],
                    reviewBuckets: [eligibleBucket],
                    approvedBuckets: [eligibleBucket],
                    bands: [{ id: 'A', label: 'Band A', min: 20, max: 20, avg: 20, color: '#ef4444', count: 1 }],
                    directionBandSummary: {
                        North: [{
                            bandId: 'A',
                            color: '#ef4444',
                            avgTotal: 20,
                            segments: [] as BandSegmentAverage[],
                            timeSlots: ['06:30'],
                        }],
                    },
                    segmentColumns: [{ segmentName: 'A to B' }] satisfies OrderedSegmentColumn[],
                    canonicalDirectionStops: { North: ['A', 'B'] },
                    usableBucketCount: 1,
                    ignoredBucketCount: 0,
                    usableBandCount: 1,
                    directions: ['North'],
                },
                healthSnapshot: {
                    status: 'ready',
                    blockers: emptyStrings,
                    warnings: emptyStrings,
                    expectedDirections: 1,
                    matchedDirections: ['North'],
                    expectedSegmentCount: 1,
                    matchedSegmentCount: 1,
                    missingSegments: emptyStrings,
                    availableBucketCount: 1,
                    completeBucketCount: 1,
                    incompleteBucketCount: 0,
                    lowConfidenceBucketCount: 0,
                    runtimeSourceSummary: 'Uploaded CSV with verified counts',
                    confidenceThreshold: 10,
                    usesLegacyRuntimeLogic: false,
                },
            } satisfies ApprovedRuntimeContract,
            createdAt: new Date('2026-04-01T00:00:00.000Z'),
            updatedAt: new Date('2026-04-01T00:00:00.000Z'),
        } satisfies NewScheduleProject,
        completeMasterResult: {
            content: {
                northTable: baseTable('10 (North)'),
                southTable: baseTable('10 (South)'),
            },
        },
    };
});

vi.mock('../components/NewSchedule/steps/Step1Upload', () => ({
    Step1Upload: (): React.ReactElement => React.createElement('div', null, 'Mock Step 1'),
}));

vi.mock('../components/NewSchedule/steps/Step2Analysis', () => ({
    Step2Analysis: (): React.ReactElement => React.createElement('div', null, 'Mock Step 2'),
}));

vi.mock('../components/NewSchedule/steps/Step3Build', () => ({
    Step3Build: (): React.ReactElement => React.createElement('div', null, 'Mock Step 3'),
}));

vi.mock('../components/NewSchedule/steps/Step4Schedule', () => ({
    Step4Schedule: (props: any): React.ReactElement => {
        step4Spy(props);
        return React.createElement(
            'div',
            { id: 'step-4-proxy' },
            'Step 4 proxy'
        );
    },
}));

vi.mock('../components/NewSchedule/NewScheduleHeader', () => ({
    NewScheduleHeader: (props: any): React.ReactElement => {
        headerSpy(props);
        return React.createElement('div', { id: 'header-proxy' }, 'Header proxy');
    },
}));

vi.mock('../components/NewSchedule/ProjectManagerModal', () => ({
    ProjectManagerModal: (props: any): React.ReactElement => React.createElement(
        'button',
        {
            id: 'load-generated-project',
            onClick: () => props.onLoadGeneratedSchedule(generatedProject),
        },
        'Load Generated Project'
    ),
}));

vi.mock('../components/modals/UploadToMasterModal', () => ({
    UploadToMasterModal: (): null => null,
}));

vi.mock('../components/NewSchedule/step2/Step2ApprovalFooter', () => ({
    Step2ApprovalFooter: (): null => null,
}));

vi.mock('../hooks/usePerformanceData', () => ({
    usePerformanceMetadataQuery: (): { data: null; isLoading: boolean } => ({
        data: null,
        isLoading: false,
    }),
    usePerformanceDataQuery: (): { data: null; isLoading: boolean } => ({
        data: null,
        isLoading: false,
    }),
}));

vi.mock('../hooks/useWizardProgress', () => ({
    useWizardProgress: () => ({
        save: saveMock,
        clear: clearMock,
    }),
}));

vi.mock('../components/contexts/AuthContext', () => ({
    useAuth: () => ({
        user: { uid: 'user-1' },
    }),
}));

vi.mock('../components/contexts/TeamContext', () => ({
    useTeam: () => ({
        team: { id: 'team-1' },
        hasTeam: true,
    }),
}));

vi.mock('../components/contexts/ToastContext', () => ({
    useToast: () => toast,
}));

vi.mock('../utils/services/newScheduleProjectService', () => ({
    saveProject: vi.fn(),
    getProject: vi.fn(),
    getAllProjects: vi.fn().mockResolvedValue([]),
    resetLegacyRuntimeProject: vi.fn().mockResolvedValue(1),
    StaleNewScheduleProjectError: class StaleNewScheduleProjectError extends Error {},
}));

vi.mock('../utils/services/masterScheduleService', () => ({
    prepareUpload: vi.fn(),
    uploadToMasterSchedule: vi.fn(),
    getMasterSchedule: vi.fn(),
    getAllStopsWithCodes: vi.fn(),
}));

describe('NewScheduleWizard compare to master', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        vi.useRealTimers();
        if (root) {
            flushSync(() => {
                root?.unmount();
            });
        }
        container?.remove();
        root = null;
        container = null;
        vi.clearAllMocks();
        saveMock.mockClear();
        clearMock.mockClear();
        step4Spy.mockClear();
        headerSpy.mockClear();
    });

    const renderWizard = () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(<NewScheduleWizard onBack={() => undefined} />);
        });
    };

    const click = (selector: string) => {
        const element = container?.querySelector(selector) as HTMLButtonElement | null;
        if (!element) throw new Error(`Missing element: ${selector}`);
        flushSync(() => {
            element.click();
        });
    };

    const flushPromises = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    };

    it('does not restore Step 4 when the saved v2 approval cannot be validated against a review', async () => {
        vi.mocked(getAllStopsWithCodes).mockResolvedValue({ stops: [], stopCodes: {} });
        vi.mocked(getMasterSchedule).mockResolvedValue(completeMasterResult as any);

        renderWizard();
        click('#load-generated-project');
        await flushPromises();

        expect(step4Spy).not.toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(headerSpy.mock.calls.at(-1)?.[0].currentStep).toBe(2);
        });
        expect(container?.textContent).not.toContain('Upload to Master');
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('blocks a header jump to Step 4 before the current runtime review is approved', async () => {
        renderWizard();

        flushSync(() => {
            headerSpy.mock.calls.at(-1)?.[0].onStepClick(4);
        });
        await flushPromises();

        expect(headerSpy.mock.calls.at(-1)?.[0].currentStep).toBe(1);
        expect(step4Spy).not.toHaveBeenCalled();
        expect(toast.warning).toHaveBeenCalledWith(
            'Trusted Runtime Required',
            expect.stringContaining('Build the Step 2 runtime review')
        );
    });

    it('durably resets legacy runtime artifacts before reporting the project reset', async () => {
        const mutableProject = generatedProject as NewScheduleProject;
        const originalContract = mutableProject.approvedRuntimeContract;
        mutableProject.approvedRuntimeContract = undefined;
        mutableProject.projectRevision = 7;

        try {
            renderWizard();
            click('#load-generated-project');

            await vi.waitFor(() => {
                expect(resetLegacyRuntimeProject).toHaveBeenCalledWith(
                    'user-1',
                    'project-1',
                    { expectedRevision: 7 }
                );
            });
            expect(toast.info).toHaveBeenCalledWith(
                'Runtime Review Reset',
                expect.stringContaining('removed from the saved project')
            );
            expect(headerSpy.mock.calls.at(-1)?.[0].currentStep).toBe(1);
        } finally {
            mutableProject.approvedRuntimeContract = originalContract;
            delete mutableProject.projectRevision;
        }
    });

    it('serializes cloud saves and advances the exact project revision', async () => {
        let finishFirstSave!: (projectId: string) => void;
        vi.mocked(saveProject)
            .mockImplementationOnce(() => new Promise(resolve => {
                finishFirstSave = resolve;
            }))
            .mockResolvedValueOnce('project-1');

        renderWizard();
        click('#load-generated-project');
        await vi.waitFor(() => {
            expect(headerSpy.mock.calls.at(-1)?.[0].currentStep).toBe(2);
        });

        const rename = headerSpy.mock.calls.at(-1)?.[0].onRenameProject;
        const firstRename = rename('First queued name');
        const secondRename = rename('Second queued name');

        await vi.waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1));
        expect(vi.mocked(saveProject).mock.calls[0]?.[2]).toEqual({ expectedRevision: 0 });

        finishFirstSave('project-1');
        await Promise.all([firstRename, secondRename]);

        expect(saveProject).toHaveBeenCalledTimes(2);
        expect(vi.mocked(saveProject).mock.calls[1]?.[2]).toEqual({ expectedRevision: 1 });
        expect(vi.mocked(saveProject).mock.calls[1]?.[1]).toEqual(
            expect.objectContaining({ id: 'project-1', name: 'Second queued name' })
        );
    });

});
