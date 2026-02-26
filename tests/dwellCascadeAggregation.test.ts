import { describe, it, expect } from 'vitest';
import { aggregateCascadeAcrossDays } from '../utils/schedule/operatorDwellUtils';
import type {
  DailySummary,
  DailyCascadeMetrics,
  DwellCascade,
  CascadeStopImpact,
  TerminalRecoveryStats,
  DwellSeverity,
} from '../utils/performanceDataTypes';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Minimal DailySummary stub — only the fields the cascade aggregator touches. */
function makeDaySummary(overrides: Partial<DailySummary> = {}): DailySummary {
  return {
    date: '2026-02-20',
    dayType: 'weekday',
    system: { tripCount: 100, routeCount: 10, avgOTP: 0.85, totalRidership: 5000, avgHeadwayAdherencePct: 80, earlyPct: 5, onTimePct: 85, latePct: 10, avgDelaySeconds: 30 },
    byRoute: [],
    byHour: [],
    byStop: [],
    byTrip: [],
    loadProfiles: [],
    dataQuality: { totalRecords: 1000, nullArrivalPct: 0, nullDeparturePct: 0, inBetweenPct: 0, timepointCoverage: 0.95 },
    schemaVersion: 4,
    ...overrides,
  } as DailySummary;
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
    trackedDwellSeconds: 180,
    severity: 'high' as DwellSeverity,
    cascadedTrips: [],
    blastRadius: 0,
    affectedTripCount: 0,
    recoveredAtTrip: null,
    recoveredAtStop: null,
    totalLateSeconds: 0,
    recoveryTimeAvailableSeconds: 0,
    ...overrides,
  };
}

function makeTerminal(overrides: Partial<TerminalRecoveryStats> = {}): TerminalRecoveryStats {
  return {
    stopName: 'Terminal North',
    stopId: 'TN',
    routeId: '10',
    incidentCount: 5,
    absorbedCount: 4,
    cascadedCount: 1,
    avgScheduledRecoverySeconds: 600,
    avgExcessLateSeconds: 120,
    sufficientRecovery: true,
    ...overrides,
  };
}

function makeDailyCascadeMetrics(overrides: Partial<DailyCascadeMetrics> = {}): DailyCascadeMetrics {
  return {
    cascades: [],
    byStop: [],
    byTerminal: [],
    totalCascaded: 0,
    totalNonCascaded: 0,
    avgBlastRadius: 0,
    totalBlastRadius: 0,
    ...overrides,
  };
}

// ─── Task 1: Multi-day aggregation ────────────────────────────────────

describe('aggregateCascadeAcrossDays — multi-day', () => {

  it('merges cascades from multiple days', () => {
    const day1 = makeDaySummary({
      date: '2026-02-20',
      byCascade: makeDailyCascadeMetrics({
        cascades: [
          makeCascade({ date: '2026-02-20', stopName: 'Stop A', stopId: 'SA', blastRadius: 0 }),
          makeCascade({ date: '2026-02-20', stopName: 'Stop B', stopId: 'SB', blastRadius: 2, totalLateSeconds: 600 }),
        ],
        byTerminal: [makeTerminal({ incidentCount: 2, absorbedCount: 1, cascadedCount: 1 })],
      }),
    });
    const day2 = makeDaySummary({
      date: '2026-02-21',
      byCascade: makeDailyCascadeMetrics({
        cascades: [
          makeCascade({ date: '2026-02-21', stopName: 'Stop A', stopId: 'SA', blastRadius: 3, totalLateSeconds: 900 }),
        ],
        byTerminal: [makeTerminal({ incidentCount: 1, absorbedCount: 0, cascadedCount: 1 })],
      }),
    });

    const result = aggregateCascadeAcrossDays([day1, day2]);

    // 3 total cascades from both days
    expect(result.cascades).toHaveLength(3);
    // 2 cascaded (blastRadius > 0)
    expect(result.totalCascaded).toBe(2);
    // 1 non-cascaded (blastRadius === 0)
    expect(result.totalNonCascaded).toBe(1);
    // Total blast radius = 0 + 2 + 3 = 5
    expect(result.totalBlastRadius).toBe(5);
  });

  it('re-aggregates byStop across days (same stop merges)', () => {
    const day1 = makeDaySummary({
      date: '2026-02-20',
      byCascade: makeDailyCascadeMetrics({
        cascades: [
          makeCascade({ date: '2026-02-20', stopName: 'Stop A', stopId: 'SA', routeId: '10', blastRadius: 2, trackedDwellSeconds: 200, totalLateSeconds: 600 }),
        ],
      }),
    });
    const day2 = makeDaySummary({
      date: '2026-02-21',
      byCascade: makeDailyCascadeMetrics({
        cascades: [
          makeCascade({ date: '2026-02-21', stopName: 'Stop A', stopId: 'SA', routeId: '10', blastRadius: 0, trackedDwellSeconds: 150, totalLateSeconds: 0 }),
        ],
      }),
    });

    const result = aggregateCascadeAcrossDays([day1, day2]);

    // Same stop (SA + Route 10) should be merged into one entry
    expect(result.byStop).toHaveLength(1);
    const stop = result.byStop[0];
    expect(stop.stopName).toBe('Stop A');
    expect(stop.incidentCount).toBe(2);
    expect(stop.cascadedCount).toBe(1);
    expect(stop.nonCascadedCount).toBe(1);
    expect(stop.totalBlastRadius).toBe(2);
    expect(stop.totalTrackedDwellSeconds).toBe(350);
  });

  it('re-aggregates byTerminal across days (same terminal merges)', () => {
    const day1 = makeDaySummary({
      date: '2026-02-20',
      byCascade: makeDailyCascadeMetrics({
        cascades: [makeCascade()],
        byTerminal: [makeTerminal({
          stopName: 'Terminal North', stopId: 'TN', routeId: '10',
          incidentCount: 3, absorbedCount: 2, cascadedCount: 1,
          avgScheduledRecoverySeconds: 600, avgExcessLateSeconds: 120,
        })],
      }),
    });
    const day2 = makeDaySummary({
      date: '2026-02-21',
      byCascade: makeDailyCascadeMetrics({
        cascades: [makeCascade()],
        byTerminal: [makeTerminal({
          stopName: 'Terminal North', stopId: 'TN', routeId: '10',
          incidentCount: 2, absorbedCount: 2, cascadedCount: 0,
          avgScheduledRecoverySeconds: 480, avgExcessLateSeconds: 60,
        })],
      }),
    });

    const result = aggregateCascadeAcrossDays([day1, day2]);

    expect(result.byTerminal).toHaveLength(1);
    const terminal = result.byTerminal[0];
    expect(terminal.stopName).toBe('Terminal North');
    expect(terminal.incidentCount).toBe(5); // 3 + 2
    expect(terminal.absorbedCount).toBe(4); // 2 + 2
    expect(terminal.cascadedCount).toBe(1); // 1 + 0
    // Weighted avg recovery: (600*3 + 480*2) / 5 = 2760/5 = 552
    expect(terminal.avgScheduledRecoverySeconds).toBeCloseTo(552, 0);
    // Weighted avg excess: (120*3 + 60*2) / 5 = 480/5 = 96
    expect(terminal.avgExcessLateSeconds).toBeCloseTo(96, 0);
    // 4/5 = 80% absorbed → sufficient (>= 75%)
    expect(terminal.sufficientRecovery).toBe(true);
  });

  it('marks terminal recovery as insufficient when absorbed share is below 75%', () => {
    const day = makeDaySummary({
      date: '2026-02-22',
      byCascade: makeDailyCascadeMetrics({
        cascades: [makeCascade({ blastRadius: 2, totalLateSeconds: 600 })],
        byTerminal: [makeTerminal({
          stopName: 'Terminal North', stopId: 'TN', routeId: '10',
          incidentCount: 4, absorbedCount: 2, cascadedCount: 2,
          avgScheduledRecoverySeconds: 600, avgExcessLateSeconds: 180,
        })],
      }),
    });

    const result = aggregateCascadeAcrossDays([day]);
    expect(result.byTerminal).toHaveLength(1);
    expect(result.byTerminal[0].sufficientRecovery).toBe(false); // 2/4 = 50%
  });

  it('computes avgBlastRadius only from cascaded (blastRadius > 0) incidents', () => {
    const day1 = makeDaySummary({
      date: '2026-02-20',
      byCascade: makeDailyCascadeMetrics({
        cascades: [
          makeCascade({ blastRadius: 0 }),
          makeCascade({ blastRadius: 4, totalLateSeconds: 1200 }),
          makeCascade({ blastRadius: 6, totalLateSeconds: 1800 }),
        ],
      }),
    });

    const result = aggregateCascadeAcrossDays([day1]);

    // avg blast = (4 + 6) / 2 cascaded = 5.0
    expect(result.avgBlastRadius).toBe(5);
    expect(result.totalCascaded).toBe(2);
    expect(result.totalNonCascaded).toBe(1);
  });

  it('handles single-day data identically to multi-day', () => {
    const cascade = makeCascade({ blastRadius: 3, totalLateSeconds: 900 });
    const singleDay = makeDaySummary({
      byCascade: makeDailyCascadeMetrics({
        cascades: [cascade],
        byTerminal: [makeTerminal()],
      }),
    });

    const result = aggregateCascadeAcrossDays([singleDay]);

    expect(result.cascades).toHaveLength(1);
    expect(result.totalCascaded).toBe(1);
    expect(result.totalBlastRadius).toBe(3);
    expect(result.byTerminal).toHaveLength(1);
  });

  it('sorts byStop by totalBlastRadius descending', () => {
    const day = makeDaySummary({
      byCascade: makeDailyCascadeMetrics({
        cascades: [
          makeCascade({ stopName: 'Low Stop', stopId: 'LS', routeId: '10', blastRadius: 1, totalLateSeconds: 300 }),
          makeCascade({ stopName: 'High Stop', stopId: 'HS', routeId: '10', blastRadius: 5, totalLateSeconds: 1500 }),
          makeCascade({ stopName: 'Mid Stop', stopId: 'MS', routeId: '10', blastRadius: 3, totalLateSeconds: 900 }),
        ],
      }),
    });

    const result = aggregateCascadeAcrossDays([day]);

    expect(result.byStop[0].stopName).toBe('High Stop');
    expect(result.byStop[1].stopName).toBe('Mid Stop');
    expect(result.byStop[2].stopName).toBe('Low Stop');
  });
});

// ─── Task 2: Graceful fallback when byCascade is undefined ────────────

describe('aggregateCascadeAcrossDays — undefined byCascade fallback', () => {

  it('returns empty metrics when ALL days have no byCascade (old schema)', () => {
    const oldDay1 = makeDaySummary({ date: '2026-01-10', schemaVersion: 2 });
    delete (oldDay1 as any).byCascade;

    const oldDay2 = makeDaySummary({ date: '2026-01-11', schemaVersion: 2 });
    delete (oldDay2 as any).byCascade;

    const result = aggregateCascadeAcrossDays([oldDay1, oldDay2]);

    expect(result.cascades).toHaveLength(0);
    expect(result.byStop).toHaveLength(0);
    expect(result.byTerminal).toHaveLength(0);
    expect(result.totalCascaded).toBe(0);
    expect(result.totalNonCascaded).toBe(0);
    expect(result.avgBlastRadius).toBe(0);
    expect(result.totalBlastRadius).toBe(0);
  });

  it('handles mix of days WITH and WITHOUT byCascade', () => {
    const oldDay = makeDaySummary({ date: '2026-01-10', schemaVersion: 2 });
    delete (oldDay as any).byCascade;

    const newDay = makeDaySummary({
      date: '2026-02-20',
      schemaVersion: 4,
      byCascade: makeDailyCascadeMetrics({
        cascades: [
          makeCascade({ blastRadius: 3, totalLateSeconds: 900 }),
          makeCascade({ blastRadius: 0 }),
        ],
        byTerminal: [makeTerminal({ incidentCount: 2, absorbedCount: 1, cascadedCount: 1 })],
      }),
    });

    const result = aggregateCascadeAcrossDays([oldDay, newDay]);

    // Only the new day's cascades should be included
    expect(result.cascades).toHaveLength(2);
    expect(result.totalCascaded).toBe(1);
    expect(result.totalNonCascaded).toBe(1);
    expect(result.totalBlastRadius).toBe(3);
    expect(result.byTerminal).toHaveLength(1);
  });

  it('handles byCascade explicitly set to undefined', () => {
    const day = makeDaySummary({ byCascade: undefined });

    const result = aggregateCascadeAcrossDays([day]);

    expect(result.cascades).toHaveLength(0);
    expect(result.totalCascaded).toBe(0);
  });

  it('handles empty daily summaries array', () => {
    const result = aggregateCascadeAcrossDays([]);

    expect(result.cascades).toHaveLength(0);
    expect(result.byStop).toHaveLength(0);
    expect(result.byTerminal).toHaveLength(0);
    expect(result.totalCascaded).toBe(0);
  });

  it('handles byCascade with empty cascades array', () => {
    const day = makeDaySummary({
      byCascade: makeDailyCascadeMetrics({ cascades: [] }),
    });

    const result = aggregateCascadeAcrossDays([day]);

    expect(result.cascades).toHaveLength(0);
    expect(result.totalCascaded).toBe(0);
    expect(result.totalNonCascaded).toBe(0);
  });

  it('hasCascadeData check: .some(d => d.byCascade) is false when all undefined', () => {
    const days: DailySummary[] = [
      makeDaySummary({ date: '2026-01-10' }),
      makeDaySummary({ date: '2026-01-11' }),
    ];
    delete (days[0] as any).byCascade;
    delete (days[1] as any).byCascade;

    const hasCascadeData = days.some(d => d.byCascade);
    expect(hasCascadeData).toBe(false);
  });

  it('hasCascadeData check: .some(d => d.byCascade) is true when at least one day has it', () => {
    const days: DailySummary[] = [
      makeDaySummary({ date: '2026-01-10' }),
      makeDaySummary({
        date: '2026-02-20',
        byCascade: makeDailyCascadeMetrics({ cascades: [makeCascade()] }),
      }),
    ];
    delete (days[0] as any).byCascade;

    const hasCascadeData = days.some(d => d.byCascade);
    expect(hasCascadeData).toBe(true);
  });
});
