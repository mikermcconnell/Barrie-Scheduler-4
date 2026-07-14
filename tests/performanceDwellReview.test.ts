import { describe, expect, it } from 'vitest';
import {
  buildDwellIncidentReviewModel,
  buildFilteredDwellIncidentReviewModel,
} from '../utils/performanceDwellReview';
import type { DailySummary, DwellCascade, DwellIncident } from '../utils/performanceDataTypes';

function incident(overrides: Partial<DwellIncident> = {}): DwellIncident {
  return {
    incidentId: 'incident-1',
    operatorId: 'OP2',
    date: '2026-07-01',
    routeId: '10',
    routeName: 'Route 10',
    stopName: 'Main Terminal',
    stopId: 'MT',
    tripName: 'Trip 10-0800',
    block: '10-01',
    observedArrivalTime: '08:00:00',
    observedDepartureTime: '08:06:00',
    rawDwellSeconds: 360,
    trackedDwellSeconds: 360,
    severity: 'high',
    departureDeviationSeconds: 360,
    ...overrides,
  };
}

function cascade(overrides: Partial<DwellCascade> = {}): DwellCascade {
  return {
    incidentId: 'incident-1',
    date: '2026-07-01',
    block: '10-01',
    routeId: '10',
    routeName: 'Route 10',
    stopName: 'Main Terminal',
    stopId: 'MT',
    tripName: 'Trip 10-0800',
    operatorId: 'OP2',
    observedDepartureTime: '08:06:00',
    trackedDwellSeconds: 360,
    severity: 'high',
    cascadedTrips: [],
    blastRadius: 2,
    affectedTripCount: 1,
    recoveredAtTrip: null,
    recoveredAtStop: null,
    totalLateSeconds: 600,
    recoveryTimeAvailableSeconds: 300,
    incidentRecordMatched: true,
    sameTripObserved: true,
    sameTripMissingObservedTimepointCount: 0,
    laterTripMissingObservedTimepointCount: 0,
    ...overrides,
  };
}

function day(date: string, incidents: DwellIncident[], cascades: DwellCascade[] = []): DailySummary {
  return {
    date,
    dayType: 'weekday',
    schemaVersion: 12,
    byOperatorDwell: {
      incidents,
      byOperator: [],
      totalIncidents: incidents.filter(row => row.severity !== 'minor').length,
      totalTrackedDwellMinutes: 0,
      exposureByRouteOperator: [
        { routeId: '10', operatorId: 'OP2', eligibleTimepointVisits: 80 },
        { routeId: '10', operatorId: 'OP1', eligibleTimepointVisits: 20 },
      ],
    },
    byCascade: {
      cascades,
      byStop: [],
      byTerminal: [],
      totalCascaded: 0,
      totalNonCascaded: 0,
      avgBlastRadius: 0,
      totalBlastRadius: 0,
    },
  } as unknown as DailySummary;
}

describe('Dwell Incident Review model', () => {
  it('uses reportable incidents, exposure-matched rates, and incident-id cascade joins', () => {
    const high = incident();
    const minor = incident({ incidentId: 'minor', severity: 'minor', trackedDwellSeconds: 60 });
    const model = buildDwellIncidentReviewModel([day('2026-07-01', [minor, high], [cascade()])]);

    expect(model.rows).toHaveLength(1);
    expect(model.rows[0].impactStatus).toBe('otp-late');
    expect(model.rows[0].confidence).toBe('high');
    expect(model.totalIncidents).toBe(1);
    expect(model.highCount).toBe(1);
    expect(model.otpLateDepartures).toBe(2);
    expect(model.eligibleTimepointVisits).toBe(100);
    expect(model.incidentsPer1kEligibleVisits).toBe(10);
  });

  it('orders high severity before impact and then uses downstream impact within severity', () => {
    const high = incident({ incidentId: 'high', trackedDwellSeconds: 301 });
    const moderate = incident({ incidentId: 'moderate', severity: 'moderate', trackedDwellSeconds: 500, observedDepartureTime: '09:00:00' });
    const model = buildDwellIncidentReviewModel([day('2026-07-01', [moderate, high], [
      cascade({ incidentId: 'high', blastRadius: 0, affectedTripCount: 0 }),
      cascade({ incidentId: 'moderate', blastRadius: 5, affectedTripCount: 3, observedDepartureTime: '09:00:00' }),
    ])]);

    expect(model.rows.map(row => row.incident.incidentId)).toEqual(['high', 'moderate']);
  });

  it('identifies recurring route-trip-stop patterns on three distinct days', () => {
    const days = ['2026-07-01', '2026-07-02', '2026-07-03'].map((date, index) => {
      const id = `incident-${index}`;
      return day(date, [incident({ incidentId: id, date })], [cascade({ incidentId: id, date })]);
    });
    const model = buildDwellIncidentReviewModel(days);

    expect(model.patterns).toHaveLength(1);
    expect(model.patterns[0]).toMatchObject({ distinctDays: 3, incidentCount: 3, operatorCount: 1 });
    expect(model.operatorContext.map(row => row.operatorId)).toEqual(['OP1', 'OP2']);
  });

  it('treats legacy missing exposure and cascade evidence as unavailable, not zero', () => {
    const legacy = day('2026-07-01', [incident({ incidentId: undefined })]);
    legacy.schemaVersion = 11;
    delete legacy.byOperatorDwell!.exposureByRouteOperator;
    delete legacy.byCascade;

    const model = buildDwellIncidentReviewModel([legacy]);
    expect(model.eligibleTimepointVisits).toBeNull();
    expect(model.incidentsPer1kEligibleVisits).toBeNull();
    expect(model.rows[0].impactStatus).toBe('unknown');
    expect(model.daysNeedingReimport).toEqual(['2026-07-01']);
  });

  it('does not publish a partial exposure rate for mixed legacy and v12 days', () => {
    const modern = day('2026-07-02', [incident({ date: '2026-07-02', incidentId: 'modern' })]);
    const legacy = day('2026-07-01', [incident({ date: '2026-07-01', incidentId: undefined })]);
    legacy.schemaVersion = 11;
    delete legacy.byOperatorDwell!.exposureByRouteOperator;

    const model = buildDwellIncidentReviewModel([legacy, modern]);
    expect(model.totalIncidents).toBe(2);
    expect(model.eligibleTimepointVisits).toBeNull();
    expect(model.incidentsPer1kEligibleVisits).toBeNull();
  });

  it('does not rank or total downstream values from an explicitly unmatched cascade', () => {
    const unmatched = cascade({ incidentRecordMatched: false, blastRadius: 9, affectedTripCount: 5 });
    const model = buildDwellIncidentReviewModel([day('2026-07-01', [incident()], [unmatched])]);

    expect(model.rows[0].impactStatus).toBe('unknown');
    expect(model.rows[0].confidence).toBe('limited');
    expect(model.otpLateDepartures).toBe(0);
    expect(model.otpCarryoverIncidentCount).toBe(0);
  });

  it('requires schema v12 before publishing exposure rates even when a legacy payload contains exposure rows', () => {
    const legacy = day('2026-07-01', [incident()]);
    legacy.schemaVersion = 11;

    const model = buildDwellIncidentReviewModel([legacy]);
    expect(model.eligibleTimepointVisits).toBeNull();
    expect(model.dailyTrend[0].incidentsPer1kEligibleVisits).toBeNull();
  });

  it('rebuilds export patterns and daily counts from the filtered incident rows', () => {
    const days = ['2026-07-01', '2026-07-02', '2026-07-03'].map((date, index) => {
      const kept = incident({ incidentId: `kept-${index}`, date, operatorId: 'OP1' });
      const removed = incident({ incidentId: `removed-${index}`, date, operatorId: 'OP2', stopId: 'OTHER', stopName: 'Other Stop' });
      return day(date, [kept, removed]);
    });
    const full = buildDwellIncidentReviewModel(days);
    const filteredRows = full.rows.filter(row => row.incident.operatorId === 'OP1');
    const filtered = buildFilteredDwellIncidentReviewModel(days, filteredRows);

    expect(filtered.totalIncidents).toBe(3);
    expect(filtered.patterns).toHaveLength(1);
    expect(filtered.operatorContext.map(row => row.operatorId)).toEqual(['OP1']);
    expect(filtered.dailyTrend.map(point => point.incidents)).toEqual([1, 1, 1]);
    expect(filtered.eligibleTimepointVisits).toBeNull();
  });
});
