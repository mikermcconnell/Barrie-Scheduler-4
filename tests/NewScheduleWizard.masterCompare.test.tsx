import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { NewScheduleWizard } from '../components/NewSchedule/NewScheduleWizard';
import { getAllStopsWithCodes, getMasterSchedule } from '../utils/services/masterScheduleService';

const {
    toast,
    saveMock,
    clearMock,
    step4Spy,
    headerSpy,
    generatedProject,
    completeMasterResult,
} = vi.hoisted(() => {
    const baseTable = (routeName: string) => ({
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
                blocks: [],
            },
            generatedSchedules: [
                baseTable('10 (Weekday) (North)'),
                baseTable('10 (Weekday) (South)'),
            ],
            originalGeneratedSchedules: [
                baseTable('10 (Weekday) (North)'),
                baseTable('10 (Weekday) (South)'),
            ],
            analysis: [],
            bands: [],
            parsedData: [],
            approvedRuntimeContract: {
                schemaVersion: 1,
                routeIdentity: '10-Weekday',
                routeNumber: '10',
                dayType: 'Weekday',
                importMode: 'performance',
                inputFingerprint: 'test',
                approvalState: 'approved',
                readinessStatus: 'ready',
                approvedAt: '2026-04-01T00:00:00.000Z',
                sourceSnapshot: {},
                planning: {
                    chartBasis: 'observed-cycle',
                    generationBasis: 'direction-band-summary',
                    buckets: [],
                    bands: [],
                    directionBandSummary: {},
                    segmentColumns: [],
                    usableBucketCount: 0,
                    ignoredBucketCount: 0,
                    usableBandCount: 0,
                    directions: [],
                },
                healthSnapshot: {
                    status: 'ready',
                    blockers: [],
                    warnings: [],
                    expectedDirections: 0,
                    matchedDirections: [],
                    expectedSegmentCount: 0,
                    matchedSegmentCount: 0,
                    missingSegments: [],
                    availableBucketCount: 0,
                    completeBucketCount: 0,
                    incompleteBucketCount: 0,
                    lowConfidenceBucketCount: 0,
                    runtimeSourceSummary: 'none',
                    confidenceThreshold: 5,
                    usesLegacyRuntimeLogic: false,
                },
            },
        },
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
            props.masterBaseline ? 'Master baseline active' : 'Master baseline inactive'
        );
    },
}));

vi.mock('../components/NewSchedule/NewScheduleHeader', () => ({
    NewScheduleHeader: (props: any): React.ReactElement => {
        headerSpy(props);
        return React.createElement(
            'button',
            {
                id: 'toggle-master-compare',
                disabled: !props.compareAvailable || props.isCompareLoading,
                onClick: props.onToggleMasterCompare,
            },
            props.isMasterCompareActive ? 'Master compare on' : 'Master compare off'
        );
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

    it('loads compare mode and turns it back off cleanly without refetching', async () => {
        vi.mocked(getAllStopsWithCodes).mockResolvedValue({ stops: [], stopCodes: {} });
        vi.mocked(getMasterSchedule).mockResolvedValue(completeMasterResult as any);

        renderWizard();
        click('#load-generated-project');
        await flushPromises();

        click('#toggle-master-compare');
        await flushPromises();
        const callsAfterEnable = vi.mocked(getMasterSchedule).mock.calls.length;
        click('#toggle-master-compare');
        await flushPromises();

        expect(callsAfterEnable).toBeGreaterThan(0);
        expect(vi.mocked(getMasterSchedule).mock.calls.length).toBe(callsAfterEnable);
        expect(getMasterSchedule).toHaveBeenCalledWith('team-1', '10-Weekday');
        expect(step4Spy.mock.calls.at(-1)?.[0].masterBaseline).toBeNull();
        expect(headerSpy.mock.calls.at(-1)?.[0].isMasterCompareActive).toBe(false);
        expect(toast.error).not.toHaveBeenCalled();
    });
});
