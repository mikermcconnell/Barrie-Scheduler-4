import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStrategicWorkplanBaseline } from '../utils/strategic-plan/workplanBaseline';
import { StrategicWorkplanWorkspace } from '../components/Analytics/StrategicWorkplanWorkspace';

const loadWorkplan = vi.fn();
const saveWorkplan = vi.fn();

vi.mock('../utils/strategic-plan/workplanService', () => ({
    loadStrategicWorkplan: (...args: unknown[]) => loadWorkplan(...args),
    saveStrategicWorkplan: (...args: unknown[]) => saveWorkplan(...args),
    listStrategicWorkplanVersions: vi.fn().mockResolvedValue([]),
}));

describe('StrategicWorkplanWorkspace', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(async () => {
        loadWorkplan.mockReset();
        saveWorkplan.mockReset();
        loadWorkplan.mockResolvedValue(null);
        saveWorkplan.mockImplementation(async (_teamId, workplan) => ({ ...workplan, revision: 1 }));
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => {
            root.render(<StrategicWorkplanWorkspace teamId="team-a" userId="planner-a" userLabel="Planner A" onBack={vi.fn()} />);
            await Promise.resolve();
            await Promise.resolve();
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('opens on the editable Update Desk with the source-labelled baseline', () => {
        expect(container.textContent).toContain('Project Work Plan');
        expect(container.textContent).toContain('Dillon Consulting Limited');
        expect(container.textContent).toContain('73');
        expect(container.textContent).toContain('Needs status');
        expect(container.textContent).toContain('Project Initiation Meeting');
    });

    it('switches between the Full Schedule and leadership Timeline views', () => {
        const fullSchedule = Array.from(container.querySelectorAll('[role="tab"]')).find(tab => tab.textContent?.includes('Full Schedule')) as HTMLButtonElement;
        act(() => fullSchedule.click());
        expect(fullSchedule.getAttribute('aria-selected')).toBe('true');
        expect(container.textContent).toContain('Jul 2026');

        const timeline = Array.from(container.querySelectorAll('[role="tab"]')).find(tab => tab.textContent?.includes('Timeline')) as HTMLButtonElement;
        act(() => timeline.click());
        expect(timeline.getAttribute('aria-selected')).toBe('true');
        expect(container.textContent).toContain('Stakeholder Engagement');
        expect(container.textContent).toContain('Working session 7');
    });

    it('explains version history before the baseline is first published', () => {
        const history = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('History')) as HTMLButtonElement;
        act(() => history.click());
        expect(container.textContent).toContain('Shared version history');
        expect(container.textContent).toContain('Publish the baseline to create the first version.');
    });

    it('updates status and publishes the first shared revision', async () => {
        const status = container.querySelector('[aria-label="1.01 status"]') as HTMLSelectElement;
        act(() => {
            status.value = 'in-progress';
            status.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(container.textContent).toContain('Unsaved changes');

        const publish = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Publish baseline')) as HTMLButtonElement;
        await act(async () => {
            publish.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(saveWorkplan).toHaveBeenCalledOnce();
        const saved = saveWorkplan.mock.calls[0][1] as ReturnType<typeof createStrategicWorkplanBaseline>;
        expect(saved.tasks.find(task => task.wbs === '1.01')?.status).toBe('in-progress');
        expect(container.textContent).toContain('Shared revision 1');
    });
});
