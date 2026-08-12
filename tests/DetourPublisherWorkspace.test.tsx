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
const mapHarness = vi.hoisted(() => ({
    captureImage: vi.fn(async () => 'data:image/png;base64,map'),
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
    }, {
        id: 'pattern-8b-short', routeId: 'route-8b', routeShortName: '8B', routeLongName: 'Crosstown',
        serviceId: 'weekday', dayTypeLabel: 'Weekday', directionId: 0, tripHeadsign: 'Short turn',
        tripCount: 30, stopCount: 1, shapePointCount: 1,
        stops: [{ stopId: 'a', gtfsStopId: 'a', stopCode: '101', name: 'First', lat: 44.39, lng: -79.70, sequence: 1 }],
        shapePoints: [{ lat: 44.39, lng: -79.70, sequence: 1 }],
    }, {
        id: 'pattern-7a-saturday', routeId: 'route-7a', routeShortName: '7A', routeLongName: 'Grove',
        serviceId: 'saturday', dayTypeLabel: 'Saturday', directionId: 0, tripHeadsign: 'Downtown',
        tripCount: 20, stopCount: 2, shapePointCount: 2, stops: [], shapePoints: [],
    }]),
}));
vi.mock('../components/detours/DetourMapCanvas', () => ({
    DetourMapCanvas: React.forwardRef(function MockMap(
        { overlay, publicationMode, onAddTemporaryStop, onSelectItem, onSelectClosureStart, onSelectClosureEnd }: {
            overlay: {
                routeSnapshot: { routeShortName: string };
                stopImpacts: Array<{ id: string; temporaryStopCode?: string }>;
                streetLabels?: Array<{ streetName: string }>;
            };
            publicationMode?: boolean;
            onAddTemporaryStop: (coordinate: { latitude: number; longitude: number }) => void;
            onSelectItem?: (selection: { type: 'stop-impact'; id: string }) => void;
            onSelectClosureStart: (anchor: { segmentIndex: number; fraction: number; coordinate: { latitude: number; longitude: number } }) => void;
            onSelectClosureEnd: (anchor: { segmentIndex: number; fraction: number; coordinate: { latitude: number; longitude: number } }) => void;
        },
        _ref,
    ) {
        React.useImperativeHandle(_ref, () => ({
            captureImage: mapHarness.captureImage,
            fitToNotice: vi.fn(),
        }));
        const temporary = overlay.stopImpacts.find(impact => impact.id.startsWith('temporary-'));
        return <div data-testid="detour-map" data-publication-mode={String(Boolean(publicationMode))}>
            Map for {overlay.routeSnapshot.routeShortName}
            <button type="button" onClick={() => onSelectClosureStart({ segmentIndex: 0, fraction: 0, coordinate: { latitude: 44.39, longitude: -79.70 } })}>Mock closure start</button>
            <button type="button" onClick={() => onSelectClosureEnd({ segmentIndex: 0, fraction: 1, coordinate: { latitude: 44.38, longitude: -79.68 } })}>Mock closure end</button>
            <button type="button" onClick={() => onAddTemporaryStop({ latitude: 44.39, longitude: -79.68 })}>Mock add temporary stop</button>
            {temporary && <button type="button" onClick={() => onSelectItem?.({ type: 'stop-impact', id: temporary.id })}>Mock select temporary stop</button>}
            {temporary?.temporaryStopCode && <span>Temporary code {temporary.temporaryStopCode}</span>}
            {(overlay.streetLabels?.length ?? 0) > 0 && <span>Street labels {overlay.streetLabels?.map(label => label.streetName).join(',')}</span>}
        </div>;
    }),
}));
vi.mock('../components/detours/DetourNoticePreview', () => ({
    DetourNoticePreview: React.forwardRef(function MockPreview({ stopSheet }: { stopSheet?: { stopCode?: string; stopName: string } }, _ref) {
        return <div>{stopSheet ? `Stop sheet ${stopSheet.stopCode || stopSheet.stopName}` : 'Notice preview'}</div>;
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
        mapHarness.captureImage.mockClear();
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
        expect(container.textContent).not.toContain('MyRide summary');
        expect(container.textContent).toContain('Start time (optional)');
        expect((container.querySelector('input[type="time"]') as HTMLInputElement | null)?.value).toBe('');
    });

    it('imports a current GTFS pattern into the editable notice', async () => {
        await act(async () => root.render(<DetourPublisherWorkspace onClose={vi.fn()} />));
        await flush();
        act(() => findButton(container, 'New detour')?.click());
        act(() => findButton(container, 'Choose route')?.click());
        await flush();
        expect(container.textContent).not.toContain('Route 7A');
        expect(Array.from(container.querySelectorAll('button')).filter(button => button.textContent?.includes('Route 8B'))).toHaveLength(1);
        const route = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Route 8B'));
        expect(route?.textContent).toContain('Full route · 2 stops');
        act(() => route?.click());
        expect(container.textContent).toContain('Map for 8B');
        expect(container.textContent).toContain('Southbound');
        expect(container.querySelector('[data-testid="detour-map"]')?.getAttribute('data-publication-mode')).toBe('false');
        act(() => findButton(container, 'Public view')?.click());
        expect(container.querySelector('[data-testid="detour-map"]')?.getAttribute('data-publication-mode')).toBe('true');
        expect(container.textContent).toContain('Line anchors and editing handles are hidden.');
        act(() => findButton(container, 'Return to editing')?.click());
        expect(container.querySelector('[data-testid="detour-map"]')?.getAttribute('data-publication-mode')).toBe('false');
    });

    it('edits a temporary stop code from the right sidebar', async () => {
        await act(async () => root.render(<DetourPublisherWorkspace onClose={vi.fn()} />));
        await flush();
        act(() => findButton(container, 'New detour')?.click());
        act(() => findButton(container, 'Choose route')?.click());
        await flush();
        const route = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Route 8B'));
        act(() => route?.click());
        act(() => findButton(container, 'Mock add temporary stop')?.click());
        act(() => findButton(container, 'Mock select temporary stop')?.click());

        const code = container.querySelector('input[placeholder="e.g. 959"]') as HTMLInputElement;
        expect(code).toBeTruthy();
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(code, '959');
            code.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(container.textContent).toContain('Temporary code 959');
        expect(container.textContent).toContain('Stop status');
        act(() => findButton(container, 'Remove temporary stop')?.click());
        expect(container.textContent).not.toContain('Temporary code 959');
        expect(container.textContent).not.toContain('Remove temporary stop');
    });

    it('returns to authoring mode when the preview closes', async () => {
        await act(async () => root.render(<DetourPublisherWorkspace onClose={vi.fn()} />));
        await flush();
        act(() => findButton(container, 'New detour')?.click());
        act(() => findButton(container, 'Choose route')?.click());
        await flush();
        const route = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Route 8B'));
        act(() => route?.click());

        await act(async () => findButton(container, 'Preview & export')?.click());
        await flush();
        expect(container.textContent).toContain('Notice preview');
        expect(container.querySelector('[data-testid="detour-map"]')?.getAttribute('data-publication-mode')).toBe('true');
        act(() => (container.querySelector('[aria-label="Close preview and return to editing"]') as HTMLButtonElement | null)?.click());
        expect(container.textContent).not.toContain('Notice preview');
        expect(container.querySelector('[data-testid="detour-map"]')?.getAttribute('data-publication-mode')).toBe('false');
    });

    it('previews a derived temporary-stop sheet with a stop-specific map capture', async () => {
        await act(async () => root.render(<DetourPublisherWorkspace onClose={vi.fn()} />));
        await flush();
        act(() => findButton(container, 'New detour')?.click());
        act(() => findButton(container, 'Choose route')?.click());
        await flush();
        act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Route 8B'))?.click());
        act(() => findButton(container, 'Mock add temporary stop')?.click());
        act(() => findButton(container, 'Mock select temporary stop')?.click());
        const code = container.querySelector('input[placeholder="e.g. 959"]') as HTMLInputElement;
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(code, '1420');
            code.dispatchEvent(new Event('input', { bubbles: true }));
        });

        await act(async () => findButton(container, 'Preview & export')?.click());
        await flush();
        expect(container.textContent).toContain('2 pages: 1 master, 0 closed stop, 1 temporary stop.');
        await act(async () => findButton(container, 'Temporary 1420')?.click());
        await flush();
        expect(container.textContent).toContain('Stop sheet 1420');
        expect(mapHarness.captureImage).toHaveBeenCalledWith('image/png', undefined, {
            kind: 'temporary',
            position: { latitude: 44.39, longitude: -79.68 },
        });
    });

    it('authors public street labels and exposes invalidated closure labels for reconfirmation', async () => {
        await act(async () => root.render(<DetourPublisherWorkspace onClose={vi.fn()} />));
        await flush();
        act(() => findButton(container, 'New detour')?.click());
        act(() => findButton(container, 'Choose route')?.click());
        await flush();
        act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Route 8B'))?.click());
        act(() => findButton(container, 'Mock closure start')?.click());
        act(() => findButton(container, 'Mock closure end')?.click());
        await flush();

        const enterStreet = (placeholder: string, value: string) => {
            const input = container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
            act(() => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            act(() => (input.parentElement?.querySelector('button') as HTMLButtonElement | null)?.click());
        };

        enterStreet('Closed-section street', 'Shanty Bay Rd');
        enterStreet('Detour street', 'Blake St');
        expect(container.textContent).toContain('Street labels Shanty Bay Rd,Blake St');
        expect(container.textContent).not.toContain('Generic public labels are currently in use.');

        act(() => findButton(container, 'Mock closure end')?.click());
        expect(container.textContent).toContain('Pending review');
        expect(container.textContent).toContain('NO SERVICE ON');
        act(() => findButton(container, 'Confirm')?.click());
        expect(container.textContent).not.toContain('Generic public labels are currently in use.');
    });

    it('adds a street label on demand and positions it without consuming line clicks', async () => {
        await act(async () => root.render(<DetourPublisherWorkspace onClose={vi.fn()} />));
        await flush();
        act(() => findButton(container, 'New detour')?.click());
        act(() => findButton(container, 'Choose route')?.click());
        await flush();
        act(() => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Route 8B'))?.click());
        act(() => findButton(container, 'Mock closure start')?.click());
        act(() => findButton(container, 'Mock closure end')?.click());
        await flush();

        const input = container.querySelector('input[placeholder="Detour street"]') as HTMLInputElement;
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Blake St');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => (input.parentElement?.querySelector('button') as HTMLButtonElement | null)?.click());
        expect(container.textContent).toContain('Street labels Blake St');

        const slider = container.querySelector('input[aria-label="Street label position along path"]') as HTMLInputElement;
        expect(slider.value).toBe('50');
        act(() => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(slider, '75');
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect((container.querySelector('input[aria-label="Street label position along path"]') as HTMLInputElement).value).toBe('75');
    });
});
