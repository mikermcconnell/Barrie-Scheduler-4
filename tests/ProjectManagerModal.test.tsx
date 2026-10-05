import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { NewScheduleProject } from '../utils/services/newScheduleProjectService';
import type { MasterRouteTable } from '../utils/parsers/masterScheduleParser';

const {
    getAllProjectsMock,
    getProjectMock,
    deleteProjectMock,
    duplicateProjectMock,
} = vi.hoisted(() => ({
    getAllProjectsMock: vi.fn(),
    getProjectMock: vi.fn(),
    deleteProjectMock: vi.fn(),
    duplicateProjectMock: vi.fn(),
}));

vi.mock('../utils/services/newScheduleProjectService', () => ({
    getAllProjects: getAllProjectsMock,
    getProject: getProjectMock,
    deleteProject: deleteProjectMock,
    duplicateProject: duplicateProjectMock,
}));

import { ProjectManagerModal } from '../components/NewSchedule/ProjectManagerModal';

async function flushPromises() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

describe('ProjectManagerModal', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        getAllProjectsMock.mockReset();
        getProjectMock.mockReset();
        deleteProjectMock.mockReset();
        duplicateProjectMock.mockReset();
    });

    afterEach(() => {
        if (root) {
            flushSync(() => {
                root?.unmount();
            });
        }
        container?.remove();
        root = null;
        container = null;
    });

    const renderModal = (props?: Partial<React.ComponentProps<typeof ProjectManagerModal>>) => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        flushSync(() => {
            root?.render(
                <ProjectManagerModal
                    isOpen={true}
                    userId="user-1"
                    onClose={() => {}}
                    onLoadProject={() => {}}
                    onNewProject={() => {}}
                    {...props}
                />
            );
        });
    };

    it('passes the fully loaded generated project directly to the generated-schedule handler', async () => {
        const schedules: MasterRouteTable[] = [{ routeName: '10 (North)', stops: [], stopIds: {}, trips: [] }];

        const listedProject: NewScheduleProject = {
            id: 'project-1',
            name: 'Generated Project',
            dayType: 'Weekday',
            routeNumber: '10',
            isGenerated: true,
            updatedAt: new Date('2026-03-18T12:00:00Z'),
            createdAt: new Date('2026-03-18T11:00:00Z'),
            generatedSchedules: [],
            originalGeneratedSchedules: [],
            analysis: [],
            bands: [],
        };

        const fullProject: NewScheduleProject = {
            ...listedProject,
            generatedSchedules: schedules,
            originalGeneratedSchedules: schedules,
            parsedData: [],
            config: { routeNumber: '10', cycleTime: 60, recoveryRatio: 15, blocks: [] },
            importMode: 'performance',
            autofillFromMaster: true,
        };

        getAllProjectsMock.mockResolvedValue([listedProject]);
        getProjectMock.mockResolvedValue(fullProject);

        const onLoadGeneratedSchedule = vi.fn();
        renderModal({ onLoadGeneratedSchedule });
        await flushPromises();
        flushSync(() => {});

        const projectButton = Array.from(container?.querySelectorAll('button') || []).find((button) =>
            button.textContent?.includes('Generated Project')
        );
        expect(projectButton).toBeTruthy();

        flushSync(() => {
            projectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flushPromises();
        flushSync(() => {});

        const openButton = Array.from(container?.querySelectorAll('button') || []).find((button) =>
            button.textContent?.includes('Open Schedule')
        );
        expect(openButton).toBeTruthy();

        flushSync(() => {
            openButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flushPromises();

        expect(getProjectMock).toHaveBeenCalledTimes(1);
        expect(onLoadGeneratedSchedule).toHaveBeenCalledWith(fullProject);
    });

    it('keeps the current project open when the parent blocks starting a new project', async () => {
        getAllProjectsMock.mockResolvedValue([]);
        const onBeforeProjectSwitch = vi.fn().mockResolvedValue(false);
        const onNewProject = vi.fn();
        const onClose = vi.fn();

        renderModal({ onBeforeProjectSwitch, onNewProject, onClose });
        await flushPromises();

        const newProjectButton = Array.from(container?.querySelectorAll('button') || []).find(
            button => button.textContent?.includes('New Project')
        );
        flushSync(() => {
            newProjectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flushPromises();

        expect(onBeforeProjectSwitch).toHaveBeenCalledWith({ destination: 'new' });
        expect(onNewProject).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('checks the parent guard before loading a saved project', async () => {
        const listedProject: NewScheduleProject = {
            id: 'project-2',
            name: 'In Progress Project',
            dayType: 'Saturday',
            routeNumber: '8A',
            isGenerated: false,
            updatedAt: new Date('2026-03-18T12:00:00Z'),
            createdAt: new Date('2026-03-18T11:00:00Z'),
            generatedSchedules: [],
            originalGeneratedSchedules: [],
            analysis: [],
            bands: [],
        };
        getAllProjectsMock.mockResolvedValue([listedProject]);
        const onBeforeProjectSwitch = vi.fn().mockResolvedValue(false);
        const onLoadProject = vi.fn();
        const onClose = vi.fn();

        renderModal({ onBeforeProjectSwitch, onLoadProject, onClose });
        await flushPromises();

        const projectButton = Array.from(container?.querySelectorAll('button') || []).find(
            button => button.textContent?.includes('In Progress Project')
        );
        flushSync(() => {
            projectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        const resumeButton = Array.from(container?.querySelectorAll('button') || []).find(
            button => button.textContent?.includes('Resume Wizard')
        );
        flushSync(() => {
            resumeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await flushPromises();

        expect(onBeforeProjectSwitch).toHaveBeenCalledWith({
            destination: 'wizard',
            project: listedProject,
        });
        expect(onLoadProject).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });
});
