import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DetourRouteOverlay } from '../utils/detours/detourTypes';

const mapHarness = vi.hoisted(() => ({
    clickFeatures: [] as Array<{ layer: { id: string }; properties?: Record<string, unknown> }>,
    fitBounds: vi.fn(),
    setPaintProperty: vi.fn(),
    getStyle: vi.fn(() => ({ layers: [] })),
    once: vi.fn((_event: string, callback: () => void) => callback()),
    triggerRepaint: vi.fn(),
    loaded: vi.fn(() => true),
    areTilesLoaded: vi.fn(() => true),
    project: vi.fn(() => ({ x: 200, y: 150 })),
    getCanvas: vi.fn(() => ({ toDataURL: vi.fn(() => 'data:image/png;base64,map') })),
}));

vi.mock('../components/shared/MapBase', () => ({
    MapBase: ({ children, onClick, interactive = true, mapRef, onLoad }: { children: React.ReactNode; onClick?: (event: unknown) => void; interactive?: boolean; mapRef?: { current: unknown }; onLoad?: () => void }) => {
        React.useLayoutEffect(() => {
            if (mapRef) mapRef.current = { fitBounds: mapHarness.fitBounds, getMap: () => mapHarness };
            onLoad?.();
        }, [mapRef, onLoad]);
        return (
            <div data-testid="map-base" data-interactive={String(interactive)} onClick={() => onClick?.({ lngLat: { lng: -79.68, lat: 44.39 }, features: mapHarness.clickFeatures })}>
                {children}
            </div>
        );
    },
}));

vi.mock('react-map-gl/mapbox', () => ({
    Source: ({ children, id, data }: { children: React.ReactNode; id: string; data: unknown }) => (
        <div data-source-id={id} data-source-data={JSON.stringify(data)}>{children}</div>
    ),
    Layer: ({ id, layout, paint, filter }: { id: string; layout?: unknown; paint?: unknown; filter?: unknown }) => (
        <div data-layer-id={id} data-layer-layout={JSON.stringify(layout ?? {})} data-layer-paint={JSON.stringify(paint ?? {})} data-layer-filter={JSON.stringify(filter ?? null)} />
    ),
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
        closureWaypoints: [],
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
        onInsertDetourWaypoint: vi.fn(),
        onMoveWaypoint: vi.fn(),
        onDeleteWaypoint: vi.fn(),
        onAddClosureWaypoint: vi.fn(),
        onMoveClosureWaypoint: vi.fn(),
        onDeleteClosureWaypoint: vi.fn(),
        onAddTemporaryStop: vi.fn(),
        onMoveTemporaryStop: vi.fn(),
        onMoveRouteLabel: vi.fn(),
        onConfirmStopImpact: vi.fn(),
    };

    beforeEach(() => {
        Object.values(callbacks).forEach((callback) => callback.mockReset());
        mapHarness.clickFeatures = [];
        mapHarness.fitBounds.mockReset();
        mapHarness.setPaintProperty.mockReset();
        mapHarness.getStyle.mockReset();
        mapHarness.getStyle.mockReturnValue({ layers: [] });
        mapHarness.project.mockReset();
        mapHarness.project.mockReturnValue({ x: 200, y: 150 });
        mapHarness.getCanvas.mockReset();
        mapHarness.getCanvas.mockReturnValue({ toDataURL: vi.fn(() => 'data:image/png;base64,map') });
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

    it('adds the correct anchor when either editable line is clicked in select mode', () => {
        act(() => root.render(<DetourMapCanvas overlay={createOverlay()} mode="select" {...callbacks} />));
        const map = container.querySelector('[data-testid="map-base"]')!;

        mapHarness.clickFeatures = [{ layer: { id: 'detour-active-hit-area' } }];
        act(() => map.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(callbacks.onInsertDetourWaypoint).toHaveBeenCalledWith({ longitude: -79.68, latitude: 44.39 });

        mapHarness.clickFeatures = [{ layer: { id: 'detour-bypassed-hit-area' } }];
        act(() => map.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(callbacks.onAddClosureWaypoint).toHaveBeenCalledWith({ longitude: -79.68, latitude: 44.39 });
    });

    it('does not render start or end closure control-point dots', () => {
        const overlay = createOverlay();
        overlay.closureStart = {
            segmentIndex: 0,
            fraction: 0.25,
            coordinate: { longitude: -79.6925, latitude: 44.385 },
        };
        overlay.closureEnd = {
            segmentIndex: 0,
            fraction: 0.75,
            coordinate: { longitude: -79.6775, latitude: 44.395 },
        };

        act(() => root.render(<DetourMapCanvas overlay={overlay} {...callbacks} />));

        expect(container.querySelector('[data-source-id="detour-closure-source"]')).toBeNull();
        expect(container.querySelector('[data-source-id="detour-bypassed-source"]')).not.toBeNull();
    });

    it('removes the closed segment from the solid original-route underlay', () => {
        const overlay = createOverlay();
        overlay.closureStart = {
            segmentIndex: 0,
            fraction: 0.25,
            coordinate: { longitude: -79.6925, latitude: 44.385 },
        };
        overlay.closureEnd = {
            segmentIndex: 0,
            fraction: 0.75,
            coordinate: { longitude: -79.6775, latitude: 44.395 },
        };
        overlay.closureGeometry.coordinates = [overlay.closureStart.coordinate, overlay.closureEnd.coordinate];

        act(() => root.render(<DetourMapCanvas overlay={overlay} {...callbacks} />));

        const source = container.querySelector('[data-source-id="detour-original-source"]');
        const data = JSON.parse(source?.getAttribute('data-source-data') ?? '{}') as { features?: unknown[] };
        expect(data.features).toHaveLength(2);
    });

    it('shows editable detour endpoints and only deletes interior anchors', () => {
        const onSelectItem = vi.fn();
        const overlay = createOverlay();
        overlay.detourWaypoints = [
            { longitude: -79.70, latitude: 44.38 },
            { longitude: -79.69, latitude: 44.385 },
            { longitude: -79.68, latitude: 44.39 },
        ];
        act(() => root.render(<DetourMapCanvas overlay={overlay} onSelectItem={onSelectItem} {...callbacks} />));
        const start = container.querySelector('[aria-label="Diversion junction"]')!;
        const end = container.querySelector('[aria-label="Rejoin junction"]')!;
        expect(start.className).toContain('bg-blue-600');
        expect(end.className).toContain('bg-blue-600');
        act(() => start.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        expect(callbacks.onDeleteWaypoint).not.toHaveBeenCalled();
        const waypoint = container.querySelector('[aria-label="Detour waypoint 2"]')!;
        act(() => waypoint.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(onSelectItem).toHaveBeenCalledWith({ type: 'waypoint', index: 1 });
        act(() => waypoint.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        expect(callbacks.onDeleteWaypoint).toHaveBeenCalledWith(1);
    });

    it('renders selectable interior closed-section anchors as red diamonds', () => {
        const onSelectItem = vi.fn();
        const overlay = createOverlay();
        overlay.closureWaypoints = [{ longitude: -79.69, latitude: 44.385 }];
        overlay.closureGeometry.coordinates = [
            { longitude: -79.70, latitude: 44.38 },
            overlay.closureWaypoints[0]!,
            { longitude: -79.68, latitude: 44.39 },
        ];
        act(() => root.render(<DetourMapCanvas overlay={overlay} onSelectItem={onSelectItem} {...callbacks} />));
        const anchor = container.querySelector('[aria-label="Closed-section anchor 1"]')!;
        expect(anchor.className).toContain('rotate-45');
        expect(anchor.className).toContain('bg-red-500');
        act(() => anchor.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(onSelectItem).toHaveBeenCalledWith({ type: 'closure-waypoint', index: 0 });
        act(() => anchor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        expect(callbacks.onDeleteClosureWaypoint).toHaveBeenCalledWith(0);
    });

    it('separates the movable route number from the detour-path badge', () => {
        act(() => root.render(<DetourMapCanvas overlay={createOverlay()} {...callbacks} />));
        const arrows = JSON.parse(container.querySelector('[data-layer-id="detour-direction-arrows"]')?.getAttribute('data-layer-layout') ?? '{}') as Record<string, unknown>;
        const badge = JSON.parse(container.querySelector('[data-layer-id="detour-route-badge"]')?.getAttribute('data-layer-layout') ?? '{}') as Record<string, unknown>;
        const routeNumber = JSON.parse(container.querySelector('[data-layer-id="detour-route-number"]')?.getAttribute('data-layer-layout') ?? '{}') as Record<string, unknown>;
        const routeNumberCasing = JSON.parse(container.querySelector('[data-layer-id="detour-route-number-casing"]')?.getAttribute('data-layer-paint') ?? '{}') as Record<string, unknown>;
        const routeNumberPaint = JSON.parse(container.querySelector('[data-layer-id="detour-route-number"]')?.getAttribute('data-layer-paint') ?? '{}') as Record<string, unknown>;
        expect(arrows['text-field']).toEqual(['concat', '▶ ', ['get', 'directionLabel']]);
        expect(arrows['symbol-spacing']).toBe(190);
        expect(arrows['text-size']).toBe(12);
        expect(badge['text-font']).toEqual(['DIN Pro Bold', 'Arial Unicode MS Bold']);
        expect(badge['symbol-placement']).toBe('point');
        expect(badge['text-rotation-alignment']).toBe('map');
        expect(badge['text-rotate']).toEqual(['get', 'angle']);
        expect(badge['text-field']).toBe('DETOUR');
        expect(routeNumber['text-field']).toEqual(['get', 'routeLabel']);
        expect(routeNumber['text-anchor']).toBe('center');
        expect(routeNumber['text-offset']).toEqual([0, 0]);
        expect(routeNumberCasing).toMatchObject({ 'text-color': '#ffffff', 'text-halo-color': '#111827', 'text-halo-width': 9 });
        expect(routeNumberPaint).toMatchObject({ 'text-color': '#ffffff', 'text-halo-color': ['coalesce', ['get', 'color'], '#07557F'], 'text-halo-width': 7 });
        const badgeSource = container.querySelector('[data-source-id="detour-route-badge-source"]');
        const badgeData = JSON.parse(badgeSource?.getAttribute('data-source-data') ?? '{}') as { features?: Array<{ properties?: { angle?: number } }> };
        expect(badgeData.features?.[0]?.properties?.angle).toBeLessThan(0);
        const routeSource = container.querySelector('[data-source-id="detour-route-number-source"]');
        const routeData = JSON.parse(routeSource?.getAttribute('data-source-data') ?? '{}') as { features?: Array<{ geometry?: { coordinates?: number[] }; properties?: { routeLabel?: string } }> };
        expect(routeData.features?.[0]?.properties?.routeLabel).toBe('8A');
        expect(routeData.features?.[0]?.geometry?.coordinates?.[0]).toBeCloseTo(-79.694);
        expect(container.querySelector('[aria-label="Move route 8A label"]')).not.toBeNull();
        const paint = JSON.parse(container.querySelector('[data-layer-id="detour-route-badge"]')?.getAttribute('data-layer-paint') ?? '{}') as Record<string, unknown>;
        expect(paint['text-halo-width']).toBe(5);
    });

    it('frames the publication around notice geometry with fixed print margins', () => {
        const overlay = createOverlay();
        overlay.routeSnapshot.originalGeometry = [
            { longitude: -80.10, latitude: 44.10 },
            { longitude: -79.40, latitude: 44.70 },
        ];
        overlay.closureGeometry.coordinates = [
            { longitude: -79.70, latitude: 44.38 },
            { longitude: -79.69, latitude: 44.39 },
        ];
        overlay.detourGeometry.coordinates = [
            { longitude: -79.70, latitude: 44.38 },
            { longitude: -79.68, latitude: 44.40 },
        ];

        act(() => root.render(<DetourMapCanvas overlay={overlay} {...callbacks} />));

        expect(mapHarness.fitBounds).toHaveBeenCalledWith(
            [[-79.70, 44.38], [-79.68, 44.40]],
            expect.objectContaining({
                padding: { top: 88, right: 88, bottom: 88, left: 88 },
                bearing: 0,
                pitch: 0,
                maxZoom: 16,
            }),
        );
    });

    it('de-emphasizes secondary basemap text while retaining clearer road names', () => {
        mapHarness.getStyle.mockReturnValue({
            layers: [
                { id: 'road-label-primary', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
                { id: 'place-label-city', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
                { id: 'poi-icon', type: 'symbol', layout: { 'icon-image': ['get', 'icon'] } },
            ],
        });

        act(() => root.render(<DetourMapCanvas overlay={createOverlay()} {...callbacks} />));

        expect(mapHarness.setPaintProperty).toHaveBeenCalledWith('road-label-primary', 'text-opacity', 0.58);
        expect(mapHarness.setPaintProperty).toHaveBeenCalledWith('place-label-city', 'text-opacity', 0.3);
        expect(mapHarness.setPaintProperty).not.toHaveBeenCalledWith('poi-icon', 'text-opacity', expect.anything());
    });

    it('captures the current viewport without fitting the entire notice', async () => {
        const ref = React.createRef<import('../components/detours/DetourMapCanvas').DetourMapCanvasHandle>();
        await act(async () => root.render(<DetourMapCanvas ref={ref} overlay={createOverlay()} {...callbacks} />));
        mapHarness.fitBounds.mockClear();

        let captured: string | null = null;
        await act(async () => {
            captured = await ref.current?.captureImage('image/png') ?? null;
        });

        expect(mapHarness.fitBounds).not.toHaveBeenCalled();
        expect(mapHarness.once).toHaveBeenCalledWith('idle', expect.any(Function));
        expect(captured).toBe('data:image/png;base64,map');
    });

    it('draws stop annotations into a separate capture without replacing the master image', async () => {
        const ref = React.createRef<import('../components/detours/DetourMapCanvas').DetourMapCanvasHandle>();
        const onCaptureImage = vi.fn();
        await act(async () => root.render(<DetourMapCanvas ref={ref} overlay={createOverlay()} onCaptureImage={onCaptureImage} {...callbacks} />));
        const sourceCanvas = {
            width: 400, height: 300, clientWidth: 400, clientHeight: 300,
            toDataURL: vi.fn(() => 'data:image/png;base64,master'),
        };
        mapHarness.getCanvas.mockReturnValue(sourceCanvas);
        const context = {
            drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(),
            lineTo: vi.fn(), quadraticCurveTo: vi.fn(), closePath: vi.fn(), stroke: vi.fn(), fill: vi.fn(), fillText: vi.fn(),
        };
        const outputCanvas = {
            width: 0, height: 0, getContext: vi.fn(() => context),
            toDataURL: vi.fn(() => 'data:image/png;base64,annotated'),
        };
        const originalCreateElement = document.createElement.bind(document);
        const createElement = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => (
            tagName.toLowerCase() === 'canvas'
                ? outputCanvas as unknown as HTMLCanvasElement
                : originalCreateElement(tagName, options)
        )) as typeof document.createElement);

        let captured: string | null = null;
        await act(async () => {
            captured = await ref.current?.captureImage('image/png', undefined, {
                kind: 'closed', position: { longitude: -79.68, latitude: 44.39 },
            }) ?? null;
        });
        createElement.mockRestore();

        expect(captured).toBe('data:image/png;base64,annotated');
        expect(context.fillText).toHaveBeenCalledWith('You Are', expect.any(Number), expect.any(Number));
        expect(context.fillText).toHaveBeenCalledWith('Here', expect.any(Number), expect.any(Number));
        expect(onCaptureImage).not.toHaveBeenCalled();
        expect(sourceCanvas.toDataURL).not.toHaveBeenCalled();
    });

    it('labels closed routing and adds an orange outline around the detour path', () => {
        const overlay = createOverlay();
        overlay.closureGeometry.coordinates = [
            { longitude: -79.70, latitude: 44.38 },
            { longitude: -79.68, latitude: 44.40 },
        ];
        act(() => root.render(<DetourMapCanvas overlay={overlay} {...callbacks} />));
        const closedLabel = JSON.parse(container.querySelector('[data-layer-id="detour-bypassed-label"]')?.getAttribute('data-layer-layout') ?? '{}') as Record<string, unknown>;
        const outline = JSON.parse(container.querySelector('[data-layer-id="detour-warning-outline"]')?.getAttribute('data-layer-paint') ?? '{}') as Record<string, unknown>;
        expect(closedLabel['text-field']).toBe('DETOUR CLOSED');
        expect(closedLabel['symbol-placement']).toBe('point');
        expect(closedLabel['text-rotate']).toEqual(['get', 'angle']);
        const closedPaint = JSON.parse(container.querySelector('[data-layer-id="detour-bypassed-label"]')?.getAttribute('data-layer-paint') ?? '{}') as Record<string, unknown>;
        expect(closedPaint).toMatchObject({ 'text-color': '#ffffff', 'text-halo-color': '#b91c1c', 'text-halo-width': 5 });
        const labelSource = container.querySelector('[data-source-id="detour-bypassed-label-source"]');
        const labelData = JSON.parse(labelSource?.getAttribute('data-source-data') ?? '{}') as { features?: Array<{ geometry?: { coordinates?: number[] }; properties?: { angle?: number } }> };
        expect(labelData.features?.[0]?.geometry?.coordinates).toEqual([-79.69, 44.39]);
        expect(labelData.features?.[0]?.properties?.angle).toBeLessThan(-40);
        expect(labelData.features?.[0]?.properties?.angle).toBeGreaterThan(-70);
        expect(outline['line-color']).toBe('#f97316');
        expect(outline['line-width']).toBe(12);
    });

    it('replaces generic status badges with confirmed street-specific public labels', () => {
        const overlay = createOverlay();
        overlay.closureGeometry.coordinates = [
            { longitude: -79.70, latitude: 44.38 },
            { longitude: -79.68, latitude: 44.38 },
        ];
        overlay.detourGeometry.coordinates = [
            { longitude: -79.70, latitude: 44.39 },
            { longitude: -79.68, latitude: 44.39 },
        ];
        overlay.streetLabels = [{
            id: 'closed-street', path: 'closure', streetName: 'Shanty Bay Rd',
            position: { longitude: -79.69, latitude: 44.38 }, source: 'planner', confirmed: true, visible: true,
        }, {
            id: 'detour-street', path: 'detour', streetName: 'Blake St',
            position: { longitude: -79.69, latitude: 44.39 }, source: 'mapbox', confirmed: true, visible: true,
        }];

        act(() => root.render(<DetourMapCanvas overlay={overlay} {...callbacks} />));

        const streetSource = JSON.parse(container.querySelector('[data-source-id="detour-street-label-source"]')?.getAttribute('data-source-data') ?? '{}') as { features?: Array<{ properties?: { label?: string; path?: string } }> };
        expect(streetSource.features?.map(feature => feature.properties)).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: 'closure', label: 'NO SERVICE ON · SHANTY BAY RD' }),
            expect.objectContaining({ path: 'detour', label: 'DETOUR VIA · BLAKE ST' }),
        ]));
        const genericClosed = JSON.parse(container.querySelector('[data-source-id="detour-bypassed-label-source"]')?.getAttribute('data-source-data') ?? '{}') as { features?: unknown[] };
        const genericDetour = JSON.parse(container.querySelector('[data-source-id="detour-route-badge-source"]')?.getAttribute('data-source-data') ?? '{}') as { features?: unknown[] };
        expect(genericClosed.features).toEqual([]);
        expect(genericDetour.features).toEqual([]);
    });

    it('shows pending street labels only while authoring and restores public fallback labels', () => {
        const overlay = createOverlay();
        overlay.closureGeometry.coordinates = [
            { longitude: -79.70, latitude: 44.38 },
            { longitude: -79.68, latitude: 44.38 },
        ];
        overlay.streetLabels = [{
            id: 'pending-closed', path: 'closure', streetName: 'Shanty Bay Rd',
            position: { longitude: -79.69, latitude: 44.38 }, source: 'planner', confirmed: false, visible: true,
        }];

        act(() => root.render(<DetourMapCanvas overlay={overlay} {...callbacks} />));
        let streetSource = JSON.parse(container.querySelector('[data-source-id="detour-street-label-source"]')?.getAttribute('data-source-data') ?? '{}') as { features?: Array<{ properties?: { confirmed?: boolean } }> };
        let genericClosed = JSON.parse(container.querySelector('[data-source-id="detour-bypassed-label-source"]')?.getAttribute('data-source-data') ?? '{}') as { features?: unknown[] };
        expect(streetSource.features?.[0]?.properties?.confirmed).toBe(false);
        expect(genericClosed.features).toEqual([]);

        act(() => root.render(<DetourMapCanvas overlay={overlay} publicationMode {...callbacks} />));
        streetSource = JSON.parse(container.querySelector('[data-source-id="detour-street-label-source"]')?.getAttribute('data-source-data') ?? '{}') as { features?: Array<{ properties?: { confirmed?: boolean } }> };
        genericClosed = JSON.parse(container.querySelector('[data-source-id="detour-bypassed-label-source"]')?.getAttribute('data-source-data') ?? '{}') as { features?: unknown[] };
        expect(streetSource.features).toEqual([]);
        expect(genericClosed.features).toHaveLength(1);
    });

    it('uses explicit, collision-aware labels for temporary and closed stops', () => {
        const overlay = createOverlay();
        overlay.stopImpacts = [{
            id: 'temporary-1',
            status: 'temporary',
            reviewed: true,
            temporaryStopName: 'Temporary stop',
            temporaryStopCode: '959',
            temporaryStopPosition: { longitude: -79.68, latitude: 44.39 },
        }, {
            id: 'closed-1',
            status: 'closed',
            reviewed: true,
            sourceStop: {
                stopId: 'stop-959',
                stopCode: '959',
                name: 'Johnson at Indian Arrow',
                position: { longitude: -79.681, latitude: 44.388 },
                sequence: 1,
            },
        }];
        act(() => root.render(<DetourMapCanvas overlay={overlay} {...callbacks} />));

        const dragTarget = container.querySelector('[aria-label="Move Temporary stop"]');
        expect(dragTarget?.className).toContain('bg-transparent');
        expect(dragTarget?.childElementCount).toBe(0);
        const source = container.querySelector('[data-source-id="detour-stop-source"]');
        const data = JSON.parse(source?.getAttribute('data-source-data') ?? '{}') as {
            features?: Array<{ properties?: { status?: string; label?: string } }>;
        };
        expect(data.features?.map(feature => feature.properties)).toEqual(expect.arrayContaining([
            expect.objectContaining({ status: 'temporary', label: 'Temp Stop 959\nTemporary stop' }),
            expect.objectContaining({ status: 'closed', label: 'Stop 959' }),
        ]));
        const regularLabels = JSON.parse(container.querySelector('[data-layer-id="detour-stop-labels"]')?.getAttribute('data-layer-layout') ?? '{}') as Record<string, unknown>;
        const temporaryLabels = JSON.parse(container.querySelector('[data-layer-id="detour-temporary-stop-labels"]')?.getAttribute('data-layer-layout') ?? '{}') as Record<string, unknown>;
        const closedLabels = JSON.parse(container.querySelector('[data-layer-id="detour-closed-stop-labels"]')?.getAttribute('data-layer-layout') ?? '{}') as Record<string, unknown>;
        expect(regularLabels['text-size']).toBe(10);
        expect(regularLabels['text-allow-overlap']).toBe(false);
        expect(temporaryLabels['text-size']).toBe(12);
        expect(temporaryLabels['text-font']).toEqual(['DIN Pro Bold', 'Arial Unicode MS Bold']);
        expect(temporaryLabels['text-anchor']).toBe('bottom');
        expect(temporaryLabels['text-offset']).toEqual([0, -1.35]);
        expect(temporaryLabels['text-justify']).toBe('center');
        expect(temporaryLabels['text-allow-overlap']).toBe(true);
        expect(closedLabels['text-variable-anchor']).toEqual(['top-right', 'bottom-right', 'top-left', 'bottom-left']);
        expect(closedLabels['text-radial-offset']).toBe(0.75);
        const stopSymbols = JSON.parse(container.querySelector('[data-layer-id="detour-stops"]')?.getAttribute('data-layer-layout') ?? '{}') as Record<string, unknown>;
        expect(stopSymbols['icon-image']).toEqual([
            'match', ['get', 'status'],
            'closed', 'detour-stop-closed-icon',
            'temporary', 'detour-stop-temporary-icon',
            'detour-stop-active-icon',
        ]);
    });

    it('hides authoring chrome and drag handles in publication mode', () => {
        const overlay = createOverlay();
        overlay.detourWaypoints = [
            { longitude: -79.70, latitude: 44.38 },
            { longitude: -79.69, latitude: 44.385 },
            { longitude: -79.68, latitude: 44.39 },
        ];
        overlay.stopImpacts = [{
            id: 'temporary-1',
            status: 'temporary',
            reviewed: true,
            temporaryStopName: 'Temporary stop',
            temporaryStopPosition: { longitude: -79.68, latitude: 44.39 },
        }];
        overlay.closureWaypoints = [{ longitude: -79.69, latitude: 44.385 }];

        act(() => root.render(<DetourMapCanvas overlay={overlay} publicationMode {...callbacks} />));

        expect(container.querySelector('[data-testid="map-base"]')?.getAttribute('data-interactive')).toBe('false');
        expect(container.querySelector('[aria-label="Detour waypoint 2"]')).toBeNull();
        expect(container.querySelector('[aria-label="Diversion junction"]')).toBeNull();
        expect(container.querySelector('[aria-label="Rejoin junction"]')).toBeNull();
        expect(container.querySelector('[aria-label="Move route 8A label"]')).toBeNull();
        expect(container.querySelector('[aria-label="Closed-section anchor 1"]')).toBeNull();
        expect(container.querySelector('[aria-label="Move Temporary stop"]')).toBeNull();
        expect(container.querySelector('[aria-label="Fit notice to map"]')).toBeNull();
        expect(container.querySelector('[data-layer-id="detour-warning-outline"]')).toBeNull();
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
