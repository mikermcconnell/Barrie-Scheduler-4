import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/shared/MapBase', () => ({
    MapBase: ({ children }: { children?: React.ReactNode }) => <div data-testid="fare-programs-map">{children}</div>,
}));

vi.mock('react-map-gl/mapbox', () => ({
    Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('recharts', () => ({
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    BarChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    CartesianGrid: (): null => null,
    Tooltip: (): null => null,
    XAxis: (): null => null,
    YAxis: (): null => null,
    Bar: (): null => null,
}));

import { FareProgramsWorkspace } from '../components/Analytics/FareProgramsWorkspace';

describe('FareProgramsWorkspace', () => {
    let container: HTMLDivElement;
    let root: Root;
    const onBack = vi.fn();

    beforeEach(() => {
        onBack.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<FareProgramsWorkspace onBack={onBack} />));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('shows reconciled program totals and the conservative school proxy', () => {
        expect(container.textContent).toContain('Potential Service Mirroring uses');
        expect(container.textContent).toContain('2,059');
        expect(container.textContent).toContain('Barrie North CI');
        expect(container.textContent).toContain('Innisdale SS');
        expect(container.textContent).toContain('Maple Ridge SS');
        expect(container.textContent).toContain('Not attributable');
        expect(container.textContent).toContain('Usable end locations');
        expect(container.textContent).toContain('400');
        expect(container.querySelector('[data-testid="fare-programs-map"]')).not.toBeNull();
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

    it('shows sanitized starting-area context with weekday, weekend, and time filters', () => {
        const usageMapTab = Array.from(container.querySelectorAll('[role="tab"]'))
            .find((tab) => tab.textContent === 'Usage map') as HTMLButtonElement;
        act(() => usageMapTab.click());

        expect(container.textContent).toContain('High-school-pass starting areas');
        expect(container.textContent).toContain('Weekdays');
        expect(container.textContent).toContain('Weekends');
        expect(container.textContent).toContain('6–9 AM');
        expect(container.textContent).toContain('After 7 PM');
        expect(container.textContent).toContain('1,475');
        expect(container.textContent).toContain('88.7%');
        expect(container.textContent).toContain('188 usable starts suppressed');
        expect(container.textContent).toContain('Grove St E area');
        expect(container.textContent).not.toContain('110 Grove');
        expect(container.textContent).toContain('Build usage map');
    });

    it('returns to Planning Data from the workspace header', () => {
        const back = container.querySelector('[aria-label="Back to Planning Data"]') as HTMLButtonElement;
        act(() => back.click());
        expect(onBack).toHaveBeenCalledOnce();
    });
});
