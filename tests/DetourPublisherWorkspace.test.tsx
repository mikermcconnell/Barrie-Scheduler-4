import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const persistence = vi.hoisted(() => ({
    list: vi.fn(async () => []),
    load: vi.fn(async () => null),
    save: vi.fn(async ({ notice }: { notice: Record<string, unknown> }) => ({
        ...notice,
        id: notice.id || 'notice-1',
        revision: Number(notice.revision ?? 0) + 1,
        updatedAt: new Date('2026-07-16T12:00:00Z'),
    })),
    remove: vi.fn(async () => undefined),
    duplicate: vi.fn(async () => undefined),
    post: vi.fn(async () => undefined),
}));
const context = vi.hoisted(() => ({
    user: { uid: 'user-1' },
    team: { id: 'team-1', name: 'Barrie Transit' },
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock('../components/contexts/AuthContext', () => ({ useAuth: () => ({ user: context.user }) }));
vi.mock('../components/contexts/TeamContext', () => ({ useTeam: () => ({ team: context.team }) }));
vi.mock('../components/contexts/ToastContext', () => ({
    useToast: () => context.toast,
}));
vi.mock('../utils/detours/detourNoticeService', () => ({
    DetourRevisionConflictError: class DetourRevisionConflictError extends Error {},
    listDetourNotices: persistence.list,
    loadDetourNotice: persistence.load,
    saveDetourNotice: persistence.save,
    deleteDetourNotice: persistence.remove,
    duplicateDetourNotice: persistence.duplicate,
    markDetourPosted: persistence.post,
}));
vi.mock('../utils/route-planner-2/routePlanner2GtfsClient', () => ({
    loadRoutePlanner2GtfsImportPatterns: vi.fn(async () => [{
        id: 'pattern-8b', routeId: 'route-8b', routeShortName: '8B', routeLongName: 'Crosstown',
        serviceId: 'weekday', dayTypeLabel: 'Weekday', directionId: 1, tripHeadsign: 'Southbound',
        tripCount: 20, stopCount: 2, shapePointCount: 2,
        stops: [
            { stopId: 'a', gtfsStopId: 'a', stopCode: '101', name: 'First', lat: 44.39, lng: -79.70, sequence: 1 },
            { stopId: 'b', gtfsStopId: 'b', stopCode: '102', name: 'Second', lat: 44.38, lng: -79.68, sequence: 2 },
        ],
        shapePoints: [
            { lat: 44.39, lng: -79.70, sequence: 1 },
            { lat: 44.38, lng: -79.68, sequence: 2 },
        ],
    }]),
}));
vi.mock('../components/detours/DetourMapCanvas', () => ({
    DetourMapCanvas: React.forwardRef(function MockMap(
        { overlay }: { overlay: { routeSnapshot: { routeShortName: string } } },
        _ref,
    ) {
        return <div data-testid="detour-map">Map for {overlay.routeSnapshot.routeShortName}</div>;
    }),
}));
vi.mock('../components/detours/DetourNoticePreview', () => ({
    DetourNoticePreview: React.forwardRef(function MockPreview(_props: unknown, _ref) {
        return <div>Notice preview</div>;
    }),
}));

import { DetourPublisherWorkspace } from '../components/workspaces/DetourPublisherWorkspace';

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes(label));
}

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

describe('DetourPublisherWorkspace', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        persistence.list.mockClear();
        persistence.save.mockClear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('opens the team notice library and starts a route-detour draft', async () => {
        await act(async () => root.render(<DetourPublisherWorkspace onClose={vi.fn()} />));
        await flush();
        expect(persistence.list).toHaveBeenCalledWith('team-1');
        expect(container.textContent).toContain('Detour Publisher');
        act(() => findButton(container, 'New detour')?.click());
        expect(container.textContent).toContain('Routes and tools');
        expect(container.textContent).toContain('Add a route to start mapping');
    });

    it('imports a current GTFS pattern into the editable notice', async () => {
        await act(async () => root.render(<DetourPublisherWorkspace onClose={vi.fn()} />));
        await flush();
        act(() => findButton(container, 'New detour')?.click());
        act(() => findButton(container, 'Choose GTFS route')?.click());
        await flush();
        const pattern = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Route 8B'));
        expect(pattern).toBeTruthy();
        act(() => pattern?.click());
        expect(container.textContent).toContain('Map for 8B');
        expect(container.textContent).toContain('Southbound');
    });
});
