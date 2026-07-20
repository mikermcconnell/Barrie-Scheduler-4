import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DetourRouteOverlay } from '../utils/detours/detourTypes';

vi.mock('../components/shared/MapBase', () => ({
    MapBase: ({ children, onClick }: { children: React.ReactNode; onClick?: (event: unknown) => void }) => (
        <div data-testid="map-base" onClick={() => onClick?.({ lngLat: { lng: -79.68, lat: 44.39 }, features: [] })}>
            {children}
        </div>
    ),
}));

vi.mock('react-map-gl/mapbox', () => ({
    Source: ({ children, id }: { children: React.ReactNode; id: string }) => <div data-source-id={id}>{children}</div>,
    Layer: (): React.ReactNode => null,
    Marker: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { DetourMapCanvas } from '../components/detours/DetourMapCanvas';

function createOverlay(source: 'road-snapped' | 'manual' = 'road-snapped'): DetourRouteOverlay {
    const importedAt = '2026-07-16T12:00:00.000Z';
    return {
        id: 'overlay-1',
        routeSnapshot: {
            importedAt,
            routeId: '8A',
            routeShortName: '8A',
            routeColor: '#2563eb',
            directionLabel: 'Northbound',
            isLoop: false,
            originalGeometry: [
                { longitude: -79.70, latitude: 44.38 },
                { longitude: -79.67, latitude: 44.40 },
            ],
            stops: [],
        },
        closureStart: null,
        closureEnd: null,
        closureGeometry: {
            coordinates: [],
            source: 'gtfs',
            manualRoutingAcknowledged: true,
        },
        detourWaypoints: [
            { longitude: -79.70, latitude: 44.38 },
            { longitude: -79.68, latitude: 44.39 },
        ],
        detourGeometry: {
            coordinates: [
                { longitude: -79.70, latitude: 44.38 },
                { longitude: -79.68, latitude: 44.39 },
            ],
            source,
            manualRoutingAcknowledged: false,
        },
        stopImpacts: [],
        labels: [],
        busSuitabilityConfirmed: false,
        createdAt: new Date(importedAt),
        updatedAt: new Date(importedAt),
    };
}

describe('DetourMapCanvas', () => {
    let container: HTMLDivElement;
    let root: Root;
    const callbacks = {
        onSelectClosureStart: vi.fn(),
        onSelectClosureEnd: vi.fn(),
        onAddWaypoint: vi.fn(),
        onMoveWaypoint: vi.fn(),
        onDeleteWaypoint: vi.fn(),
        onAddTemporaryStop: vi.fn(),
        onMoveTemporaryStop: vi.fn(),
        onConfirmStopImpact: vi.fn(),
    };

    beforeEach(() => {
        Object.values(callbacks).forEach((callback) => callback.mockReset());
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('shows route context and warns planners about unacknowledged manual routing', () => {
        act(() => root.render(<DetourMapCanvas overlay={createOverlay('manual')} {...callbacks} />));
        expect(container.textContent).toContain('8A · Northbound');
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('Review bus suitability');
    });

    it('adds a waypoint at a map click in waypoint mode', () => {
        act(() => root.render(<DetourMapCanvas overlay={createOverlay()} mode="add-waypoint" {...callbacks} />));
        act(() => container.querySelector('[data-testid="map-base"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(callbacks.onAddWaypoint).toHaveBeenCalledWith({ longitude: -79.68, latitude: 44.39 });
    });

    it('selects and deletes waypoint handles without freehand editing', () => {
        const onSelectItem = vi.fn();
        act(() => root.render(<DetourMapCanvas overlay={createOverlay()} onSelectItem={onSelectItem} {...callbacks} />));
        const waypoint = container.querySelector('[aria-label="Detour waypoint 1"]')!;
        act(() => waypoint.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(onSelectItem).toHaveBeenCalledWith({ type: 'waypoint', index: 0 });
        act(() => waypoint.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        expect(callbacks.onDeleteWaypoint).toHaveBeenCalledWith(0);
    });

    it('renders each additional affected route as a full detour overlay', () => {
        const second = { ...createOverlay(), id: 'overlay-2' };
        act(() => root.render(
            <DetourMapCanvas overlay={createOverlay()} additionalOverlays={[second]} {...callbacks} />,
        ));
        expect(container.querySelector('[data-source-id="detour-additional-0-original-source"]')).not.toBeNull();
        expect(container.querySelector('[data-source-id="detour-additional-0-closure-source"]')).not.toBeNull();
        expect(container.querySelector('[data-source-id="detour-additional-0-active-source"]')).not.toBeNull();
        expect(container.querySelector('[data-source-id="detour-additional-0-stops-source"]')).not.toBeNull();
    });
});
