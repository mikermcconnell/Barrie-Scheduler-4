import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { DailySummary, OTPBreakdown, PerformanceDataSummary, RouteMetrics } from '../utils/performanceDataTypes';

vi.mock('../components/Analytics/AnalyticsShared', () => ({
  ChartCard: ({ title, children }: { title: string; children?: React.ReactNode }) => <section><h3>{title}</h3>{children}</section>,
}));

vi.mock('../components/Performance/RidershipHeatmapSection', () => ({ RidershipHeatmapSection: () => null }));
vi.mock('../components/Performance/StopActivityMap', () => ({ StopActivityMap: () => null }));
vi.mock('../components/Performance/TodPickupSection', () => ({ TodPickupSection: () => null }));

vi.mock('recharts', () => {
  const Chart = ({ data, children }: { data?: unknown; children?: React.ReactNode }) => (
    <div data-chart={data ? JSON.stringify(data) : undefined}>{children}</div>
  );
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Empty = () => null;
  return {
    AreaChart: Chart, BarChart: Chart, LineChart: Chart, ScatterChart: Chart, ComposedChart: Chart,
    ResponsiveContainer: Pass, Area: Pass, Bar: Pass,
    XAxis: Empty, YAxis: Empty, CartesianGrid: Empty, Tooltip: Empty, Legend: Empty,
    ReferenceLine: Empty, Line: Empty, Cell: Empty, Scatter: Empty, LabelList: Empty,
  };
});

import { RidershipModule } from '../components/Performance/RidershipModule';
import { OTPModule } from '../components/Performance/OTPModule';
import { LoadProfileModule } from '../components/Performance/LoadProfileModule';

function otp(total: number, onTime: number, avgDeviationSeconds = 0): OTPBreakdown {
  return {
    total, onTime, early: 0, late: total - onTime,
    onTimePercent: total ? onTime / total * 100 : 0,
    earlyPercent: 0,
    latePercent: total ? (total - onTime) / total * 100 : 0,
    avgDeviationSeconds,
  };
}

function route(routeId: string, ridership: number, routeOtp = otp(10, 8)): RouteMetrics {
  return {
    routeId, routeName: `Route ${routeId}`, otp: routeOtp, ridership, alightings: ridership,
    tripCount: 1, serviceHours: 1, avgLoad: 10, maxLoad: 20,
    avgDeviationSeconds: routeOtp.avgDeviationSeconds, wheelchairTrips: 0,
  };
}

function day(date: string, routes: RouteMetrics[], maxLoad = 20): DailySummary {
  const systemOtp = routes[0]?.otp ?? otp(0, 0);
  return {
    date, dayType: 'weekday',
    system: {
      otp: systemOtp,
      totalRidership: routes.reduce((sum, r) => sum + r.ridership, 0),
      totalBoardings: routes.reduce((sum, r) => sum + r.ridership, 0),
      totalAlightings: routes.reduce((sum, r) => sum + r.alightings, 0),
      vehicleCount: 1, tripCount: 1, wheelchairTrips: 0, avgSystemLoad: 10, peakLoad: maxLoad,
    },
    byRoute: routes,
    byHour: [], byStop: [],
    byTrip: [{
      tripId: `trip-${date}`, tripName: 'Trip 08:00', block: 'B1',
      routeId: routes[0]?.routeId ?? '1', routeName: routes[0]?.routeName ?? 'Route 1',
      direction: 'North', terminalDepartureTime: '08:00', otp: systemOtp,
      boardings: 10, maxLoad,
    }],
    loadProfiles: [{
      routeId: routes[0]?.routeId ?? '1', routeName: routes[0]?.routeName ?? 'Route 1',
      direction: 'North', tripCount: 1,
      stops: [{ stopName: 'Terminal', stopId: 'S1', routeStopIndex: 1, avgBoardings: 1, avgAlightings: 1, avgLoad: maxLoad, maxLoad, isTimepoint: true }],
    }],
    dataQuality: {
      totalRecords: 10, inBetweenFiltered: 0, missingAVL: 0, missingAPC: 0,
      detourRecords: 0, tripperRecords: 0, loadCapped: 0, apcExcludedFromLoad: 0,
    },
    schemaVersion: 8,
  };
}

function summary(days: DailySummary[]): PerformanceDataSummary {
  return {
    dailySummaries: days,
    metadata: { importedAt: '', importedBy: '', dateRange: { start: days[0].date, end: days.at(-1)!.date }, dayCount: days.length, totalRecords: days.length * 10 },
    schemaVersion: 8,
  };
}

describe('performance dashboard metric rollups', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    container.remove();
  });

  it('uses distinct calendar days for a combined route daily average', () => {
    const data = summary([
      day('2026-03-10', [route('7A', 100), route('7B', 200)]),
      day('2026-03-11', [route('7A', 100), route('7B', 200)]),
    ]);
    flushSync(() => root.render(<RidershipModule data={data} />));

    const combinedRow = [...container.querySelectorAll('tbody tr')].find(row => row.textContent?.includes('7A/7B'));
    expect(combinedRow?.querySelectorAll('td')[2].textContent).toBe('600');
    expect(combinedRow?.querySelectorAll('td')[3].textContent).toBe('300');
  });

  it('weights route average deviation by OTP observations', () => {
    const data = summary([
      day('2026-03-10', [route('1', 100, otp(10, 0, 600))]),
      day('2026-03-11', [route('1', 100, otp(90, 90, 0))]),
    ]);
    flushSync(() => root.render(<OTPModule data={data} />));

    const chartData = [...container.querySelectorAll('[data-chart]')].map(node => node.getAttribute('data-chart') ?? '');
    expect(chartData.some(value => value.includes('"avgDeviation":60'))).toBe(true);
    expect(chartData.some(value => value.includes('"avgDeviation":300'))).toBe(false);
  });

  it('excludes missing zero-load observations from peak-load trip averages', () => {
    const data = summary([
      day('2026-03-10', [route('1', 100)], 40),
      day('2026-03-11', [route('1', 100)], 0),
      day('2026-03-12', [route('1', 100)], 0),
      day('2026-03-13', [route('1', 100)], 0),
      day('2026-03-14', [route('1', 100)], 0),
    ]);
    flushSync(() => root.render(<LoadProfileModule data={data} />));

    const chartData = [...container.querySelectorAll('[data-chart]')].map(node => node.getAttribute('data-chart') ?? '');
    expect(chartData.some(value => value.includes('"avgMaxLoad":40') && value.includes('"count":1'))).toBe(true);
  });
});
