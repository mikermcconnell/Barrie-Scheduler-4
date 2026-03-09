import { describe, expect, it } from 'vitest';
import {
  buildCascadeLateDepartureImpactByRoute,
  buildCascadeLateTripsByRoute,
} from '../utils/schedule/cascadeImpactUtils';
import type {
  CascadeAffectedTrip,
  DailySummary,
  DwellCascade,
  DwellSeverity,
  OTPBreakdown,
} from '../utils/performanceDataTypes';

function makeOtp(total: number, onTime: number = total): OTPBreakdown {
  return {
    total,
    onTime,
    early: 0,
    late: total - onTime,
    onTimePercent: total === 0 ? 0 : (onTime / total) * 100,
    earlyPercent: 0,
    latePercent: total === 0 ? 0 : ((total - onTime) / total) * 100,
    avgDeviationSeconds: 0,
  };
}

function makeDaySummary(overrides: Partial<DailySummary> = {}): DailySummary {
  return {
    date: '2026-02-20',
    dayType: 'weekday',
    system: {
      otp: makeOtp(200, 180),
      totalRidership: 0,
      totalBoardings: 0,
      totalAlightings: 0,
      vehicleCount: 0,
      tripCount: 0,
      wheelchairTrips: 0,
      avgSystemLoad: 0,
      peakLoad: 0,
    },
    byRoute: [],
    byHour: [],
    byStop: [],
    byTrip: [],
    loadProfiles: [],
    dataQuality: {
      totalRecords: 0,
      inBetweenFiltered: 0,
      missingAVL: 0,
      missingAPC: 0,
      detourRecords: 0,
      tripperRecords: 0,
      loadCapped: 0,
      apcExcludedFromLoad: 0,
    },
    schemaVersion: 5,
    ...overrides,
  };
}

function makeTrip(overrides: Partial<CascadeAffectedTrip> = {}): CascadeAffectedTrip {
  return {
    tripName: 'Trip-2',
    tripId: 'trip-2',
    routeId: '20',
    routeName: 'Route 20',
    terminalDepartureTime: '08:30',
    scheduledRecoverySeconds: 300,
    observedRecoverySeconds: 300,
    timepoints: [],
    lateTimepointCount: 1,
    recoveredAtStop: null,
    otpStatus: 'late',
    recoveredHere: false,
    lateSeconds: 360,
    ...overrides,
  };
}

function makeCascade(overrides: Partial<DwellCascade> = {}): DwellCascade {
  return {
    date: '2026-02-20',
    block: '10-01',
    routeId: '10',
    routeName: 'Route 10',
    stopName: 'Stop A',
    stopId: 'SA',
    tripName: 'Trip-1',
    operatorId: 'OP1',
    observedDepartureTime: '08:15:00',
    trackedDwellSeconds: 300,
    severity: 'high' as DwellSeverity,
    cascadedTrips: [],
    blastRadius: 0,
    affectedTripCount: 0,
    recoveredAtTrip: null,
    recoveredAtStop: null,
    totalLateSeconds: 0,
    recoveryTimeAvailableSeconds: 300,
    observedRecoverySeconds: 300,
    ...overrides,
  };
}

describe('cascadeImpactUtils', () => {
  it('dedupes downstream late trips across multiple cascades in route attribution', () => {
    const cascades: DwellCascade[] = [
      makeCascade({
        date: '2026-02-20',
        cascadedTrips: [makeTrip({ tripId: 'shared-trip', routeId: '20', routeName: 'Route 20' })],
        blastRadius: 1,
      }),
      makeCascade({
        date: '2026-02-20',
        tripName: 'Trip-1B',
        stopId: 'SB',
        stopName: 'Stop B',
        cascadedTrips: [makeTrip({ tripId: 'shared-trip', routeId: '20', routeName: 'Route 20' })],
        blastRadius: 1,
      }),
    ];

    const days = [
      makeDaySummary({
        byRoute: [
          { routeId: '20', routeName: 'Route 20', tripCount: 10, otp: makeOtp(40, 35) } as any,
        ],
      }),
    ];

    const rows = buildCascadeLateTripsByRoute(cascades, days);

    expect(rows).toHaveLength(1);
    expect(rows[0].routeId).toBe('20');
    expect(rows[0].cascadeCausedTrips).toBe(1);
    expect(rows[0].otpPenaltyPp).toBe(10);
  });

  it('attributes slide-over OTP impact to downstream routes, not the origin route', () => {
    const cascade = makeCascade({
      routeId: '10',
      routeName: 'Route 10',
      cascadedTrips: [
        makeTrip({ routeId: '20', routeName: 'Route 20', tripId: 'trip-20', lateTimepointCount: 2 }),
        makeTrip({ routeId: '30', routeName: 'Route 30', tripId: 'trip-30', lateTimepointCount: 1 }),
      ],
      blastRadius: 3,
    });

    const days = [
      makeDaySummary({
        byRoute: [
          { routeId: '10', routeName: 'Route 10', tripCount: 8, otp: makeOtp(16, 15) } as any,
          { routeId: '20', routeName: 'Route 20', tripCount: 12, otp: makeOtp(24, 22) } as any,
          { routeId: '30', routeName: 'Route 30', tripCount: 6, otp: makeOtp(12, 11) } as any,
        ],
      }),
    ];

    const impact = buildCascadeLateDepartureImpactByRoute(cascade, days);

    expect(impact).toHaveLength(2);
    expect(impact.map(row => row.routeId)).toEqual(['20', '30']);
    expect(impact[0].lateDepartures).toBe(2);
    expect(impact[0].assessedDepartures).toBe(24);
    expect(impact[0].penaltyPct).toBeCloseTo(8.33, 1);
    expect(impact[1].lateDepartures).toBe(1);
    expect(impact[1].assessedDepartures).toBe(12);
  });
});
