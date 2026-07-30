import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const geocoderMocks = vi.hoisted(() => ({
    geocodeFareProgramOrigins: vi.fn(),
}));

vi.mock('../components/shared/MapBase', () => ({
    MapBase: ({
        children,
        interactiveLayerIds,
    }: {
        children?: React.ReactNode;
        interactiveLayerIds?: string[];
    }) => (
        <div
            data-testid="fare-programs-map"
            data-interactive-layers={interactiveLayerIds?.join(',')}
        >
            {children}
        </div>
    ),
}));

vi.mock('react-map-gl/mapbox', () => ({
    Layer: ({ id }: { id?: string }) => <div data-layer-id={id} />,
    Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Source: ({
        children,
        id,
        cluster,
        clusterMaxZoom,
        clusterRadius,
    }: {
        children?: React.ReactNode;
        id?: string;
        cluster?: boolean;
        clusterMaxZoom?: number;
        clusterRadius?: number;
    }) => (
        <div
            data-source-id={id}
            data-cluster={cluster ? 'true' : 'false'}
            data-cluster-max-zoom={clusterMaxZoom}
            data-cluster-radius={clusterRadius}
        >
            {children}
        </div>
    ),
}));

vi.mock('../utils/fare-programs/fareProgramsWorkbookStorage', () => ({
    loadFareProgramsWorkbook: vi.fn(async () => null),
    removeFareProgramsWorkbook: vi.fn(async () => true),
    saveFareProgramsWorkbook: vi.fn(async () => true),
}));

vi.mock('../utils/fare-programs/fareProgramsOriginGeocoder', () => ({
    geocodeFareProgramOrigins: geocoderMocks.geocodeFareProgramOrigins,
}));

import { FareProgramsWorkspace } from '../components/Analytics/FareProgramsWorkspace';

describe('FareProgramsWorkspace', () => {
    let container: HTMLDivElement;
    let root: Root;
    const onBack = vi.fn();

    beforeEach(async () => {
        onBack.mockReset();
        geocoderMocks.geocodeFareProgramOrigins.mockReset();
        geocoderMocks.geocodeFareProgramOrigins.mockResolvedValue({
            geocodes: [],
            failedOriginIds: [],
        });
        vi.stubGlobal('Worker', class WorkerMock {
            onmessage: ((event: MessageEvent) => void) | null = null;
            onerror: (() => void) | null = null;

            postMessage() {
                queueMicrotask(() => this.onmessage?.({
                    data: {
                        ok: true,
                        result: {
                            sourceRows: 693_983,
                            matchedUses: 2_059,
                            usableStartUses: 1,
                            missingStartUses: 2_058,
                            origins: [{
                                id: 'origin-1',
                                label: 'Test starting location',
                                geocodeQuery: 'Test starting location',
                                uses: 1,
                                dayUses: { weekday: 1, weekend: 0 },
                                buckets: {
                                    weekday: {
                                        'before-6': 0,
                                        morning: 1,
                                        'school-day': 0,
                                        daytime: 0,
                                        afternoon: 0,
                                        'after-school': 0,
                                        evening: 0,
                                    },
                                    weekend: {
                                        'before-6': 0,
                                        morning: 0,
                                        'school-day': 0,
                                        daytime: 0,
                                        afternoon: 0,
                                        'after-school': 0,
                                        evening: 0,
                                    },
                                },
                            }],
                        },
                    },
                } as MessageEvent));
            }

            terminate() {}
        });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(<FareProgramsWorkspace onBack={onBack} />));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
    });

    it('opens directly on Usage map without an Overview tab', () => {
        const tabs = Array.from(container.querySelectorAll('[aria-label="Fare Programs views"] [role="tab"]'));

        expect(tabs.map((tab) => tab.textContent)).toEqual(['Usage map', 'Raw counts']);
        expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
        expect(container.textContent).toContain('High-school-pass usage map');
        expect(container.textContent).not.toContain('Overview');
    });

    it('shows reconciled workbook fare labels and opens row details in Raw counts', () => {
        const rawCountsTab = Array.from(container.querySelectorAll('[role="tab"]'))
            .find((tab) => tab.textContent === 'Raw counts') as HTMLButtonElement;

        act(() => rawCountsTab.click());

        expect(container.textContent).toContain('Fare-type counts from the workbook');
        expect(container.textContent).toContain('Student Monthly Pass');
        expect(container.textContent).toContain('298,205');
        expect(container.textContent).toContain('High School Student Pass 25/26');
        expect(container.textContent).toContain('Included in working proxy');
        expect(container.textContent).toContain('Reconciled to source');

        const viewRows = container.querySelector('[aria-label="View all rows for Adult Monthly Pass"]') as HTMLButtonElement;
        act(() => viewRows.click());

        expect(container.querySelector('[role="dialog"]')).not.toBeNull();
        expect(container.textContent).toContain('Choose the source workbook');
        expect(container.textContent).toContain('Transaction details are read locally');
    });

    it('does not show Field Trip information', () => {
        expect(container.textContent).not.toMatch(/Field Trip/i);

        const rawCountsTab = Array.from(container.querySelectorAll('[role="tab"]'))
            .find((tab) => tab.textContent === 'Raw counts') as HTMLButtonElement;
        act(() => rawCountsTab.click());

        expect(container.textContent).not.toMatch(/Field Trip/i);
    });

    it('shows the usage map with weekday, weekend, expanded time filters, and PDF export', () => {
        const usageMapTab = Array.from(container.querySelectorAll('[aria-label="Fare Programs views"] [role="tab"]'))
            .find((tab) => tab.textContent === 'Usage map') as HTMLButtonElement;
        act(() => usageMapTab.click());

        expect(container.textContent).toContain('High-school-pass usage map');
        expect(container.textContent).toContain('Weekdays');
        expect(container.textContent).toContain('Weekends');
        expect(container.textContent).toContain('6–9 AM');
        expect(container.textContent).toContain('9 AM–4 PM');
        expect(container.textContent).toContain('4–7 PM');
        expect(container.textContent).toContain('After 7 PM');
        expect(container.textContent).toContain('Total high-school uses');
        expect(container.textContent).toContain('2,059');
        expect(container.textContent).not.toContain('Average per day');
        expect(container.textContent).toContain('Workbook stays on this device');
        expect(container.textContent).toContain('Choose the source workbook');
        expect(container.textContent).toContain('Export page PDF');
        expect(container.textContent).not.toContain('Build usage map');
        expect(container.textContent).not.toContain('Sanitized areas');
    });

    it('offers bubble and heat-map tabs and identifies Barrie high schools', () => {
        const mapTabs = Array.from(container.querySelectorAll('[aria-label="Usage map display"] [role="tab"]'));
        expect(mapTabs.map((tab) => tab.textContent?.trim())).toEqual(['Bubble map', 'Heat map']);
        expect(mapTabs[1]?.getAttribute('aria-selected')).toBe('true');

        const schoolMarkers = Array.from(container.querySelectorAll('[aria-label^="High school:"]'));
        expect(schoolMarkers).toHaveLength(10);
        expect(schoolMarkers.map((marker) => marker.getAttribute('aria-label'))).toContain(
            'High school: Barrie North Collegiate',
        );
        expect(schoolMarkers.map((marker) => marker.getAttribute('aria-label'))).toContain(
            "High school: St. Peter's Catholic Secondary School",
        );

        act(() => (mapTabs[0] as HTMLButtonElement).click());
        expect(mapTabs[0]?.getAttribute('aria-selected')).toBe('true');
        expect(container.textContent).toContain('Heat map');
    });

    it('automatically builds the map after a valid workbook is selected', async () => {
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        const workbook = new File(['workbook'], 'Barrie Transit.xlsx', {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        Object.defineProperty(workbook, 'arrayBuffer', {
            configurable: true,
            value: vi.fn(async () => new ArrayBuffer(8)),
        });
        Object.defineProperty(input, 'files', {
            configurable: true,
            value: [workbook],
        });

        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(geocoderMocks.geocodeFareProgramOrigins).toHaveBeenCalledOnce();
        expect(container.textContent).not.toContain('Build usage map');
    });

    it('clusters bubble-map locations and explains click-to-expand behavior', async () => {
        geocoderMocks.geocodeFareProgramOrigins.mockResolvedValue({
            geocodes: [{
                originId: 'origin-1',
                longitude: -79.69,
                latitude: 44.38,
                relevance: 1,
                source: 'gtfs-stop',
            }],
            failedOriginIds: [],
        });
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        const workbook = new File(['workbook'], 'Barrie Transit.xlsx', {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        Object.defineProperty(workbook, 'arrayBuffer', {
            configurable: true,
            value: vi.fn(async () => new ArrayBuffer(8)),
        });
        Object.defineProperty(input, 'files', {
            configurable: true,
            value: [workbook],
        });

        await act(async () => {
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 0));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        const bubbleTab = Array.from(container.querySelectorAll('[aria-label="Usage map display"] [role="tab"]'))
            .find((tab) => tab.textContent?.trim() === 'Bubble map') as HTMLButtonElement;
        act(() => bubbleTab.click());

        const bubbleSource = container.querySelector('[data-source-id="fare-programs-usage-bubble-source"]');
        expect(bubbleSource?.getAttribute('data-cluster')).toBe('true');
        expect(bubbleSource?.getAttribute('data-cluster-max-zoom')).toBe('14');
        expect(bubbleSource?.getAttribute('data-cluster-radius')).toBe('44');
        expect(container.querySelector('[data-layer-id="fare-programs-usage-clusters"]')).not.toBeNull();
        expect(container.querySelector('[data-layer-id="fare-programs-usage-points"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="fare-programs-map"]')?.getAttribute('data-interactive-layers'))
            .toBe('fare-programs-usage-clusters,fare-programs-usage-points');
        expect(container.textContent).toContain('Nearby points are grouped; click a cluster to zoom in.');
    });

    it('rejects a non-xlsx address-verification upload before reading it', () => {
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        Object.defineProperty(input, 'files', {
            configurable: true,
            value: [new File(['not a workbook'], 'addresses.csv', { type: 'text/csv' })],
        });

        act(() => input.dispatchEvent(new Event('change', { bubbles: true })));

        expect(container.textContent).toContain('Choose an Excel .xlsx workbook.');
        expect(container.textContent).toContain('Choose the source workbook');
    });

    it('returns to Planning Data from the workspace header', () => {
        const back = container.querySelector('[aria-label="Back to Planning Data"]') as HTMLButtonElement;
        act(() => back.click());
        expect(onBack).toHaveBeenCalledOnce();
    });
});
