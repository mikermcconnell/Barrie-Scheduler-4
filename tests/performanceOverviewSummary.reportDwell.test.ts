import { describe, expect, it } from 'vitest';
import { buildPerformanceReportSummary } from '../utils/performanceOverviewSummary';
import type { DailySummary, DwellIncident, PerformanceDataSummary } from '../utils/performanceDataTypes';

function makeIncident(date: string, trackedDwellSeconds: number): DwellIncident {
  return {
    operatorId: 'op-1',
    date,
    routeId: '2',
    routeName: 'Route 2',
    stopName: 'Downtown',
    stopId: '1',
    tripName: 'Trip 1',
    block: 'block-1',
    observedArrivalTime: '07:00:00',
    observedDepartureTime: '07:10:00',
    rawDwellSeconds: trackedDwellSeconds,
    trackedDwellSeconds,
    severity: 'moderate',
  };
}

function makeDay(date: string, incidents: DwellIncident[]): DailySummary {
  return {
    date,
    dayType: 'weekday',
    system: {
      otp: {
        total: 1,
        onTime: 1,
        early: 0,
        late: 0,
        onTimePercent: 100,
        earlyPercent: 0,
        latePercent: 0,
        avgDeviationSeconds: 0,
      },
      totalRidership: 10,
      totalBoardings: 10,
      totalAlightings: 10,
      vehicleCount: 1,
      tripCount: 1,
      wheelchairTrips: 0,
      avgSystemLoad: 1,
      peakLoad: 1,
    },
    byRoute: [],
    byHour: [],
    byStop: [],
    byTrip: [],
    loadProfiles: [],
    byOperatorDwell: {
      incidents,
      byOperator: [{
        operatorId: 'op-1',
        moderateCount: incidents.length,
        highCount: 0,
        totalIncidents: incidents.length,
        totalTrackedDwellSeconds: incidents.reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0),
        avgTrackedDwellSeconds: incidents.length > 0
          ? incidents.reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0) / incidents.length
          : 0,
      }],
      totalIncidents: incidents.length,
      totalTrackedDwellMinutes: incidents.reduce((sum, incident) => sum + incident.trackedDwellSeconds, 0) / 60,
      totalServiceHours: 5,
      incidentsPer100ServiceHours: incidents.length > 0 ? (incidents.length / 5) * 100 : 0,
    },
    dataQuality: {
      totalRecords: 1,
      inBetweenFiltered: 0,
      missingAVL: 0,
      missingAPC: 0,
      detourRecords: 0,
      tripperRecords: 0,
      loadCapped: 0,
      apcExcludedFromLoad: 0,
    },
    schemaVersion: 8,
  };
}

describe('buildPerformanceReportSummary dwell incidents', () => {
  it('keeps latest-day dwell incidents for report rendering but strips earlier days', () => {
    const priorDay = makeDay('2026-04-21', [makeIncident('2026-04-21', 180)]);
    const latestDay = makeDay('2026-04-22', [makeIncident('2026-04-22', 240), makeIncident('2026-04-22', 360)]);

    const summary: PerformanceDataSummary = {
      dailySummaries: [priorDay, latestDay],
      metadata: {
        importedAt: '2026-04-23T00:00:00Z',
        importedBy: 'test',
        dateRange: { start: '2026-04-21', end: '2026-04-22' },
        dayCount: 2,
        totalRecords: 2,
      },
      schemaVersion: 8,
    };

    const reportSummary = buildPerformanceReportSummary(summary);
    const reportPriorDay = reportSummary.dailySummaries.find(day => day.date === '2026-04-21')!;
    const reportLatestDay = reportSummary.dailySummaries.find(day => day.date === '2026-04-22')!;

    expect(reportPriorDay.byOperatorDwell?.incidents).toHaveLength(0);
    expect(reportLatestDay.byOperatorDwell?.incidents).toHaveLength(2);
    expect(reportLatestDay.byOperatorDwell?.totalTrackedDwellMinutes).toBe(10);
  });
});
