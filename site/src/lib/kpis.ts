import { addMonths, shortMonth, shortMonthYear, splitMonth, toMonthKey } from './months';
import type { MonthKey, Note, ReportData, SystemMonth, TargetKey, Targets } from './types';

export type Status = 'on-target' | 'watch' | 'below' | 'no-target' | 'no-data';

export const STATUS_LABEL: Record<Status, string> = {
  'on-target': 'On target',
  watch: 'Watch',
  below: 'Below',
  'no-target': 'No target',
  'no-data': 'No data',
};

const ratio = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b);

const int = (n: number) => Math.round(n).toLocaleString('en-CA');
const one = (n: number) => n.toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (n: number) => `${one(n)}%`;
const money = (n: number) => `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compactMoney = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : money(n);
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : int(n));

interface KpiDef {
  id: string;
  label: string;
  help: string;
  compute: (m: SystemMonth) => number | null;
  format: (n: number) => string;
  higherIsBetter: boolean;
  targetKey: TargetKey;
  /** How far on the wrong side of target still counts as "Watch". */
  watchBand: { kind: 'relative' | 'points'; amount: number };
  /** How the change from last year is expressed. */
  delta: 'percent' | 'points' | 'absolute' | 'money';
}

export const KPI_DEFS: KpiDef[] = [
  {
    id: 'boardings', label: 'Total boardings', help: 'All fixed-route boardings in the month.',
    compute: (m) => m.boardings, format: int, higherIsBetter: true, targetKey: 'boardings',
    watchBand: { kind: 'relative', amount: 0.03 }, delta: 'percent',
  },
  {
    id: 'bph', label: 'Boardings per revenue hour', help: 'Boardings ÷ revenue hours. Core productivity measure.',
    compute: (m) => ratio(m.boardings, m.revenueHours), format: one, higherIsBetter: true, targetKey: 'boardingsPerRevenueHour',
    watchBand: { kind: 'relative', amount: 0.05 }, delta: 'absolute',
  },
  {
    id: 'otp', label: 'On-time performance', help: 'Timepoint departures between 1 min early and 5 min late.',
    compute: (m) => m.onTimePct, format: pct, higherIsBetter: true, targetKey: 'onTimePct',
    watchBand: { kind: 'points', amount: 2 }, delta: 'points',
  },
  {
    id: 'serviceDelivered', label: 'Service delivered', help: 'Trips operated ÷ trips scheduled.',
    compute: (m) => { const r = ratio(m.tripsOperated, m.scheduledTrips); return r == null ? null : r * 100; },
    format: pct, higherIsBetter: true, targetKey: 'serviceDeliveredPct',
    watchBand: { kind: 'points', amount: 0.5 }, delta: 'points',
  },
  {
    id: 'farebox', label: 'Farebox recovery ratio', help: 'Fare revenue ÷ operating cost.',
    compute: (m) => { const r = ratio(m.fareRevenue, m.operatingCost); return r == null ? null : r * 100; },
    format: pct, higherIsBetter: true, targetKey: 'fareboxRecoveryPct',
    watchBand: { kind: 'points', amount: 2 }, delta: 'points',
  },
  {
    id: 'costPerBoarding', label: 'Operating cost per boarding', help: 'Operating cost ÷ boardings.',
    compute: (m) => ratio(m.operatingCost, m.boardings), format: money, higherIsBetter: false, targetKey: 'costPerBoarding',
    watchBand: { kind: 'relative', amount: 0.05 }, delta: 'money',
  },
  {
    id: 'revenueHours', label: 'Revenue hours operated', help: 'Vehicle hours in passenger service.',
    compute: (m) => m.revenueHours, format: int, higherIsBetter: true, targetKey: 'revenueHours',
    watchBand: { kind: 'relative', amount: 0.02 }, delta: 'percent',
  },
  {
    id: 'complaints', label: 'Complaints per 100k boardings', help: 'Valid complaints ÷ boardings × 100,000.',
    compute: (m) => { const r = ratio(m.complaints, m.boardings); return r == null ? null : r * 100000; },
    format: one, higherIsBetter: false, targetKey: 'complaintsPer100k',
    watchBand: { kind: 'relative', amount: 0.15 }, delta: 'absolute',
  },
];

const OTP_DEF = KPI_DEFS.find((d) => d.id === 'otp')!;

export interface Kpi {
  id: string;
  label: string;
  help: string;
  value: number | null;
  display: string;
  target: number | null;
  targetDisplay: string | null;
  status: Status;
  deltaText: string;
  /** true = moved the good way, false = the bad way, null = no comparison. */
  deltaGood: boolean | null;
}

export function statusFor(value: number | null, target: number | undefined, def: Pick<KpiDef, 'higherIsBetter' | 'watchBand'>): Status {
  if (value == null) return 'no-data';
  if (target == null) return 'no-target';
  const gap = def.higherIsBetter ? value - target : target - value;
  if (gap >= -1e-9) return 'on-target';
  const band = def.watchBand.kind === 'relative' ? Math.abs(target) * def.watchBand.amount : def.watchBand.amount;
  return -gap <= band + 1e-9 ? 'watch' : 'below';
}

function deltaText(def: KpiDef, value: number | null, prior: number | null, priorMonth: MonthKey) {
  const label = `vs ${shortMonthYear(priorMonth)}`;
  if (value == null || prior == null) return { text: `No ${shortMonthYear(priorMonth)} data`, good: null };
  const diff = value - prior;
  const size = Math.abs(diff);
  // Compare at display precision so a change too small to show reads as "no change", not "▲ 0.0".
  const shown = def.delta === 'percent' ? (prior === 0 ? 0 : (size / prior) * 100) : size;
  if (Math.round(shown * (def.delta === 'money' ? 100 : 10)) === 0) return { text: `No change ${label}`, good: null };
  let amount: string;
  switch (def.delta) {
    case 'percent': amount = pct(shown); break;
    case 'points': amount = `${one(size)} pts`; break;
    case 'money': amount = money(size); break;
    default: amount = one(size);
  }
  return { text: `${diff > 0 ? '▲' : '▼'} ${amount} ${label}`, good: (diff > 0) === def.higherIsBetter };
}

export function findMonth(data: ReportData, month: MonthKey) {
  return data.system.find((m) => m.month === month) ?? null;
}

export function computeKpis(data: ReportData, month: MonthKey): Kpi[] {
  const current = findMonth(data, month);
  const priorMonth = addMonths(month, -12);
  const prior = findMonth(data, priorMonth);
  return KPI_DEFS.map((def) => {
    const value = current ? def.compute(current) : null;
    const priorValue = prior ? def.compute(prior) : null;
    const target = data.targets[def.targetKey];
    const delta = deltaText(def, value, priorValue, priorMonth);
    return {
      id: def.id,
      label: def.label,
      help: def.help,
      value,
      display: value == null ? '—' : def.format(value),
      target: target ?? null,
      targetDisplay: target == null ? null : def.format(target),
      status: statusFor(value, target, def),
      deltaText: delta.text,
      deltaGood: delta.good,
    };
  });
}

export interface TrendPoint {
  month: MonthKey;
  label: string;
  current: number | null;
  prior: number | null;
}

/** Boardings for the 12 months ending at `month`, with the same months a year earlier. */
export function ridershipTrend(data: ReportData, month: MonthKey): TrendPoint[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(month, i - 11);
    return {
      month: m,
      label: shortMonth(m),
      current: findMonth(data, m)?.boardings ?? null,
      prior: findMonth(data, addMonths(m, -12))?.boardings ?? null,
    };
  });
}

export interface YtdItem {
  label: string;
  actual: number;
  target: number | null;
  pctOfTarget: number | null;
  text: string;
  /** Spend should track the calendar; the others should run at or ahead of it. */
  isSpend: boolean;
}

export interface Ytd {
  year: number;
  elapsedPct: number;
  monthsReported: number;
  monthsExpected: number;
  items: YtdItem[];
}

export function yearToDate(data: ReportData, month: MonthKey): Ytd {
  const { year, month: m } = splitMonth(month);
  const rows = data.system.filter((r) => r.month >= toMonthKey(year, 1) && r.month <= month);
  const sum = (pick: (r: SystemMonth) => number | null) => rows.reduce((t, r) => t + (pick(r) ?? 0), 0);
  const t: Targets = data.targets;
  const item = (label: string, actual: number, target: number | undefined, fmt: (n: number) => string, isSpend = false): YtdItem => {
    const pctOfTarget = target ? (actual / target) * 100 : null;
    return {
      label,
      actual,
      target: target ?? null,
      pctOfTarget,
      text: target ? `${fmt(actual)} of ${fmt(target)} · ${Math.round(pctOfTarget!)}%` : `${fmt(actual)} · no annual target`,
      isSpend,
    };
  };
  return {
    year,
    elapsedPct: (m / 12) * 100,
    monthsReported: rows.length,
    monthsExpected: m,
    items: [
      item('Ridership', sum((r) => r.boardings), t.annualBoardings, compact),
      item('Revenue hours', sum((r) => r.revenueHours), t.annualRevenueHours, compact),
      item('Fare revenue', sum((r) => r.fareRevenue), t.annualFareRevenue, compactMoney),
      item('Operating budget spent', sum((r) => r.operatingCost), t.annualOperatingBudget, compactMoney, true),
    ],
  };
}

export interface RouteSummary {
  route: string;
  routeName: string;
  boardings: number | null;
  boardingsDisplay: string;
  yoyText: string;
  yoyGood: boolean | null;
  bphDisplay: string;
  otp: number | null;
  otpDisplay: string;
  otpStatus: Status;
}

export function routeSummaries(data: ReportData, month: MonthKey): RouteSummary[] {
  const priorMonth = addMonths(month, -12);
  return data.routes
    .filter((r) => r.month === month)
    .map((r) => {
      const prior = data.routes.find((p) => p.month === priorMonth && p.route === r.route);
      const change = r.boardings != null && prior?.boardings ? ((r.boardings - prior.boardings) / prior.boardings) * 100 : null;
      const bph = ratio(r.boardings, r.revenueHours);
      return {
        route: r.route,
        routeName: r.routeName,
        boardings: r.boardings,
        boardingsDisplay: r.boardings == null ? '—' : int(r.boardings),
        yoyText: change == null ? '—' : `${change > 0 ? '▲' : change < 0 ? '▼' : '■'} ${pct(Math.abs(change))}`,
        yoyGood: change == null || change === 0 ? null : change > 0,
        bphDisplay: bph == null ? '—' : one(bph),
        otp: r.onTimePct,
        otpDisplay: r.onTimePct == null ? '—' : pct(r.onTimePct),
        otpStatus: statusFor(r.onTimePct, data.targets.onTimePct, OTP_DEF),
      };
    })
    .sort((a, b) => (b.boardings ?? -1) - (a.boardings ?? -1));
}

export interface Alert {
  title: string;
  body: string;
  source: 'note' | 'auto';
}

/** Manager notes for the month first, then measures that missed target, then routes below the on-time target. */
export function attentionItems(data: ReportData, month: MonthKey, kpis: Kpi[], routes: RouteSummary[]): Alert[] {
  const notes: Alert[] = data.notes
    .filter((n: Note) => n.month == null || n.month === month)
    .map((n) => ({ title: n.title, body: n.detail, source: 'note' }));
  const missed: Alert[] = kpis
    .filter((k) => k.status === 'below' || k.status === 'watch')
    .sort((a, b) => (a.status === 'below' ? 0 : 1) - (b.status === 'below' ? 0 : 1))
    .map((k) => ({
      title: `${k.label} ${k.status === 'below' ? 'below target' : 'just short of target'}`,
      body: `${k.display} against a target of ${k.targetDisplay}. ${k.deltaText}.`,
      source: 'auto',
    }));
  const lateRoutes = routes.filter((r) => r.otpStatus === 'below' || r.otpStatus === 'watch');
  if (lateRoutes.length) {
    missed.push({
      title: `${lateRoutes.length} route${lateRoutes.length === 1 ? '' : 's'} under the on-time target`,
      body: lateRoutes.slice(0, 6).map((r) => `${r.route} (${r.otpDisplay})`).join(', ') + (lateRoutes.length > 6 ? ', …' : ''),
      source: 'auto',
    });
  }
  return [...notes, ...missed];
}

