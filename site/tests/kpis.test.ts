import { describe, expect, it } from 'vitest';
import { attentionItems, computeKpis, ridershipTrend, routeSummaries, statusFor, yearToDate } from '../src/lib/kpis';
import type { ReportData, SystemMonth } from '../src/lib/types';

const month = (m: string, over: Partial<SystemMonth> = {}): SystemMonth => ({
  month: m,
  boardings: 400000,
  revenueHours: 16000,
  scheduledTrips: 18000,
  tripsOperated: 17910,
  onTimePct: 86,
  fareRevenue: 680000,
  operatingCost: 2200000,
  complaints: 40,
  ...over,
});

const data = (over: Partial<ReportData> = {}): ReportData => ({
  system: [month('2025-09', { boardings: 380000, onTimePct: 85.2 }), month('2026-08'), month('2026-09', { onTimePct: 84.3, complaints: 50 })],
  routes: [
    { month: '2025-09', route: '8A', routeName: 'RVH', boardings: 50000, revenueHours: 1700, onTimePct: 82 },
    { month: '2026-09', route: '8A', routeName: 'RVH', boardings: 55000, revenueHours: 1650, onTimePct: 81.2 },
    { month: '2026-09', route: '10', routeName: 'Painswick', boardings: 18000, revenueHours: 1100, onTimePct: 88 },
  ],
  targets: {
    boardings: 400000, boardingsPerRevenueHour: 22, onTimePct: 85, serviceDeliveredPct: 99.5,
    fareboxRecoveryPct: 30, costPerBoarding: 7, revenueHours: 17000, complaintsPer100k: 10,
    annualBoardings: 4800000, annualOperatingBudget: 24000000,
  },
  notes: [{ month: '2026-09', title: 'Construction', detail: 'Duckworth St' }, { month: '2026-08', title: 'Old', detail: '' }],
  sourceFile: 'test.xlsx',
  importedAt: '2026-10-01T00:00:00Z',
  isSample: false,
  ...over,
});

describe('statusFor', () => {
  const higher = { higherIsBetter: true, watchBand: { kind: 'points' as const, amount: 2 } };
  const lower = { higherIsBetter: false, watchBand: { kind: 'relative' as const, amount: 0.05 } };
  it('grades against the target and watch band', () => {
    expect(statusFor(85, 85, higher)).toBe('on-target');
    expect(statusFor(83, 85, higher)).toBe('watch');
    expect(statusFor(82.9, 85, higher)).toBe('below');
    expect(statusFor(7.35, 7, lower)).toBe('watch');
    expect(statusFor(7.4, 7, lower)).toBe('below');
    expect(statusFor(6.5, 7, lower)).toBe('on-target');
    expect(statusFor(null, 7, lower)).toBe('no-data');
    expect(statusFor(5, undefined, lower)).toBe('no-target');
  });
});

describe('computeKpis', () => {
  const kpis = Object.fromEntries(computeKpis(data(), '2026-09').map((k) => [k.id, k]));

  it('derives ratio measures from raw totals', () => {
    expect(kpis.bph.value).toBe(25);
    expect(kpis.serviceDelivered.value).toBeCloseTo(99.5);
    expect(kpis.farebox.value).toBeCloseTo(30.909, 2);
    expect(kpis.costPerBoarding.display).toBe('$5.50');
    expect(kpis.complaints.value).toBeCloseTo(12.5);
  });

  it('compares with the same month last year', () => {
    expect(kpis.boardings.deltaText).toBe('▲ 5.3% vs Sep 2025');
    expect(kpis.boardings.deltaGood).toBe(true);
    expect(kpis.otp.deltaText).toBe('▼ 0.9 pts vs Sep 2025');
    expect(kpis.otp.deltaGood).toBe(false);
    // Fewer complaints would be good, so more is bad.
    expect(kpis.complaints.deltaGood).toBe(false);
  });

  it('grades each measure', () => {
    expect(kpis.boardings.status).toBe('on-target');
    expect(kpis.otp.status).toBe('watch');
    expect(kpis.revenueHours.status).toBe('below');
    expect(kpis.complaints.status).toBe('below');
  });

  it('copes with missing comparison data and inputs', () => {
    const sparse = data({ system: [month('2026-09', { revenueHours: null })], targets: {} });
    const k = Object.fromEntries(computeKpis(sparse, '2026-09').map((x) => [x.id, x]));
    expect(k.boardings.deltaText).toBe('No Sep 2025 data');
    expect(k.boardings.deltaGood).toBeNull();
    expect(k.bph).toMatchObject({ value: null, display: '—', status: 'no-data' });
    expect(k.boardings.status).toBe('no-target');
  });
});

describe('other panels', () => {
  it('builds a 12-month trend with prior-year values', () => {
    const trend = ridershipTrend(data(), '2026-09');
    expect(trend).toHaveLength(12);
    expect(trend[0].month).toBe('2025-10');
    expect(trend[11]).toMatchObject({ month: '2026-09', label: 'Sep', current: 400000, prior: 380000 });
    expect(trend[5].current).toBeNull();
  });

  it('sums the calendar year to date', () => {
    const ytd = yearToDate(data(), '2026-09');
    expect(ytd.elapsedPct).toBe(75);
    expect(ytd.monthsReported).toBe(2);
    expect(ytd.items[0]).toMatchObject({ actual: 800000, target: 4800000 });
    expect(ytd.items[1].target).toBeNull();
  });

  it('ranks routes and flags late ones', () => {
    const routes = routeSummaries(data(), '2026-09');
    expect(routes.map((r) => r.route)).toEqual(['8A', '10']);
    expect(routes[0]).toMatchObject({ yoyText: '▲ 10.0%', yoyGood: true, bphDisplay: '33.3', otpStatus: 'below' });
    expect(routes[1].yoyText).toBe('—');
  });

  it('lists notes for the month, then missed measures, then late routes', () => {
    const d = data();
    const kpis = computeKpis(d, '2026-09');
    const items = attentionItems(d, '2026-09', kpis, routeSummaries(d, '2026-09'));
    expect(items[0]).toMatchObject({ title: 'Construction', source: 'note' });
    expect(items.some((i) => i.title === 'Old')).toBe(false);
    expect(items[1].title).toMatch(/below target$/);
    expect(items[items.length - 1]).toMatchObject({ title: '1 route under the on-time target', body: '8A (81.2%)' });
  });
});

describe('change wording', () => {
  it('says "No change" when the difference rounds to zero', () => {
    const d = data({ system: [month('2025-09', { tripsOperated: 17910 }), month('2026-09', { tripsOperated: 17911 })] });
    const k = computeKpis(d, '2026-09').find((x) => x.id === 'serviceDelivered')!;
    expect(k.deltaText).toBe('No change vs Sep 2025');
    expect(k.deltaGood).toBeNull();
  });
});
