import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import CascadeTripChain from '../components/Performance/CascadeTripChain';
import CascadeTimelineChart from '../components/Performance/CascadeTimelineChart';
import type { CascadeAffectedTrip, DwellCascade } from '../utils/performanceDataTypes';

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

describe('dwell cascade visual story UI', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => {
            root.unmount();
        });
        container.remove();
    });

    it('shows same-trip and later-trip sections in the trip chain', () => {
        const sameTripImpact = makeAffectedTrip({
            tripName: 'Trip-A',
            tripId: 'trip-a',
            terminalDepartureTime: '08:15',
            phase: 'same-trip',
            lateTimepointCount: 0,
            affectedTimepointCount: 2,
            timepoints: [
                {
                    stopName: 'Maple View',
                    stopId: 'MV',
                    routeStopIndex: 9,
                    scheduledDeparture: '08:22',
                    observedDeparture: '08:24:00',
                    deviationSeconds: 120,
                    rawDeviationSeconds: 180,
                    isLate: false,
                    boardings: 4,
                },
                {
                    stopName: 'Downtown',
                    stopId: 'DT',
                    routeStopIndex: 12,
                    scheduledDeparture: '08:30',
                    observedDeparture: '08:31:00',
                    deviationSeconds: 60,
                    rawDeviationSeconds: 120,
                    isLate: false,
                    boardings: 6,
                },
            ],
            lateSeconds: 180,
        });
        const cascade = makeCascade({
            sameTripImpact,
            sameTripObserved: true,
            cascadedTrips: [makeAffectedTrip({ phase: 'later-trip' })],
        });

        flushSync(() => {
            root.render(
                <CascadeTripChain
                    cascade={cascade}
                    selectedTripIndex={null}
                    onSelectTrip={() => {}}
                />,
            );
        });

        expect(container.textContent).toContain('Incident trip remainder · 1');
        expect(container.textContent).toContain('Later block trips · 1');
        expect(container.textContent).toContain('Later-trip carryover');
        expect(container.textContent).toContain('Same trip');
        expect(container.textContent).toContain('Later trip');
    });

    it('labels the timeline phases and the later-trip boundary', () => {
        const sameTripImpact = makeAffectedTrip({
            tripName: 'Trip-A',
            tripId: 'trip-a',
            terminalDepartureTime: '08:15',
            phase: 'same-trip',
            lateTimepointCount: 0,
            affectedTimepointCount: 2,
            timepoints: [
                {
                    stopName: 'Maple View',
                    stopId: 'MV',
                    routeStopIndex: 9,
                    scheduledDeparture: '08:22',
                    observedDeparture: '08:24:00',
                    deviationSeconds: 120,
                    rawDeviationSeconds: 180,
                    isLate: false,
                    boardings: 4,
                },
                {
                    stopName: 'Downtown',
                    stopId: 'DT',
                    routeStopIndex: 12,
                    scheduledDeparture: '08:30',
                    observedDeparture: '08:31:00',
                    deviationSeconds: 60,
                    rawDeviationSeconds: 120,
                    isLate: false,
                    boardings: 6,
                },
            ],
            lateSeconds: 180,
        });
        const laterTrip = makeAffectedTrip({
            phase: 'later-trip',
            timepoints: [
                {
                    stopName: 'Terminal North',
                    stopId: 'TN',
                    routeStopIndex: 1,
                    scheduledDeparture: '08:42',
                    observedDeparture: '08:49:00',
                    deviationSeconds: 420,
                    rawDeviationSeconds: 480,
                    isLate: true,
                    boardings: 7,
                },
            ],
        });

        flushSync(() => {
            root.render(
                <CascadeTimelineChart
                    trips={[sameTripImpact, laterTrip]}
                    routeId="10"
                    selectedTripIndex={null}
                    onSelectPoint={() => {}}
                    stopLoadLookup={new Map()}
                />,
            );
        });

        expect(container.textContent).toContain('Same-trip impact · 2 points');
        expect(container.textContent).toContain('Later-trip carryover · 1 points');
        expect(container.textContent).toContain('Later-trip carryover');
        expect(container.textContent).toContain('Same-trip impact · Trip-A');
    });
});
