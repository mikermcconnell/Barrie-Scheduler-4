import { describe, it, expect } from 'vitest';
import {
  buildTimelinePoints,
  getTripNodeColor,
  type TimelinePoint,
} from '../utils/schedule/cascadeStoryUtils';
import type { CascadeAffectedTrip, CascadeTimepointObs } from '../utils/performanceDataTypes';

// Helper factory
function makeTimepoint(overrides: Partial<CascadeTimepointObs> = {}): CascadeTimepointObs {
  return {
    stopName: 'Stop A',
    stopId: 'S1',
    routeStopIndex: 0,
    scheduledDeparture: '08:00',
    observedDeparture: '08:06:00',
    deviationSeconds: 360,
    isLate: true,
    boardings: 0,
    ...overrides,
  };
}

function makeTrip(overrides: Partial<CascadeAffectedTrip> = {}): CascadeAffectedTrip {
  return {
    tripName: 'Trip 1',
    tripId: 'T1',
    routeId: '1',
    routeName: 'Route 1',
    terminalDepartureTime: '08:00',
    scheduledRecoverySeconds: 120,
    timepoints: [makeTimepoint()],
    lateTimepointCount: 1,
    recoveredAtStop: null,
    otpStatus: 'late',
    recoveredHere: false,
    lateSeconds: 360,
    ...overrides,
  };
}

describe('buildTimelinePoints', () => {
  it('flattens timepoints across trips into sequential points', () => {
    const trips: CascadeAffectedTrip[] = [
      makeTrip({
        tripName: 'Trip 1',
        timepoints: [
          makeTimepoint({ stopName: 'A', deviationSeconds: 360, routeStopIndex: 0 }),
          makeTimepoint({ stopName: 'B', deviationSeconds: 300, routeStopIndex: 1 }),
        ],
      }),
      makeTrip({
        tripName: 'Trip 2',
        timepoints: [
          makeTimepoint({ stopName: 'C', deviationSeconds: 120, routeStopIndex: 0 }),
        ],
      }),
    ];
    const points = buildTimelinePoints(trips);
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ stopName: 'A', deviationMinutes: 6, tripIndex: 0, tripName: 'Trip 1' });
    expect(points[1]).toMatchObject({ stopName: 'B', deviationMinutes: 5, tripIndex: 0 });
    expect(points[2]).toMatchObject({ stopName: 'C', deviationMinutes: 2, tripIndex: 1, tripName: 'Trip 2' });
  });

  it('handles null deviationSeconds as null deviationMinutes', () => {
    const trips: CascadeAffectedTrip[] = [
      makeTrip({
        timepoints: [makeTimepoint({ deviationSeconds: null, observedDeparture: null })],
      }),
    ];
    const points = buildTimelinePoints(trips);
    expect(points[0].deviationMinutes).toBeNull();
  });

  it('marks trip boundaries correctly', () => {
    const trips: CascadeAffectedTrip[] = [
      makeTrip({ tripName: 'T1', timepoints: [makeTimepoint(), makeTimepoint()] }),
      makeTrip({ tripName: 'T2', timepoints: [makeTimepoint()] }),
    ];
    const points = buildTimelinePoints(trips);
    expect(points[0].isTripStart).toBe(true);
    expect(points[1].isTripStart).toBe(false);
    expect(points[2].isTripStart).toBe(true);
  });
});

describe('getTripNodeColor', () => {
  it('returns red when all timepoints are late', () => {
    const trip = makeTrip({ lateTimepointCount: 3, timepoints: [makeTimepoint(), makeTimepoint(), makeTimepoint()] });
    expect(getTripNodeColor(trip)).toBe('red');
  });

  it('returns green when no timepoints are late', () => {
    const trip = makeTrip({ lateTimepointCount: 0 });
    expect(getTripNodeColor(trip)).toBe('green');
  });

  it('returns amber when some but not all timepoints are late', () => {
    const trip = makeTrip({ lateTimepointCount: 1, timepoints: [makeTimepoint(), makeTimepoint()] });
    expect(getTripNodeColor(trip)).toBe('amber');
  });
});
