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
} = vi.hoisted(() => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
    },
    saveMock: vi.fn(),
    clearMock: vi.fn(),
}));

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
    Step4Schedule: (): React.ReactElement => React.createElement('div', null, 'Mock Step 4'),
}));

vi.mock('../components/NewSchedule/NewScheduleHeader', () => ({
    NewScheduleHeader: (): React.ReactElement => React.createElement('div', null, 'Mock Header'),
}));

vi.mock('../components/NewSchedule/ProjectManagerModal', () => ({
    ProjectManagerModal: (): null => null,
}));

vi.mock('../components/modals/UploadToMasterModal', () => ({
    UploadToMasterModal: (): null => null,
}));

vi.mock('../components/NewSchedule/step2/Step2ApprovalFooter', () => ({
    Step2ApprovalFooter: (): null => null,
}));

vi.mock('../hooks/usePerformanceData', () => ({
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

describe('NewScheduleWizard canonical master loading', () => {
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
    });

    it('loads canonical master stop columns once per route instead of reloading in a loop', async () => {
        vi.mocked(getAllStopsWithCodes).mockResolvedValue({ stops: [], stopCodes: {} });
        vi.mocked(getMasterSchedule).mockResolvedValue({
            content: {
                northTable: { stops: ['Downtown', 'Cundles', 'Georgian Mall'] },
                southTable: { stops: ['Georgian Mall', 'Cundles', 'Downtown'] },
            },
        } as any);

        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <NewScheduleWizard onBack={() => undefined} />
            );
        });

        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(getAllStopsWithCodes).toHaveBeenCalledTimes(1);
        expect(getMasterSchedule).toHaveBeenCalledTimes(1);
        expect(getMasterSchedule).toHaveBeenCalledWith('team-1', '10-Weekday');
    });
});
