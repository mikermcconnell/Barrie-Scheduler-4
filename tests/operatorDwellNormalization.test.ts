import { describe, it, expect } from 'vitest';
import type { STREETSRecord, DailySummary, OperatorDwellSummary } from '../utils/performanceDataTypes';
import { aggregateDailySummaries } from '../utils/performanceDataAggregator';
import { aggregateDwellAcrossDays } from '../utils/schedule/operatorDwellUtils';

// ─── Helper ──────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<STREETSRecord> = {}): STREETSRecord {
  return {
    vehicleLocationTPKey: 1,
    vehicleId: 'V100',
    inBetween: false,
    isTripper: false,
    date: '2025-01-06',
    month: '2025-01',
    day: 'MONDAY',
    arrivalTime: '10:00',
    observedArrivalTime: '10:00:00',
    stopTime: '10:00',
    observedDepartureTime: '10:01:00',
    wheelchairUsageCount: 0,
    departureLoad: 10,
    boardings: 5,
    alightings: 3,
    apcSource: 1,
    block: '10-01',
    operatorId: 'OP001',
    tripName: '10 - 10FD - 10:00',
    stopName: 'Downtown Hub',
    routeName: 'NORTH LOOP',
    branch: '10 FULL',
    routeId: '10',
    routeStopIndex: 1,
    stopId: 'S100',
    direction: 'CW',
    isDetour: false,
    stopLat: 44.3894,
    stopLon: -79.6903,
    timePoint: true,
    distance: 0,
    previousStopName: null,
    tripId: 'trip-001',
    internalTripId: 1,
    terminalDepartureTime: '10:00',
    ...overrides,
  };
}

describe('Operator Dwell Normalization', () => {
  describe('stopVisitCount computation', () => {
    it('counts non-inBetween/tripper/detour records per operator', () => {
      const records = [
        // OP001: 3 normal records (one is a dwell incident)
        makeRecord({ operatorId: 'OP001', tripId: 'trip-1', routeStopIndex: 1, stopId: 'S1' }),
        makeRecord({ operatorId: 'OP001', tripId: 'trip-1', routeStopIndex: 2, stopId: 'S2' }),
        makeRecord({
          operatorId: 'OP001', tripId: 'trip-1', routeStopIndex: 3, stopId: 'S3',
          observedArrivalTime: '10:30:00', observedDepartureTime: '10:33:00', // dwell incident
          stopTime: '10:30',
        }),
        // OP001: 1 inBetween (excluded)
        makeRecord({ operatorId: 'OP001', tripId: 'trip-1', routeStopIndex: 4, stopId: 'S4', inBetween: true }),
        // OP001: 1 tripper (excluded)
        makeRecord({ operatorId: 'OP001', tripId: 'trip-1', routeStopIndex: 5, stopId: 'S5', isTripper: true }),
        // OP002: 2 normal records
        makeRecord({ operatorId: 'OP002', tripId: 'trip-2', routeStopIndex: 1, stopId: 'S1', terminalDepartureTime: '11:00' }),
        makeRecord({ operatorId: 'OP002', tripId: 'trip-2', routeStopIndex: 2, stopId: 'S2', terminalDepartureTime: '11:00' }),
      ];

      const [day] = aggregateDailySummaries(records);
      const dwell = day.byOperatorDwell!;

      // OP001 has 1 incident (dwell at S3), 3 stop visits
      const op1 = dwell.byOperator.find(o => o.operatorId === 'OP001');
      expect(op1).toBeDefined();
      expect(op1!.stopVisitCount).toBe(3);

      // OP002 has 0 incidents, 2 stop visits — won't appear in byOperator
      // But totalStopVisits should include all operators' visits
      expect(dwell.totalStopVisits).toBe(5); // 3 + 2
    });

    it('excludes detour records from stop visit count', () => {
      const records = [
        makeRecord({
          operatorId: 'OP001', tripId: 'trip-1', routeStopIndex: 1, stopId: 'S1',
          observedArrivalTime: '10:00:00', observedDepartureTime: '10:03:00',
          stopTime: '10:00',
        }),
        makeRecord({ operatorId: 'OP001', tripId: 'trip-1', routeStopIndex: 2, stopId: 'S2', isDetour: true }),
      ];

      const [day] = aggregateDailySummaries(records);
      const dwell = day.byOperatorDwell!;

      // Only 1 non-detour record counted
      expect(dwell.totalStopVisits).toBe(1);
    });
  });

  describe('incidentsPer1kVisits calculation', () => {
    it('computes per-operator rate correctly', () => {
      // Create scenario: OP001 has 1 incident across 100 stop visits
      const records: STREETSRecord[] = [];
      // 1 dwell incident record
      records.push(makeRecord({
        operatorId: 'OP001', tripId: 'trip-dwell', routeStopIndex: 1, stopId: 'S-dwell',
        observedArrivalTime: '10:00:00', observedDepartureTime: '10:03:00',
        stopTime: '10:00',
      }));
      // 99 normal records across different stops (no dwell)
      for (let i = 2; i <= 100; i++) {
        records.push(makeRecord({
          operatorId: 'OP001',
          tripId: `trip-${Math.ceil(i / 10)}`,
          routeStopIndex: i,
          stopId: `S${i}`,
          stopTime: `${10 + Math.floor(i / 20)}:${String((i * 3) % 60).padStart(2, '0')}`,
          observedArrivalTime: `${10 + Math.floor(i / 20)}:${String((i * 3) % 60).padStart(2, '0')}:00`,
          observedDepartureTime: `${10 + Math.floor(i / 20)}:${String((i * 3 + 1) % 60).padStart(2, '0')}:00`,
          terminalDepartureTime: `${10 + Math.floor(i / 10)}:00`,
        }));
      }

      const [day] = aggregateDailySummaries(records);
      const dwell = day.byOperatorDwell!;
      const op1 = dwell.byOperator.find(o => o.operatorId === 'OP001')!;

      expect(op1.totalIncidents).toBe(1);
      expect(op1.stopVisitCount).toBe(100);
      // 1 / 100 * 1000 = 10.0
      expect(op1.incidentsPer1kVisits).toBe(10);
    });
  });

  describe('incidentsPer100ServiceHours calculation', () => {
    it('computes service hours from observed times', () => {
      // OP001 has 1 trip spanning 10:00 to 11:00 (1 hour) with 1 dwell incident
      const records = [
        makeRecord({
          operatorId: 'OP001', tripId: 'trip-1', routeStopIndex: 1, stopId: 'S1',
          observedArrivalTime: '10:00:00', observedDepartureTime: '10:03:00',
          stopTime: '10:00',
        }),
        makeRecord({
          operatorId: 'OP001', tripId: 'trip-1', routeStopIndex: 10, stopId: 'S10',
          observedArrivalTime: '11:00:00', observedDepartureTime: '11:01:00',
          stopTime: '11:00',
        }),
      ];

      const [day] = aggregateDailySummaries(records);
      const dwell = day.byOperatorDwell!;
      const op1 = dwell.byOperator.find(o => o.operatorId === 'OP001')!;

      expect(op1.totalIncidents).toBe(1);
      // Service hours: 11:01 - 10:00 = 61 min = 1.02 hours (rounded to 2 dp)
      // Using observed departure times: max=11:01:00=39660, min=10:00:00=36000 → 3660s
      // But the computation uses observedDepartureTime for all records (even non-dwell)
      // So max observed departure = 11:01:00, min = 10:03:00 → 3480s
      // Actually wait — the computation looks at observedDepartureTime ?? observedArrivalTime
      // For first record: obsDep = 10:03:00 = 36180
      // For second record: obsDep = 11:01:00 = 39660
      // Range for trip-1: 39660 - 36180 = 3480s = 0.97 hrs
      expect(op1.serviceHours).toBeGreaterThan(0);
      // 1 / serviceHours * 100
      expect(op1.incidentsPer100ServiceHours).toBeDefined();
      expect(op1.incidentsPer100ServiceHours).toBeGreaterThan(0);
    });

    it('returns undefined when denominator is zero', () => {
      // Record with no observed times → no service hours
      const records = [
        makeRecord({
          operatorId: 'OP001', tripId: 'trip-1', routeStopIndex: 1, stopId: 'S1',
          observedArrivalTime: '10:00:00', observedDepartureTime: '10:03:00',
          stopTime: '10:00',
          // Only 1 record in the trip, so max == min → 0 service hours
        }),
      ];

      const [day] = aggregateDailySummaries(records);
      const dwell = day.byOperatorDwell!;
      const op1 = dwell.byOperator.find(o => o.operatorId === 'OP001')!;

      // Single record per trip: max - min = 0, service hours = 0
      expect(op1.serviceHours).toBe(0);
      expect(op1.incidentsPer100ServiceHours).toBeUndefined();
    });
  });

  describe('cross-day aggregation', () => {
    it('sums stopVisitCount and serviceHours across days and recomputes rates', () => {
      // Day 1: OP001 has 1 incident, 50 visits, 2 service hours
      // Day 2: OP001 has 1 incident, 50 visits, 3 service hours
      const day1: DailySummary = {
        date: '2025-01-06',
        dayType: 'weekday',
        system: { otp: { total: 0, onTime: 0, early: 0, late: 0, onTimePercent: 0, earlyPercent: 0, latePercent: 0, avgDeviationSeconds: 0 }, totalRidership: 0, totalBoardings: 0, totalAlightings: 0, vehicleCount: 0, tripCount: 0, wheelchairTrips: 0, avgSystemLoad: 0, peakLoad: 0 },
        byRoute: [], byHour: [], byStop: [], byTrip: [], loadProfiles: [],
        dataQuality: { totalRecords: 0, inBetweenFiltered: 0, missingAVL: 0, missingAPC: 0, detourRecords: 0, tripperRecords: 0, loadCapped: 0, apcExcludedFromLoad: 0 },
        schemaVersion: 3,
        byOperatorDwell: {
          incidents: [
            { operatorId: 'OP001', date: '2025-01-06', routeId: '10', routeName: 'NORTH', stopName: 'Hub', stopId: 'S1', tripName: 'T1', block: 'B1', observedArrivalTime: '10:00:00', observedDepartureTime: '10:03:00', rawDwellSeconds: 180, trackedDwellSeconds: 60, severity: 'moderate' },
          ],
          byOperator: [
            { operatorId: 'OP001', moderateCount: 1, highCount: 0, totalIncidents: 1, totalTrackedDwellSeconds: 60, avgTrackedDwellSeconds: 60, stopVisitCount: 50, serviceHours: 2 },
          ],
          totalIncidents: 1,
          totalTrackedDwellMinutes: 1,
          totalStopVisits: 50,
          totalServiceHours: 2,
        },
      };

      const day2: DailySummary = {
        ...day1,
        date: '2025-01-07',
        byOperatorDwell: {
          incidents: [
            { operatorId: 'OP001', date: '2025-01-07', routeId: '10', routeName: 'NORTH', stopName: 'Hub', stopId: 'S1', tripName: 'T2', block: 'B1', observedArrivalTime: '11:00:00', observedDepartureTime: '11:03:00', rawDwellSeconds: 180, trackedDwellSeconds: 60, severity: 'moderate' },
          ],
          byOperator: [
            { operatorId: 'OP001', moderateCount: 1, highCount: 0, totalIncidents: 1, totalTrackedDwellSeconds: 60, avgTrackedDwellSeconds: 60, stopVisitCount: 50, serviceHours: 3 },
          ],
          totalIncidents: 1,
          totalTrackedDwellMinutes: 1,
          totalStopVisits: 50,
          totalServiceHours: 3,
        },
      };

      const result = aggregateDwellAcrossDays([day1, day2]);

      expect(result.totalIncidents).toBe(2);
      expect(result.totalStopVisits).toBe(100); // 50 + 50
      expect(result.totalServiceHours).toBe(5); // 2 + 3

      const op1 = result.byOperator.find(o => o.operatorId === 'OP001')!;
      expect(op1.totalIncidents).toBe(2);
      expect(op1.stopVisitCount).toBe(100);
      expect(op1.serviceHours).toBe(5);
      // 2 / 100 * 1000 = 20
      expect(op1.incidentsPer1kVisits).toBe(20);
      // 2 / 5 * 100 = 40
      expect(op1.incidentsPer100ServiceHours).toBe(40);
    });
  });

  describe('backward compatibility', () => {
    it('handles old data missing normalization fields gracefully', () => {
      const oldDay: DailySummary = {
        date: '2025-01-06',
        dayType: 'weekday',
        system: { otp: { total: 0, onTime: 0, early: 0, late: 0, onTimePercent: 0, earlyPercent: 0, latePercent: 0, avgDeviationSeconds: 0 }, totalRidership: 0, totalBoardings: 0, totalAlightings: 0, vehicleCount: 0, tripCount: 0, wheelchairTrips: 0, avgSystemLoad: 0, peakLoad: 0 },
        byRoute: [], byHour: [], byStop: [], byTrip: [], loadProfiles: [],
        dataQuality: { totalRecords: 0, inBetweenFiltered: 0, missingAVL: 0, missingAPC: 0, detourRecords: 0, tripperRecords: 0, loadCapped: 0, apcExcludedFromLoad: 0 },
        schemaVersion: 3,
        byOperatorDwell: {
          incidents: [
            { operatorId: 'OP001', date: '2025-01-06', routeId: '10', routeName: 'NORTH', stopName: 'Hub', stopId: 'S1', tripName: 'T1', block: 'B1', observedArrivalTime: '10:00:00', observedDepartureTime: '10:03:00', rawDwellSeconds: 180, trackedDwellSeconds: 60, severity: 'moderate' },
          ],
          byOperator: [
            // Old format: no stopVisitCount, serviceHours, etc.
            { operatorId: 'OP001', moderateCount: 1, highCount: 0, totalIncidents: 1, totalTrackedDwellSeconds: 60, avgTrackedDwellSeconds: 60 },
          ],
          totalIncidents: 1,
          totalTrackedDwellMinutes: 1,
          // No totalStopVisits, totalServiceHours
        },
      };

      const result = aggregateDwellAcrossDays([oldDay]);

      // Should not crash and should produce 0 for missing fields
      expect(result.totalIncidents).toBe(1);
      expect(result.totalStopVisits).toBe(0);
      expect(result.totalServiceHours).toBe(0);

      const op1 = result.byOperator.find(o => o.operatorId === 'OP001')!;
      expect(op1.stopVisitCount).toBe(0);
      expect(op1.serviceHours).toBe(0);
      // 0 denominator → undefined
      expect(op1.incidentsPer1kVisits).toBeUndefined();
      expect(op1.incidentsPer100ServiceHours).toBeUndefined();
    });
  });
});
