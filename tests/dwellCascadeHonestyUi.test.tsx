import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DwellCascadeSection } from '../components/Performance/DwellCascadeSection';
import CascadeStorySlideOver from '../components/Performance/CascadeStorySlideOver';
import type { CascadeAffectedTrip, DwellCascade, PerformanceDataSummary } from '../utils/performanceDataTypes';

vi.mock('../components/Performance/CascadeTimelineChart', () => ({
    default: () => React.createElement('div', null, 'Mock timeline'),
}));

vi.mock('../components/Performance/CascadeTripChain', () => ({
    default: () => React.createElement('div', null, 'Mock chain'),
}));

vi.mock('../components/Performance/CascadeRouteMap', () => ({
    default: () => React.createElement('div', null, 'Mock map'),
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

    it('marks missing same-trip observations and starts the story on a later trip when needed', () => {
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

        expect(container.textContent).toContain('Dwell Incident Story');
        expect(container.textContent).toContain('Follow the incident on the same trip first, then see whether it carried into later trips on the block.');
        expect(container.textContent).toContain('Current traced path starts on a later trip in the same block');
        expect(container.textContent).toContain('No same-trip observation available');
        expect(container.textContent).toContain('Story Sections');
        expect(container.textContent).toContain('Incident trip remainder');
        expect(container.textContent).toContain('Later block trips');
        expect(container.textContent).toContain('Trip Story Chain');
        expect(container.textContent).toContain('Incident Summary');
        expect(container.textContent).toContain('Same-Trip OTP-Late Departures');
        expect(container.textContent).toContain('Later-Trip OTP-Late Departures');
        expect(container.textContent).toContain('First back under 5 min');
        expect(container.textContent).toContain('Recovered to zero');
    });

    it('defaults the focused segment to same-trip impact when it exists', () => {
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

        expect(container.textContent).not.toContain('Current traced path starts on a later trip in the same block');
        expect(container.textContent).toContain('Focused Same-Trip Segment');
        expect(container.textContent).toContain('Auto-focused on the incident trip because it contains the first visible story point.');
    });
});
