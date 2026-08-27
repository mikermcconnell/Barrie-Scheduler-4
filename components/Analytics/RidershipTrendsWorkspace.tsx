import React, { useMemo } from 'react';
import {
    AlertTriangle,
    ArrowLeft,
    CalendarDays,
    ChartNoAxesCombined,
    Database,
    FileSpreadsheet,
    Info,
    Loader2,
    RefreshCw,
} from 'lucide-react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useRidershipTrendQuery, useTodRidershipProjectionQuery } from '../../hooks/useRidershipTrend';
import { RIDERSHIP_TREND_BASELINE } from '../../utils/ridership-trends/baseline';
import { buildRidershipTrendForecast } from '../../utils/ridership-trends/forecast';
import { buildRidershipTrendView, createRidershipTrendProjection } from '../../utils/ridership-trends/model';
import { summarizeTodRidershipMonth } from '../../utils/ridership-trends/tod';
import type { RidershipTrendCoverageStatus, RidershipTrendSource } from '../../utils/ridership-trends/types';

interface RidershipTrendsWorkspaceProps {
    teamId: string;
    requestingTeamId?: string;
    onBack: () => void;
    accessContext?: 'ridershipTrend' | 'strategicPlan';
    backLabel?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const numberFormatter = new Intl.NumberFormat('en-CA');
const percentFormatter = new Intl.NumberFormat('en-CA', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

function getTorontoDate(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function formatBoardings(value: number | null): string {
    return value === null ? '\u2014' : numberFormatter.format(value);
}

function formatDate(value: string | null): string {
    if (!value) return 'No live reports yet';
    return new Intl.DateTimeFormat('en-CA', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function formatTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('en-CA', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/Toronto',
    }).format(date);
}

function formatTrendComparison(factor: number): string {
    const change = factor - 1;
    if (Math.abs(change) < 0.0005) return 'in line with';
    return `${percentFormatter.format(Math.abs(change))} ${change > 0 ? 'above' : 'below'}`;
}

function sourceLabel(source: RidershipTrendSource): string {
    if (source === 'workbook') return 'Workbook';
    if (source === 'live') return 'STREETS';
    return 'Workbook + STREETS';
}

function coverageClass(status: RidershipTrendCoverageStatus): string {
    if (status === 'complete') return 'bg-emerald-50 text-emerald-700';
    if (status === 'partial') return 'bg-amber-50 text-amber-700';
    return 'bg-gray-100 text-gray-500';
}

const AnnualTrendDot = ({
    cx = 0,
    cy = 0,
    payload,
}: {
    cx?: number;
    cy?: number;
    payload?: { coverage?: RidershipTrendCoverageStatus };
}) => {
    const partial = payload?.coverage !== 'complete';
    return (
        <circle
            cx={cx}
            cy={cy}
            r={partial ? 6 : 4}
            fill={partial ? '#D97706' : '#2563EB'}
            stroke={partial ? '#FEF3C7' : '#DBEAFE'}
            strokeWidth={3}
        />
    );
};

const MetricBlock: React.FC<{
    label: string;
    value: string;
    detail: string;
    tone: 'blue' | 'violet' | 'amber' | 'gray';
}> = ({ label, value, detail, tone }) => {
    const tones = {
        blue: 'border-blue-200 bg-blue-50 text-blue-950',
        violet: 'border-violet-200 bg-violet-50 text-violet-950',
        amber: 'border-amber-200 bg-amber-50 text-amber-950',
        gray: 'border-gray-200 bg-gray-50 text-gray-950',
    };
    return (
        <div className={`rounded-2xl border-2 p-4 ${tones[tone]}`}>
            <p className="text-xs font-bold uppercase tracking-[0.12em] opacity-70">{label}</p>
            <p className="mt-2 text-2xl font-black tabular-nums">{value}</p>
            <p className="mt-1 text-xs leading-5 opacity-75">{detail}</p>
        </div>
    );
};

export const RidershipTrendsWorkspace: React.FC<RidershipTrendsWorkspaceProps> = ({
    teamId,
    requestingTeamId,
    onBack,
    accessContext = 'ridershipTrend',
    backLabel = 'Back to Planning Data',
}) => {
    const trendQuery = useRidershipTrendQuery(teamId, requestingTeamId, true, accessContext);
    const todQuery = useTodRidershipProjectionQuery(teamId, requestingTeamId, true, accessContext);
    const referenceDate = getTorontoDate();
    const projection = trendQuery.data ?? createRidershipTrendProjection({
        baselineHash: RIDERSHIP_TREND_BASELINE.source.sha256,
        updatedAt: new Date().toISOString(),
    });
    const view = useMemo(
        () => buildRidershipTrendView(RIDERSHIP_TREND_BASELINE, projection, referenceDate),
        [projection, referenceDate],
    );
    const forecast = useMemo(
        () => buildRidershipTrendForecast(RIDERSHIP_TREND_BASELINE, view),
        [view],
    );
    const isBaselineOnly = !trendQuery.data;
    const annualData = view.annualSeries.map(year => ({
        year: String(year.year),
        boardings: year.total,
        coverage: year.coverageStatus,
    }));
    const changeData = view.annualChanges.map(change => ({
        year: String(change.year),
        change: change.change === null ? null : change.change * 100,
        suppressed: change.change === null,
    }));
    const comparison = view.completedMonthComparison;
    const comparisonLabel = comparison.throughMonth > 0
        ? `Jan-${MONTHS[comparison.throughMonth - 1]} vs. ${view.activeYear - 1}`
        : 'No completed months yet';
    const activeMonth = view.activePartialMonth;
    const todActiveMonth = useMemo(
        () => summarizeTodRidershipMonth(todQuery.data, referenceDate),
        [todQuery.data, referenceDate],
    );
    const activeMonthName = MONTH_NAMES[Number(referenceDate.slice(5, 7)) - 1] ?? 'Current month';
    const activeMonthObservedDays = activeMonth?.observedDays ?? 0;
    const activeMonthMissingDates = activeMonth?.missingDates.length ?? 0;
    const activeMonthDetail = activeMonth?.total === null || activeMonth?.total === undefined
        ? `Waiting for the first ${activeMonthName} STREETS report`
        : [
            `${numberFormatter.format(activeMonthObservedDays)} report day${activeMonthObservedDays === 1 ? '' : 's'} through ${formatDate(view.latestServiceDate)}`,
            activeMonthMissingDates > 0
                ? `${numberFormatter.format(activeMonthMissingDates)} missing date${activeMonthMissingDates === 1 ? '' : 's'}`
                : 'All expected dates received',
        ].join(' \u00b7 ');
    const todActiveMonthDetail = todActiveMonth.total === null
        ? `Waiting for the first ${activeMonthName} On Demand report`
        : `${numberFormatter.format(todActiveMonth.observedDays)} report day${todActiveMonth.observedDays === 1 ? '' : 's'} from ${formatDate(todActiveMonth.firstServiceDate)} through ${formatDate(todActiveMonth.latestServiceDate)}`;
    const combinedActiveMonthTotal = activeMonth?.total == null || todActiveMonth.total === null
        ? null
        : activeMonth.total + todActiveMonth.total;
    const combinedActiveMonthDetail = combinedActiveMonthTotal === null
        ? 'Available after both scheduled-route and On Demand reports are received'
        : 'Scheduled-route boardings + completed On Demand trips; provisional where either source is incomplete';
    const forecastChartData = forecast?.months.map(month => ({
        month: MONTHS[month.month - 1],
        actual: month.actual,
        projected: month.projected,
    })) ?? [];
    const nextMonthLabel = MONTHS[Number(referenceDate.slice(5, 7))];
    const remainingYearDetail = nextMonthLabel
        ? `Unreported ${activeMonthName} days plus ${nextMonthLabel}-Dec`
        : `Unreported ${activeMonthName} days`;
    const WorkspaceRoot = accessContext === 'strategicPlan' ? 'div' : 'main';

    if (trendQuery.isLoading || todQuery.isLoading) {
        return (
            <div className="flex min-h-[28rem] items-center justify-center" role="status">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                <span className="ml-3 font-semibold text-gray-600">Loading Ridership Trends&hellip;</span>
            </div>
        );
    }

    return (
        <WorkspaceRoot className="min-h-full bg-[#F7F7F7] px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <button
                            type="button"
                            onClick={onBack}
                            className="mb-3 inline-flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold text-gray-600 hover:bg-white hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            {backLabel}
                        </button>
                        <div className="flex items-start gap-3">
                            <div className="rounded-2xl bg-blue-600 p-3 text-white shadow-sm" aria-hidden="true">
                                <ChartNoAxesCombined className="h-6 w-6" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-black tracking-tight text-gray-950 sm:text-3xl">Ridership Trends</h1>
                                <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600">
                                    See scheduled-route and On Demand ridership so far, with scheduled-route history and planning outlook.
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1.5 text-xs font-bold text-blue-800">
                            <Database className="h-3.5 w-3.5" />
                            {isBaselineOnly ? 'Workbook baseline' : 'Workbook + STREETS'}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 ring-1 ring-gray-200">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {view.latestServiceDate ? `Through ${formatDate(view.latestServiceDate)}` : 'No live reports yet'}
                        </span>
                        <button
                            type="button"
                            onClick={() => Promise.all([trendQuery.refetch(), todQuery.refetch()])}
                            disabled={trendQuery.isFetching || todQuery.isFetching}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${trendQuery.isFetching || todQuery.isFetching ? 'animate-spin' : ''}`} />
                            Refresh
                        </button>
                    </div>
                </header>

                {trendQuery.isError && (
                    <div className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                        <div>
                            <p className="font-bold">Live ridership updates are unavailable.</p>
                            <p className="mt-1">Historical workbook totals are still shown. Refresh after confirming the performance data source is available.</p>
                        </div>
                    </div>
                )}

                {todQuery.isError && (
                    <div className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                        <div>
                            <p className="font-bold">On Demand ridership is unavailable.</p>
                            <p className="mt-1">Scheduled-route figures are still shown, but All Transit Ridership cannot be calculated until the On Demand source is available.</p>
                        </div>
                    </div>
                )}

                <section className="rounded-3xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="annual-ridership-title">
                    <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h2 id="annual-ridership-title" className="text-xl font-black text-gray-950">Scheduled-route annual ridership</h2>
                            <p className="mt-1 text-sm text-gray-500">Completed calendar years &middot; exact fixed-route boardings</p>
                        </div>
                        <span className="text-xs font-semibold text-gray-500">Active {view.activeYear} is shown as YTD below</span>
                    </div>
                    <div className="h-80 w-full" role="img" aria-label="Line chart of annual fixed-route boardings for completed calendar years">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={annualData} margin={{ top: 12, right: 16, left: 12, bottom: 4 }} accessibilityLayer>
                                <CartesianGrid stroke="#E5E7EB" strokeDasharray="4 4" vertical={false} />
                                <XAxis dataKey="year" tick={{ fill: '#4B5563', fontSize: 12 }} axisLine={false} tickLine={false} />
                                <YAxis width={72} tickFormatter={value => `${(Number(value) / 1_000_000).toFixed(1)}M`} tick={{ fill: '#6B7280', fontSize: 12 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    formatter={(value) => [numberFormatter.format(Number(value)), 'Fixed-route boardings']}
                                    labelFormatter={label => `Calendar year ${label}`}
                                    contentStyle={{ borderRadius: 16, border: '2px solid #E5E7EB', boxShadow: '0 8px 24px rgba(15,23,42,0.08)' }}
                                />
                                <Line type="monotone" dataKey="boardings" stroke="#2563EB" strokeWidth={4} dot={<AnnualTrendDot />} activeDot={{ r: 6 }} connectNulls={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs leading-5 text-gray-500">
                        <p>This shows long-term direction. It does not identify unique riders or explain why demand changed.</p>
                        {view.annualSeries.some(year => year.coverageStatus !== 'complete') && (
                            <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
                                <span className="h-2.5 w-2.5 rounded-full bg-amber-600 ring-2 ring-amber-100" aria-hidden="true" />
                                Amber points are ended years with incomplete coverage
                            </span>
                        )}
                    </div>
                </section>

                <section className="rounded-3xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="current-month-ridership-title">
                    <div className="mb-4">
                        <h2 id="current-month-ridership-title" className="text-xl font-black text-gray-950">{activeMonthName} ridership so far</h2>
                        <p className="mt-1 text-sm text-gray-500">Actual reported activity, split by service and combined below.</p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                        <MetricBlock
                            tone="blue"
                            label="Scheduled routes"
                            value={formatBoardings(activeMonth?.total ?? null)}
                            detail={activeMonthDetail}
                        />
                        <MetricBlock
                            tone="amber"
                            label="On Demand"
                            value={formatBoardings(todActiveMonth.total)}
                            detail={todActiveMonthDetail}
                        />
                        <MetricBlock
                            tone="violet"
                            label="All transit ridership"
                            value={formatBoardings(combinedActiveMonthTotal)}
                            detail={combinedActiveMonthDetail}
                        />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-gray-500">On Demand counts completed pickups once per trip. Drop-offs are not added again.</p>
                </section>

                <section className="grid gap-3 md:grid-cols-3" aria-label="Scheduled-route ridership summary">
                    <MetricBlock
                        tone="violet"
                        label={`${view.activeYear} scheduled-route YTD`}
                        value={formatBoardings(view.currentYtd.total)}
                        detail={view.currentYtd.coverageComplete ? 'Complete through the evidence date' : 'Provisional where daily reports are incomplete'}
                    />
                    <MetricBlock
                        tone="violet"
                        label="Comparable change"
                        value={comparison.change === null ? '\u2014' : percentFormatter.format(comparison.change)}
                        detail={comparison.coverageComplete ? comparisonLabel : `${comparisonLabel} - suppressed until coverage is complete`}
                    />
                    <MetricBlock
                        tone="amber"
                        label="Scheduled-route reports"
                        value={`${numberFormatter.format(view.liveCoverage.observedDays)} / ${numberFormatter.format(view.liveCoverage.expectedDays)}`}
                        detail={view.liveCoverage.expectedDays === 0
                            ? 'Waiting for the first live report'
                            : view.liveCoverage.complete
                                ? 'All expected live dates received'
                                : `${numberFormatter.format(view.liveCoverage.missingDates.length)} expected date(s) need review`}
                    />
                </section>

                {forecast ? (
                    <section className="rounded-3xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="ridership-forecast-title">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <h2 id="ridership-forecast-title" className="text-xl font-black text-gray-950">{forecast.year} scheduled-route year-end outlook</h2>
                                <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
                                    Actual scheduled-route boardings remain separate from a seasonal estimate for the unreported portion of the year. On Demand is not forecast because comparable history is not yet available.
                                </p>
                            </div>
                            <span className="inline-flex self-start items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1.5 text-xs font-bold text-violet-800">
                                <Info className="h-3.5 w-3.5" />
                                Derived forecast, not a target
                            </span>
                        </div>

                        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <MetricBlock
                                tone="gray"
                                label="Estimated remaining year"
                                value={formatBoardings(forecast.remainingEstimate)}
                                detail={remainingYearDetail}
                            />
                            <MetricBlock
                                tone="amber"
                                label="Low scenario"
                                value={formatBoardings(forecast.lowEstimate)}
                                detail="Base estimate less the backtested median error"
                            />
                            <MetricBlock
                                tone="violet"
                                label={`Base ${forecast.year} projection`}
                                value={formatBoardings(forecast.projectedAnnualTotal)}
                                detail={`${formatBoardings(forecast.actualToDate)} actual to date + estimated remainder`}
                            />
                            <MetricBlock
                                tone="blue"
                                label="High scenario"
                                value={formatBoardings(forecast.highEstimate)}
                                detail="Base estimate plus the backtested median error"
                            />
                        </div>

                        <div className="mt-6 h-72 w-full" role="img" aria-label={`Monthly actual and projected fixed-route boardings for ${forecast.year}`}>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={forecastChartData} margin={{ top: 12, right: 16, left: 12, bottom: 4 }} accessibilityLayer>
                                    <CartesianGrid stroke="#E5E7EB" strokeDasharray="4 4" vertical={false} />
                                    <XAxis dataKey="month" tick={{ fill: '#4B5563', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <YAxis width={72} tickFormatter={value => `${Math.round(Number(value) / 1_000)}K`} tick={{ fill: '#6B7280', fontSize: 12 }} axisLine={false} tickLine={false} />
                                    <Tooltip
                                        formatter={(value, name) => [numberFormatter.format(Number(value)), String(name)]}
                                        contentStyle={{ borderRadius: 16, border: '2px solid #E5E7EB', boxShadow: '0 8px 24px rgba(15,23,42,0.08)' }}
                                    />
                                    <Line type="monotone" dataKey="actual" name="Actual boardings" stroke="#2563EB" strokeWidth={4} dot={{ r: 4 }} connectNulls={false} />
                                    <Line type="monotone" dataKey="projected" name="Projected full month" stroke="#7C3AED" strokeWidth={3} strokeDasharray="7 5" dot={{ r: 4 }} connectNulls={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-gray-600" aria-hidden="true">
                            <span className="inline-flex items-center gap-2"><span className="h-1 w-7 rounded bg-blue-600" />Actual boardings</span>
                            <span className="inline-flex items-center gap-2"><span className="w-7 border-t-2 border-dashed border-violet-600" />Projected full month</span>
                        </div>

                        <div className="mt-5 rounded-2xl bg-gray-50 p-4 text-xs leading-5 text-gray-600">
                            <p className="font-bold text-gray-800">How the base estimate works</p>
                            <p className="mt-1">
                                January-{MONTHS[forecast.completedThroughMonth - 1]} {forecast.year} boardings are {formatTrendComparison(forecast.trendFactor)} the same completed months in {forecast.comparisonYear}. That factor is applied to the {forecast.comparisonYear} monthly pattern for the rest of the year. {activeMonthName} keeps received STREETS days as actual and estimates only unreported days.
                            </p>
                            <p className="mt-2">
                                The range applies the model&apos;s {percentFormatter.format(forecast.backtestMedianAbsoluteError)} median absolute full-year error across {forecast.backtestSampleSize} historical backtests. It is a planning scenario, not an approved target, budget forecast, or explanation of why ridership changed.
                            </p>
                        </div>
                    </section>
                ) : (
                    <section className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm" aria-labelledby="ridership-forecast-unavailable-title">
                        <h2 id="ridership-forecast-unavailable-title" className="text-lg font-black text-gray-950">Year-end outlook not yet available</h2>
                        <p className="mt-1 text-sm leading-6 text-gray-600">
                            A forecast requires at least one complete month in the active year and the matching complete months plus remaining monthly pattern from the prior year.
                        </p>
                    </section>
                )}

                <section className="rounded-3xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="annual-change-title">
                    <div className="mb-4">
                        <h2 id="annual-change-title" className="text-xl font-black text-gray-950">Annual change</h2>
                        <p className="mt-1 text-sm text-gray-500">Year-over-year change for completed years with complete coverage</p>
                    </div>
                    <div className="h-64 w-full" role="img" aria-label="Bar chart of year-over-year percentage change in fixed-route boardings">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={changeData} margin={{ top: 10, right: 16, left: 4, bottom: 2 }} accessibilityLayer>
                                <CartesianGrid stroke="#E5E7EB" strokeDasharray="4 4" vertical={false} />
                                <XAxis dataKey="year" tick={{ fill: '#4B5563', fontSize: 12 }} axisLine={false} tickLine={false} />
                                <YAxis width={56} tickFormatter={value => `${Number(value).toFixed(0)}%`} tick={{ fill: '#6B7280', fontSize: 12 }} axisLine={false} tickLine={false} />
                                <Tooltip
                                    formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Annual change']}
                                    labelFormatter={label => `${label} vs. prior year`}
                                    contentStyle={{ borderRadius: 16, border: '2px solid #E5E7EB' }}
                                />
                                <Bar dataKey="change" radius={[8, 8, 4, 4]}>
                                    {changeData.map(entry => <Cell key={entry.year} fill={(entry.change ?? 0) >= 0 ? '#059669' : '#7C3AED'} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    {view.annualChanges.some(change => change.suppressedReason) && (
                        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                            At least one comparison is hidden because one of the two years has incomplete report coverage.
                        </p>
                    )}
                </section>

                <section className="overflow-hidden rounded-3xl border-2 border-gray-200 bg-white shadow-sm" aria-labelledby="monthly-history-title">
                    <div className="border-b-2 border-gray-100 p-4 sm:p-6">
                        <h2 id="monthly-history-title" className="text-xl font-black text-gray-950">Monthly history</h2>
                        <p className="mt-1 text-sm text-gray-500">The familiar month-by-year view. Scroll horizontally to review the full history.</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-max border-collapse text-sm">
                            <caption className="sr-only">Monthly fixed-route boardings by calendar year</caption>
                            <thead>
                                <tr className="border-b border-gray-200 bg-gray-50">
                                    <th scope="col" className="sticky left-0 z-20 min-w-24 bg-gray-50 px-4 py-3 text-left font-black text-gray-800">Month</th>
                                    {view.years.map(year => (
                                        <th key={year.year} scope="col" className="min-w-36 px-4 py-3 text-right">
                                            <span className="block font-black text-gray-900">{year.year}</span>
                                            <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${coverageClass(year.coverageStatus)}`}>
                                                {sourceLabel(year.source)}
                                            </span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {MONTHS.map((month, monthIndex) => (
                                    <tr key={month} className="border-b border-gray-100 hover:bg-blue-50/30">
                                        <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-3 text-left font-bold text-gray-700">{month}</th>
                                        {view.years.map(year => {
                                            const monthEvidence = view.monthly.find(item => item.year === year.year && item.month === monthIndex + 1);
                                            const isActive = year.year === view.activeYear && monthIndex + 1 === Number(referenceDate.slice(5, 7));
                                            return (
                                                <td
                                                    key={year.year}
                                                    className={`px-4 py-3 text-right font-semibold tabular-nums ${isActive ? 'bg-amber-50 text-amber-900' : 'text-gray-700'}`}
                                                    title={monthEvidence?.missingDates.length ? `${monthEvidence.missingDates.length} expected date(s) missing` : undefined}
                                                >
                                                    {formatBoardings(year.months[monthIndex])}
                                                    {monthEvidence?.coverageStatus === 'partial' && <span className="ml-1 text-amber-600" aria-label="partial coverage">*</span>}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                                <tr className="bg-blue-50/70">
                                    <th scope="row" className="sticky left-0 z-10 bg-blue-50 px-4 py-3 text-left font-black text-blue-950">Total</th>
                                    {view.years.map(year => (
                                        <td key={year.year} className="px-4 py-3 text-right font-black tabular-nums text-blue-950">{formatBoardings(year.total)}</td>
                                    ))}
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex gap-3">
                            <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                            <div>
                                <h2 className="font-black text-gray-950">How to use this evidence</h2>
                                <dl className="mt-3 space-y-2 text-sm leading-5 text-gray-600">
                                    <div><dt className="inline font-bold text-gray-800">Current month: </dt><dd className="inline">scheduled-route boardings plus completed On Demand trips.</dd></div>
                                    <div><dt className="inline font-bold text-gray-800">History and forecast: </dt><dd className="inline">scheduled-route boarding activity only.</dd></div>
                                    <div><dt className="inline font-bold text-gray-800">Supports: </dt><dd className="inline">long-term direction and year-over-year comparison.</dd></div>
                                    <div><dt className="inline font-bold text-gray-800">Cannot prove: </dt><dd className="inline">unique riders, causes of demand change, or complete APC coverage.</dd></div>
                                    <div><dt className="inline font-bold text-gray-800">Next evidence: </dt><dd className="inline">review missing daily files and operational context before making service decisions.</dd></div>
                                </dl>
                            </div>
                        </div>
                    </div>
                    <div className="rounded-3xl border-2 border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex gap-3">
                            <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
                            <div>
                                <h2 className="font-black text-gray-950">Sources and freshness</h2>
                                <p className="mt-3 text-sm leading-6 text-gray-600">
                                    Historical data: <span className="font-bold text-gray-800">{RIDERSHIP_TREND_BASELINE.source.fileName}</span>,
                                    {' '}sheet <span className="font-bold text-gray-800">{RIDERSHIP_TREND_BASELINE.source.sheetName}</span>, through {RIDERSHIP_TREND_BASELINE.source.finalMonth}.
                                </p>
                                <p className="mt-2 text-sm leading-6 text-gray-600">
                                    Automatic updates: daily STREETS fixed-route boardings from {projection.cutoverDate}.
                                </p>
                                <p className="mt-2 text-sm leading-6 text-gray-600">
                                    On Demand updates: completed trips from daily On Demand KPI reports; pickups count once and drop-offs are excluded from ridership.
                                </p>
                                <p className="mt-2 text-xs font-semibold text-gray-500">Last projection update: {isBaselineOnly ? 'No live projection available' : formatTimestamp(projection.updatedAt)}</p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </WorkspaceRoot>
    );
};

export default RidershipTrendsWorkspace;
