import { describe, expect, it } from 'vitest';
import { mergeRebuiltDailySummaries, resolveRebuildWindow } from '../functions/src/index';
import type { DailySummary, STREETSRecord } from '../functions/src/types';
import { aggregateDailySummaries } from '../functions/src/aggregator';

function makeRecord(overrides: Partial<STREETSRecord> = {}): STREETSRecord {
  return {
    vehicleLocationTPKey: 1,
    vehicleId: '2302',
    inBetween: false,
    isTripper: false,
    date: '2026-03-24',
    month: '2026-03',
    day: 'DAY_OF_WEEK',
    arrivalTime: '07:00',
    observedArrivalTime: '07:00:30',
    stopTime: '07:00',
    observedDepartureTime: '07:01:00',
    wheelchairUsageCount: 0,
    departureLoad: 10,
    boardings: 3,
    alightings: 1,
    apcSource: 1,
    block: '2-01',
    operatorId: '4486',
    tripName: '2A - 07:00',
    stopName: 'Stop A',
    routeName: 'ROUTE 2',
    branch: '2A FULL',
    routeId: '2A',
    routeStopIndex: 0,
    stopId: 'stop-a',
    direction: 'N',
    isDetour: false,
    stopLat: 44.38,
    stopLon: -79.69,
    timePoint: true,
    distance: 0,
    previousStopName: null,
    tripId: 'trip-001',
    internalTripId: 1,
    terminalDepartureTime: '07:00',
    ...overrides,
  };
}

function makeSummary(date: string, routeId: string, boardings: number): DailySummary {
  return aggregateDailySummaries([
    makeRecord({ date, routeId, routeName: `ROUTE ${routeId}`, boardings, tripId: `${routeId}-${date}` }),
    makeRecord({
      date,
      routeId,
      routeName: `ROUTE ${routeId}`,
      boardings: 0,
      tripId: `${routeId}-${date}`,
      routeStopIndex: 1,
      stopId: `${routeId}-${date}-last`,
      stopName: 'Stop B',
      arrivalTime: '07:10',
      stopTime: '07:10',
      observedArrivalTime: '07:11:00',
      observedDepartureTime: '07:11:30',
    }),
  ])[0];
}

describe('functions performance rebuild helpers', () => {
  it('builds a trailing rebuild window when only days are supplied', () => {
    const window = resolveRebuildWindow(new Date('2026-03-30T12:00:00Z'), undefined, undefined, 7);
    expect(window).toEqual({
      startDate: '2026-03-24',
      endDate: '2026-03-30',
    });
  });

  it('replaces only rebuilt days inside the selected window', () => {
    const existing = [
      makeSummary('2026-03-20', '10', 10),
      makeSummary('2026-03-21', '10', 11),
      makeSummary('2026-03-22', '10', 12),
    ];
    const rebuilt = [
      makeSummary('2026-03-21', '10', 99),
      makeSummary('2026-03-22', '10', 88),
    ];

    const merged = mergeRebuiltDailySummaries(existing, rebuilt, '2026-03-21', '2026-03-22');

    expect(merged.map(summary => summary.date)).toEqual(['2026-03-20', '2026-03-21', '2026-03-22']);
    expect(merged.find(summary => summary.date === '2026-03-20')?.system.totalBoardings).toBe(10);
    expect(merged.find(summary => summary.date === '2026-03-21')?.system.totalBoardings).toBe(99);
    expect(merged.find(summary => summary.date === '2026-03-22')?.system.totalBoardings).toBe(88);
  });
});
