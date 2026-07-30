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
        expect(container.textContent).toContain('Service Mirroring proxy');
        expect(container.textContent).toContain('2,059');
        expect(container.textContent).toContain('Field Trip Pass uses');
        expect(container.textContent).toContain('982');
        expect(container.textContent).toContain('Barrie North CI');
        expect(container.textContent).toContain('Innisdale SS');
        expect(container.textContent).toContain('Maple Ridge SS');
        expect(container.textContent).toContain('Not attributable');
        expect(container.textContent).toContain('Usable end locations');
        expect(container.textContent).toContain('400');
        expect(container.querySelector('[data-testid="fare-programs-map"]')).not.toBeNull();
    });

    it('returns to Planning Data from the workspace header', () => {
        const back = container.querySelector('[aria-label="Back to Planning Data"]') as HTMLButtonElement;
        act(() => back.click());
        expect(onBack).toHaveBeenCalledOnce();
    });
});
