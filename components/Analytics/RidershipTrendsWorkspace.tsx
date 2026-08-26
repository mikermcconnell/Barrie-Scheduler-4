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
import { useRidershipTrendQuery } from '../../hooks/useRidershipTrend';
import { RIDERSHIP_TREND_BASELINE } from '../../utils/ridership-trends/baseline';
import { buildRidershipTrendView, createRidershipTrendProjection } from '../../utils/ridership-trends/model';
import type { RidershipTrendCoverageStatus, RidershipTrendSource } from '../../utils/ridership-trends/types';

interface RidershipTrendsWorkspaceProps {
    teamId: string;
    requestingTeamId?: string;
    onBack: () => void;
    accessContext?: 'ridershipTrend' | 'strategicPlan';
    backLabel?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
    tone: 'blue' | 'violet' | 'amber';
}> = ({ label, value, detail, tone }) => {
    const tones = {
        blue: 'border-blue-200 bg-blue-50 text-blue-950',
        violet: 'border-violet-200 bg-violet-50 text-violet-950',
        amber: 'border-amber-200 bg-amber-50 text-amber-950',
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
    const referenceDate = getTorontoDate();
    const projection = trendQuery.data ?? createRidershipTrendProjection({
        baselineHash: RIDERSHIP_TREND_BASELINE.source.sha256,
        updatedAt: new Date().toISOString(),
    });
    const view = useMemo(
        () => buildRidershipTrendView(RIDERSHIP_TREND_BASELINE, projection, referenceDate),
        [projection, referenceDate],
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
    const WorkspaceRoot = accessContext === 'strategicPlan' ? 'div' : 'main';

    if (trendQuery.isLoading) {
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
                                    See how fixed-route boardings are changing over time as daily STREETS reports extend the historical workbook.
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
                            onClick={() => trendQuery.refetch()}
                            disabled={trendQuery.isFetching}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${trendQuery.isFetching ? 'animate-spin' : ''}`} />
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

                <section className="rounded-3xl border-2 border-gray-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="annual-ridership-title">
                    <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h2 id="annual-ridership-title" className="text-xl font-black text-gray-950">Annual ridership</h2>
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

                <section className="grid gap-3 md:grid-cols-3" aria-label="Current ridership summary">
                    <MetricBlock
                        tone="blue"
                        label={`${view.activeYear} YTD boardings`}
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
                        label="Reports received"
                        value={`${numberFormatter.format(view.liveCoverage.observedDays)} / ${numberFormatter.format(view.liveCoverage.expectedDays)}`}
                        detail={view.liveCoverage.expectedDays === 0
                            ? 'Waiting for the first live report'
                            : view.liveCoverage.complete
                                ? 'All expected live dates received'
                                : `${numberFormatter.format(view.liveCoverage.missingDates.length)} expected date(s) need review`}
                    />
                </section>

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
                                    <div><dt className="inline font-bold text-gray-800">Unit: </dt><dd className="inline">fixed-route boarding activity.</dd></div>
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
