// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResidentialGrowthMonthlyDataset, ResidentialGrowthRecord } from '../utils/residential-growth/types';

const serviceMocks = vi.hoisted(() => ({
    getResidentialGrowthDatasets: vi.fn(),
}));

vi.mock('../components/shared', () => ({
    MapBase: ({ children }: { children?: React.ReactNode }) => <div data-testid="residential-growth-map">{children}</div>,
}));

vi.mock('react-map-gl/mapbox', () => ({
    Layer: () => <div />,
    Source: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../utils/residential-growth/service', () => ({
    getResidentialGrowthDatasets: serviceMocks.getResidentialGrowthDatasets,
    loadResidentialGrowthGeocodeCache: vi.fn(async () => null),
    saveResidentialGrowthDataset: vi.fn(),
    saveResidentialGrowthGeocodeCache: vi.fn(),
}));

import { ResidentialGrowthWorkspace } from '../components/Analytics/ResidentialGrowthWorkspace';

function record(id: string, period: string, units: number): ResidentialGrowthRecord {
    return {
        id,
        layer: 'issued',
        fileNumber: id,
        address: `${id} Test Street`,
        date: `${period}-15`,
        units,
        category: 'Residential',
        geocode: {
            lat: 44.38,
            lon: -79.69,
            displayName: `${id} Test Street`,
            source: 'imported',
            confidence: 'high',
        },
        warnings: [],
    };
}

function dataset(period: string, units: number): ResidentialGrowthMonthlyDataset {
    return {
        schemaVersion: 1,
        period,
        issued: [record(period, period, units)],
        occupied: [],
        metadata: {
            importedAt: `${period}-28T12:00:00.000Z`,
            importedBy: 'tester',
        },
    };
}

describe('ResidentialGrowthWorkspace time selector', () => {
    let container: HTMLDivElement;
    let root: Root;
    const datasets = [
        dataset('2026-01', 10),
        dataset('2026-02', 20),
        dataset('2026-03', 30),
        dataset('2026-04', 40),
    ];

    beforeEach(async () => {
        serviceMocks.getResidentialGrowthDatasets.mockReset();
        serviceMocks.getResidentialGrowthDatasets.mockResolvedValue(datasets);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        await act(async () => {
            root.render(
                <ResidentialGrowthWorkspace
                    teamId="team-1"
                    userId="user-1"
                    data={datasets[3]}
                    onBack={vi.fn()}
                    onSaved={vi.fn()}
                />,
            );
            await Promise.resolve();
        });
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('names and aggregates the three latest uploaded months', async () => {
        const selector = container.querySelector('[aria-label="Time period"]') as HTMLSelectElement;

        await act(async () => {
            selector.value = 'past-3-months';
            selector.dispatchEvent(new Event('change', { bubbles: true }));
        });

        expect(container.textContent).toContain('Feb 2026, Mar 2026, and Apr 2026');
        expect(container.textContent).toContain('Aggregating 3 uploaded months');

        const mappedPermits = Array.from(container.querySelectorAll('div'))
            .find((element) => element.textContent === 'Mapped permits')
            ?.parentElement?.textContent;
        const mappedUnits = Array.from(container.querySelectorAll('div'))
            .find((element) => element.textContent === 'Mapped units')
            ?.parentElement?.textContent;

        expect(mappedPermits).toContain('3');
        expect(mappedUnits).toContain('90');
    });
});
