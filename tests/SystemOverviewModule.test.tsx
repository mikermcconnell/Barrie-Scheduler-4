import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { DailySummary, DayType, OTPBreakdown, PerformanceDataSummary } from '../utils/performanceDataTypes';

vi.mock('../components/Analytics/AnalyticsShared', () => ({
  MetricCard: (props: {
    label: string;
    value: string;
    subValue?: string;
    secondaryMetric?: { label: string; value: string };
  }) => (
    <div data-testid={`metric-${props.label}`}>
      <span>{props.label}</span>
      <span>{props.value}</span>
      {props.subValue && <span>{props.subValue}</span>}
      {props.secondaryMetric && (
        <span>{props.secondaryMetric.label}: {props.secondaryMetric.value}</span>
      )}
    </div>
  ),
  ChartCard: (props: { title: string; subtitle?: string; children?: React.ReactNode; headerExtra?: React.ReactNode }) => (
    <section>
      <h3>{props.title}</h3>
      {props.subtitle && <p>{props.subtitle}</p>}
      {props.headerExtra}
      {props.children}
    </section>
  ),
}));

vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: React.ReactNode }): React.ReactElement => <div>{children}</div>;
  const Empty = (): null => null;
  return {
    BarChart: Pass,
    Bar: Pass,
    XAxis: Empty,
    YAxis: Empty,
    CartesianGrid: Empty,
    Tooltip: Empty,
    ResponsiveContainer: Pass,
    LineChart: Pass,
    Line: Empty,
    PieChart: Pass,
    Pie: Pass,
    Cell: Empty,
    ReferenceLine: Empty,
    ComposedChart: Pass,
  };
});

import { SystemOverviewModule } from '../components/Performance/SystemOverviewModule';

function otp(total: number, onTime: number, early = 0, late = total - onTime - early): OTPBreakdown {
  return {
    total,
    onTime,
    early,
    late,
    onTimePercent: total > 0 ? (onTime / total) * 100 : 0,
    earlyPercent: total > 0 ? (early / total) * 100 : 0,
    latePercent: total > 0 ? (late / total) * 100 : 0,
    avgDeviationSeconds: late > 0 ? 420 : 0,
  };
}

function buildDay(
  date: string,
  {
    dayType = 'weekday',
    systemOtp = otp(100, 85, 5, 10),
    routeOtp = systemOtp,
    dataQualityTotal = 100,
    missingAVL = 0,
    missingAPC = 0,
    totalRidership = 100,
    totalAlightings = 95,
    scheduledTrips = 10,
    matchedTrips = scheduledTrips,
  }: {
    dayType?: DayType;
    systemOtp?: OTPBreakdown;
    routeOtp?: OTPBreakdown;
    dataQualityTotal?: number;
    missingAVL?: number;
    missingAPC?: number;
    totalRidership?: number;
    totalAlightings?: number;
    scheduledTrips?: number;
    matchedTrips?: number;
  } = {},
): DailySummary {
  return {
    date,
    dayType,
    system: {
      otp: systemOtp,
      totalRidership,
      totalBoardings: totalRidership,
      totalAlightings,
      vehicleCount: 2,
      tripCount: 10,
      wheelchairTrips: 0,
      avgSystemLoad: 10,
      peakLoad: 20,
    },
    byRoute: [{
      routeId: '1',
      routeName: 'Main',
      otp: routeOtp,
      ridership: 100,
      alightings: 95,
      tripCount: 10,
      serviceHours: 5,
      avgLoad: 10,
      maxLoad: 20,
      avgDeviationSeconds: routeOtp.avgDeviationSeconds,
      wheelchairTrips: 0,
    }],
    byHour: [{
      hour: 8,
      otp: systemOtp,
      boardings: 40,
      alightings: 35,
      avgLoad: 10,
    }],
    byStop: [],
    byTrip: [{
      tripId: `trip-${date}`,
      tripName: '08:00 Main',
      block: 'B1',
      routeId: '1',
      routeName: 'Main',
      direction: 'North',
      terminalDepartureTime: '08:00',
      otp: routeOtp,
      boardings: 20,
      maxLoad: 15,
    }],
    loadProfiles: [],
    missedTrips: {
      totalScheduled: scheduledTrips,
      totalMatched: matchedTrips,
      totalMissed: scheduledTrips - matchedTrips,
      missedPct: scheduledTrips > 0 ? ((scheduledTrips - matchedTrips) / scheduledTrips) * 100 : 0,
      notPerformedCount: 0,
      lateOver15Count: 0,
      byRoute: [],
      trips: [],
    },
    dataQuality: {
      totalRecords: dataQualityTotal,
      inBetweenFiltered: 0,
      missingAVL,
      missingAPC,
      detourRecords: 0,
      tripperRecords: 0,
      loadCapped: 0,
      apcExcludedFromLoad: 0,
    },
    schemaVersion: 8,
  };
}

function summary(days: DailySummary[], dateRange = { start: '2026-03-01', end: '2026-03-31' }): PerformanceDataSummary {
  return {
    dailySummaries: days,
    metadata: {
      importedAt: '2026-04-01T12:00:00.000Z',
      importedBy: 'test',
      dateRange,
      dayCount: days.length,
      totalRecords: days.reduce((sum, day) => sum + day.dataQuality.totalRecords, 0),
    },
    schemaVersion: 8,
  };
}

describe('SystemOverviewModule', () => {
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

  function render(data: PerformanceDataSummary, allData = data, dayTypeFilter: DayType | 'all' = 'all'): void {
    flushSync(() => {
      root.render(
        <SystemOverviewModule
          data={data}
          allData={allData}
          onNavigate={vi.fn()}
          scope="combined"
          scopeLabel="2 days selected"
          dayTypeFilter={dayTypeFilter}
        />,
      );
    });
  }

  it('weights system OTP by observations instead of averaging daily percentages', () => {
    render(summary([
      buildDay('2026-03-10', { systemOtp: otp(1, 0, 0, 1), routeOtp: otp(1, 0, 0, 1) }),
      buildDay('2026-03-11', { systemOtp: otp(99, 99, 0, 0), routeOtp: otp(99, 99, 0, 0) }),
    ]));

    const otpMetric = container.querySelector('[data-testid="metric-On-Time Performance"]');
    expect(otpMetric?.textContent).toContain('99%');
    expect(otpMetric?.textContent).not.toContain('50%');
  });

  it('shows additive period totals with an average per selected weekday', () => {
    const data = summary([
      buildDay('2026-03-10', { totalRidership: 120, totalAlightings: 110, scheduledTrips: 12, matchedTrips: 11 }),
      buildDay('2026-03-11', { totalRidership: 280, totalAlightings: 250, scheduledTrips: 14, matchedTrips: 13 }),
    ]);

    render(data, data, 'weekday');

    const ridershipMetric = container.querySelector('[data-testid="metric-Total Ridership"]');
    expect(ridershipMetric?.textContent).toContain('400');
    expect(ridershipMetric?.textContent).toContain('Average per weekday: 200 boardings');
    expect(ridershipMetric?.textContent).toContain('360 total alightings');

    const tripsMetric = container.querySelector('[data-testid="metric-Trips Operated"]');
    expect(tripsMetric?.textContent).toContain('24 / 26');
    expect(tripsMetric?.textContent).toContain('Average per weekday (operated / scheduled): 12 / 13');
    expect(container.textContent).toContain('2 weekdays selected');
    expect(container.textContent).not.toContain('days averaged');
  });

  it('renders operational KPIs before loading the chart bundle', () => {
    render(summary([buildDay('2026-03-10')]));

    expect(container.querySelector('[data-testid="metric-On-Time Performance"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="overview-charts-loading"]')).not.toBeNull();
  });

  it('weights worst-hour OTP by raw observations across days', () => {
    render(summary([
      buildDay('2026-03-10', { systemOtp: otp(10, 0, 0, 10) }),
      buildDay('2026-03-11', { systemOtp: otp(90, 72, 0, 18) }),
    ]));

    expect(container.textContent).toContain('Worst OTP Hour');
    expect(container.textContent).toContain('72% on-time');
    expect(container.textContent).not.toContain('40% on-time');
  });

  it('shows the filtered date range instead of the source import date range', () => {
    render(summary([
      buildDay('2026-03-10'),
      buildDay('2026-03-11'),
    ]));

    expect(container.textContent).toContain('Mar 10, 2026 – Mar 11, 2026');
    expect(container.textContent).not.toContain('Mar 1, 2026 – Mar 31, 2026');
  });

  it('uses full same-day-type peer history for the Action Queue', () => {
    const lowOtp = otp(100, 50, 0, 50);
    const all = summary([
      buildDay('2026-03-09', { systemOtp: lowOtp, routeOtp: lowOtp }),
      buildDay('2026-03-10', { systemOtp: lowOtp, routeOtp: lowOtp }),
      buildDay('2026-03-11', { systemOtp: lowOtp, routeOtp: lowOtp }),
    ]);
    const filtered = summary([all.dailySummaries[2]], { start: '2026-03-11', end: '2026-03-11' });

    render(filtered, all);

    expect(container.textContent).toContain('Action Queue');
    expect(container.textContent).toContain('using Weekday peer days (3 loaded)');
    expect(container.textContent).toContain('1 Main');
  });

  it('labels the OTP trend with the number of all-data days actually plotted', () => {
    const all = summary([
      buildDay('2026-03-09'),
      buildDay('2026-03-10'),
      buildDay('2026-03-11'),
    ]);
    const filtered = summary([all.dailySummaries[2]], { start: '2026-03-11', end: '2026-03-11' });

    render(filtered, all);

    expect(container.textContent).toContain('3-day trend');
    expect(container.textContent).not.toContain('1-day trend');
  });

  it('does not render NaN data-quality percentages for zero-record days', () => {
    render(summary([
      buildDay('2026-03-10', { dataQualityTotal: 0, missingAVL: 3, missingAPC: 2 }),
    ], { start: '2026-03-10', end: '2026-03-10' }));

    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).toContain('Missing AVL: 3 (0%)');
    expect(container.textContent).toContain('Missing APC: 2 (0%)');
  });

  it('labels hourly BPH as an estimate instead of an exact service-hour metric', async () => {
    render(summary([buildDay('2026-03-10')]));

    await vi.waitFor(() => {
      expect(container.textContent).toContain('estimated boardings per service-hour proxy');
      expect(container.textContent).toContain('Estimated BPH proxy');
    });
  });
});
