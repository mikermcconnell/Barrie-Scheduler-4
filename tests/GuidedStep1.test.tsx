import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { GuidedStep1 } from '../components/GuidedSchedule/GuidedStep1';
import { EMPTY_GUIDED_SELECTION, selectGuidedRoute, setGuidedTimeFrame, type DayTypeReadiness } from '../components/GuidedSchedule/guidedSelection';
import type { GuidedPerformanceSource } from '../components/GuidedSchedule/useGuidedPerformanceSource';

const readiness = (status: DayTypeReadiness['status'][]): DayTypeReadiness[] => (
    (['Weekday', 'Saturday', 'Sunday'] as const).map((dayType, index) => ({
        dayType,
        route: undefined as DayTypeReadiness["route"],
        stopLevelDayCount: status[index] === 'ready' ? 12 : 0,
        status: status[index],
    }))
);

const makeSource = (overrides: Partial<GuidedPerformanceSource> = {}): GuidedPerformanceSource => ({
    selection: EMPTY_GUIDED_SELECTION,
    selectRoute: vi.fn(),
    toggleDayType: vi.fn(),
    setTimeFrame: vi.fn(),
    replaceSelection: vi.fn(),
    routeIds: ['2', '7', '8A', '10'],
    cleanData: null,
    historyStatus: null,
    readiness: readiness(['no-data', 'no-data', 'no-data']),
    availableDateRange: undefined,
    diagnosticsFor: () => null,
    dataLoading: false,
    dataLoaded: false,
    dataLoadProgress: null,
    metadataLoading: false,
    dataError: null,
    metadataError: null,
    retryData: vi.fn(),
    retryMetadata: vi.fn(),
    ...overrides,
});

describe('GuidedStep1', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) flushSync(() => root?.unmount());
        container?.remove();
        root = null;
        container = null;
    });

    const renderStep1 = (source: GuidedPerformanceSource) => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        flushSync(() => root?.render(<GuidedStep1 source={source} />));
    };

    const buttons = (label: string) => Array.from(container?.querySelectorAll(`[aria-label="${label}"] button`) ?? []) as HTMLButtonElement[];

    it('shows every route as a button with none selected', () => {
        renderStep1(makeSource());
        const routes = buttons('Routes');
        expect(routes.map(button => button.textContent)).toEqual(['2', '7', '8A', '10']);
        expect(routes.every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
        expect(container?.querySelector('[aria-label="Day types"]')).toBeNull();
    });

    it('colours each route button with its route colour', () => {
        renderStep1(makeSource());
        const byLabel = Object.fromEntries(buttons('Routes').map(button => [button.textContent, button.style.backgroundColor]));
        expect(byLabel['2']).toBe('rgb(0, 104, 56)');
        expect(byLabel['7']).toBe('rgb(245, 130, 32)');
        expect(byLabel['10']).toBe('rgb(104, 23, 87)');
    });

    it('selects a route when its button is clicked', () => {
        const source = makeSource();
        renderStep1(source);
        flushSync(() => buttons('Routes').find(button => button.textContent === '10')?.click());
        expect(source.selectRoute).toHaveBeenCalledWith('10');
    });

    it('asks for a time frame before showing day types, and loads nothing until one is chosen', () => {
        const source = makeSource({
            selection: selectGuidedRoute(EMPTY_GUIDED_SELECTION, '10'),
            availableDateRange: { start: '2026-09-01', end: '2026-10-10' },
        });
        renderStep1(source);
        expect(container?.querySelector('[aria-label="Day types"]')).toBeNull();
        expect(container?.textContent).toContain('Only the data for that window is loaded');
        flushSync(() => buttons('Time frame').find(button => button.textContent === 'Past week')?.click());
        expect(source.setTimeFrame).toHaveBeenCalledWith({ start: '2026-10-04', end: '2026-10-10' });
        flushSync(() => buttons('Time frame').find(button => button.textContent === 'All data')?.click());
        expect(source.setTimeFrame).toHaveBeenCalledWith(null);
    });

    it('shows all three day types selected for the chosen route, and lets the planner untick one', () => {
        const source = makeSource({
            selection: setGuidedTimeFrame(selectGuidedRoute(EMPTY_GUIDED_SELECTION, '10'), null),
            dataLoaded: true,
            readiness: readiness(['ready', 'ready', 'no-data']),
        });
        renderStep1(source);
        const dayTypes = buttons('Day types');
        expect(dayTypes.map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true']);
        expect(dayTypes[2].textContent).toContain('No data');
        expect(container?.textContent).toContain('will be skipped');
        flushSync(() => dayTypes[2].click());
        expect(source.toggleDayType).toHaveBeenCalledWith('Sunday');
    });
});
