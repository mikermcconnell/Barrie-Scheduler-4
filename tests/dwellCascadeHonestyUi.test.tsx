import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DwellCascadeSection } from '../components/Performance/DwellCascadeSection';
import CascadeStorySlideOver from '../components/Performance/CascadeStorySlideOver';
import { resolveMappedMilestoneIndex } from '../components/Performance/CascadeRouteMap';
import type { CascadeAffectedTrip, DwellCascade, PerformanceDataSummary } from '../utils/performanceDataTypes';
import type { TimelinePoint } from '../utils/schedule/cascadeStoryUtils';

vi.mock('../components/Performance/CascadeTimelineChart', () => ({
    default: () => React.createElement('div', null, 'Mock timeline'),
}));

vi.mock('../components/Performance/CascadeTripChain', () => ({
    default: () => React.createElement('div', null, 'Mock chain'),
}));

vi.mock('../components/Performance/CascadeRouteMap', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../components/Performance/CascadeRouteMap')>();
    return {
        ...actual,
        default: ({ phase }: { phase: string }) => React.createElement('div', null, `Mock map · ${phase}`),
    };
});

vi.mock('../utils/gtfs/gtfsStopLookup', () => ({
    getAllStopsWithCoords: () => [
        { stop_id: 'PP', stop_name: 'Park Place', lat: 44.33, lon: -79.69 },
        { stop_id: 'DT', stop_name: 'Downtown', lat: 44.39, lon: -79.69 },
    ],
}));

function makeAffectedTrip(overrides: Partial<CascadeAffectedTrip> = {}): CascadeAffectedTrip {
    return {
        tripName: 'Trip-B',
        tripId: 'trip-b',
        routeId: '10',
        routeName: 'Route 10',
        terminalDepartureTime: '08:35',
        scheduledRecoverySeconds: 300,
        timepoints: [
            {
                stopName: 'Downtown',
                stopId: 'DT',
                routeStopIndex: 12,
                scheduledDeparture: '08:42',
                observedDeparture: '08:49:00',
                deviationSeconds: 420,
                rawDeviationSeconds: 480,
                isLate: true,
                boardings: 7,
            },
        ],
        lateTimepointCount: 1,
        affectedTimepointCount: 1,
        recoveredAtStop: null,
        otpStatus: 'late',
        recoveredHere: false,
        lateSeconds: 420,
        ...overrides,
    };
}

function makeCascade(overrides: Partial<DwellCascade> = {}): DwellCascade {
    return {
        date: '2026-03-20',
        block: '10-01',
        routeId: '10',
        routeName: 'Route 10',
        stopName: 'Park Place',
        stopId: 'PP',
        tripName: 'Trip-A',
        operatorId: 'OP1',
        observedDepartureTime: '08:15:00',
        trackedDwellSeconds: 360,
        severity: 'high',
        cascadedTrips: [makeAffectedTrip()],
        blastRadius: 1,
        affectedTripCount: 1,
        backUnderThresholdAtTrip: null,
        backUnderThresholdAtStop: null,
        recoveredAtTrip: null,
        recoveredAtStop: null,
        totalLateSeconds: 420,
        recoveryTimeAvailableSeconds: 300,
        ...overrides,
    };
}

describe('dwell cascade honesty pass UI', () => {
    let container: HTMLDivElement;
    let root: Root;
    let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
    let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        originalRequestAnimationFrame = window.requestAnimationFrame;
        originalCancelAnimationFrame = window.cancelAnimationFrame;
        window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
            cb(0);
            return 1;
        }) as typeof window.requestAnimationFrame;
        window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
    });

    afterEach(() => {
        flushSync(() => {
            root.unmount();
        });
        window.requestAnimationFrame = originalRequestAnimationFrame;
        window.cancelAnimationFrame = originalCancelAnimationFrame;
        container.remove();
    });

    it('explains that section-level carryover starts on later trips', () => {
        const cascade = makeCascade();
        const data = {
            dailySummaries: [
                {
                    date: '2026-03-20',
                    dayType: 'weekday',
                    byCascade: {
                        cascades: [cascade],
                        byStop: [],
                        byTerminal: [],
                        totalCascaded: 1,
                        totalNonCascaded: 0,
                        avgBlastRadius: 1,
                        totalBlastRadius: 1,
                    },
                    system: { otp: { total: 10, onTime: 8 } },
                },
            ],
            metadata: {
                importedAt: '2026-03-21T00:00:00Z',
                importedBy: 'test',
                dateRange: { start: '2026-03-20', end: '2026-03-20' },
                dayCount: 1,
                totalRecords: 100,
            },
            schemaVersion: 7,
        } as unknown as PerformanceDataSummary;

        flushSync(() => {
            root.render(<DwellCascadeSection data={data} />);
        });

        expect(container.textContent).toContain('Current view shows block carryover starting at the first observed downstream timepoint on later trips in the same block.');
        expect(container.textContent).toContain('Same-trip downstream tracing is not shown here yet.');
        expect(container.textContent).toContain('Block Carryover by Route');
    });

    it('uses a map-first hierarchy and keeps missing observations honest', () => {
        const cascade = makeCascade();

        flushSync(() => {
            root.render(
                <CascadeStorySlideOver
                    cascade={cascade}
                    onClose={() => {}}
                    stopLoadLookup={new Map()}
                    dailySummaries={[]}
                />,
            );
        });

        expect(container.textContent).toContain('Dwell incident review');
        expect(container.textContent).toContain('6.0 min effective dwell');
        expect(container.textContent).toContain('Associated-delay evidence');
        expect(container.textContent).toContain('Same-trip affected');
        expect(container.textContent).toContain('Later trips');
        expect(container.textContent).toContain('OTP-late departures');
        expect(container.textContent).toContain('Partial coverage');
        expect(container.textContent).toContain('Whole story');
        expect(container.textContent).toContain('Incident trip');
        expect(container.textContent).toContain('Mock map · whole');
        expect(container.textContent).toContain('Incident details');
        expect(container.textContent).not.toContain('Story Sections');
        expect(container.textContent).not.toContain('Trip Story Chain');
        expect(container.textContent).not.toContain('Incident Summary');
        expect(container.textContent).not.toContain('Customer Exposure');
        expect(container.textContent).not.toContain('Route OTP Incident Impact');
    });

    it('offers incident-trip and later-trip map phases when both exist', () => {
        const sameTripImpact = makeAffectedTrip({
            tripName: 'Trip-A',
            tripId: 'trip-a',
            routeId: '10',
            terminalDepartureTime: '08:15',
            phase: 'same-trip',
            lateTimepointCount: 0,
            affectedTimepointCount: 1,
            recoveredHere: true,
            recoveredAtStop: 'Maple View',
            lateSeconds: 120,
        });
        const cascade = makeCascade({
            sameTripImpact,
            sameTripObserved: true,
            backUnderThresholdAtTrip: 'Trip-A',
            backUnderThresholdAtStop: 'Maple View',
            recoveredAtTrip: 'Trip-A',
            recoveredAtStop: 'Maple View',
        });

        flushSync(() => {
            root.render(
                <CascadeStorySlideOver
                    cascade={cascade}
                    onClose={() => {}}
                    stopLoadLookup={new Map()}
                    dailySummaries={[]}
                />,
            );
        });

        expect(container.textContent).toContain('Whole story');
        expect(container.textContent).toContain('Incident trip');
        expect(container.textContent).toContain('Later trips');
        expect(container.textContent).not.toContain('Focused Same-Trip Segment');
        expect(container.textContent).not.toContain('Mock timeline');
        expect(container.textContent).not.toContain('Mock chain');

        const laterTripsButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Later trips');
        expect(laterTripsButton).toBeTruthy();
        flushSync(() => {
            laterTripsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(container.textContent).toContain('Mock map · later-trip');
        expect(laterTripsButton?.getAttribute('aria-pressed')).toBe('true');

        const summary = container.querySelector('summary');
        const closeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Close dwell incident review"]');
        expect(summary).toBeTruthy();
        expect(closeButton).toBeTruthy();
        summary?.focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(document.activeElement).toBe(closeButton);
    });

    it('does not move a milestone to a different stop when the exact evidence point has no coordinates', () => {
        const points: TimelinePoint[] = [
            {
                index: 0,
                stopName: 'Unmapped transition',
                stopId: 'missing-transition',
                scheduledDeparture: '08:35',
                observedDeparture: '08:40:00',
                deviationMinutes: 5,
                isLate: false,
                tripIndex: 0,
                tripName: 'Trip-B',
                phase: 'later-trip',
                isTripStart: true,
            },
            {
                index: 1,
                stopName: 'Mapped later stop',
                stopId: 'mapped',
                scheduledDeparture: '08:45',
                observedDeparture: '08:48:00',
                deviationMinutes: 3,
                isLate: false,
                tripIndex: 0,
                tripName: 'Trip-B',
                phase: 'later-trip',
                isTripStart: false,
            },
            {
                index: 2,
                stopName: 'Unmapped final evidence',
                stopId: 'missing-end',
                scheduledDeparture: '08:55',
                observedDeparture: '08:57:00',
                deviationMinutes: 2,
                isLate: false,
                tripIndex: 0,
                tripName: 'Trip-B',
                phase: 'later-trip',
                isTripStart: false,
            },
        ];

        expect(resolveMappedMilestoneIndex(points, new Set(['mapped']), 'later-transition')).toBeNull();
        expect(resolveMappedMilestoneIndex(points, new Set(['mapped']), 'end-of-evidence')).toBeNull();
        expect(resolveMappedMilestoneIndex(points.slice(1, 2), new Set(['mapped']), 'later-transition')).toBe(1);
        expect(resolveMappedMilestoneIndex(points.slice(1, 2), new Set(['mapped']), 'end-of-evidence')).toBe(1);
    });
});
