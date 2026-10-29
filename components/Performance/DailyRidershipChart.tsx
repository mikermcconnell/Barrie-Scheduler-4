import React, { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea,
} from 'recharts';
import type { DailySummary, DayType } from '../../utils/performanceDataTypes';
import { longWeekdayDateLabel, shortWeekdayDateLabel } from '../../utils/performanceDateUtils';
import {
    RIDERSHIP_BENCHMARK_WEEKS,
    buildDailyRidershipRows,
    buildRidershipBenchmarks,
    summarizeByDayType,
    type DailyRidershipRow,
} from '../../utils/performanceRidershipBenchmark';

interface DailyRidershipChartProps {
    days: DailySummary[];
    /** All loaded days for the current route scope; supplies the benchmark history. */
    historyDays: DailySummary[];
    /** Prior period of equal length, when loaded. */
    comparisonDays?: DailySummary[];
}

type ChartRow = DailyRidershipRow & { label: string };

const BAR_COLOR = '#0891b2';
const BENCHMARK_COLOR = '#111827';
const ABOVE_COLOR = '#2a78d6';
const BELOW_COLOR = '#eb6834';
const MAX_LABELLED_DAYS = 14;
const MAX_SHADED_DAYS = 45;

const DAY_TYPE_LABEL: Record<DayType, string> = { weekday: 'Weekday', saturday: 'Saturday', sunday: 'Sunday' };

const formatCount = (value: number) => Math.round(value).toLocaleString();
const formatPct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
const formatAxis = (value: number) => (value >= 1000 ? `${(value / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k` : String(value));

function niceCeiling(value: number): number {
    if (value <= 0) return 10;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    const step = steps.find(s => s * magnitude >= value) ?? 10;
    return step * magnitude;
}

const ChangeLine: React.FC<{ pct: number | null; suffix: string }> = ({ pct, suffix }) => {
    if (pct === null) return <div className="text-xs text-gray-400">No {suffix} data</div>;
    const up = pct >= 0;
    return (
        <div className="text-xs text-gray-600">
            <span aria-hidden="true" style={{ color: up ? ABOVE_COLOR : BELOW_COLOR }}>{up ? '▲' : '▼'} </span>
            {Math.abs(pct).toFixed(1)}% {up ? 'above' : 'below'} {suffix}
        </div>
    );
};

const KpiTile: React.FC<{ label: string; value: string; children: React.ReactNode }> = ({ label, value, children }) => (
    <div className="rounded-lg border border-gray-200 px-3.5 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
        <div className="text-xl font-bold text-gray-900 tabular-nums">{value}</div>
        {children}
    </div>
);

interface BarShapeProps {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    payload?: ChartRow;
    showLabel: boolean;
}

/** Bar with its day-type benchmark drawn across it and the % difference above. */
const BenchmarkBar: React.FC<BarShapeProps> = ({ x = 0, y = 0, width = 0, height = 0, payload, showLabel }) => {
    if (!payload || height <= 0 || payload.ridership <= 0) return null;
    const radius = Math.min(4, width / 2, height);
    const baseline = y + height;
    const bar = (
        <path
            d={`M${x},${baseline} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + width - radius} Q${x + width},${y} ${x + width},${y + radius} V${baseline} Z`}
            fill={BAR_COLOR}
        />
    );
    if (payload.typical === null) return <g>{bar}</g>;
    const benchmarkY = baseline - (payload.typical / payload.ridership) * height;
    const overhang = Math.min(6, width * 0.15);
    return (
        <g>
            {bar}
            <line
                x1={x - overhang}
                x2={x + width + overhang}
                y1={benchmarkY}
                y2={benchmarkY}
                stroke={BENCHMARK_COLOR}
                strokeWidth={2}
                strokeDasharray="5 4"
            />
            {showLabel && payload.vsTypicalPct !== null && (
                <text
                    x={x + width / 2}
                    y={Math.min(y, benchmarkY) - 7}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill="#4B5563"
                >
                    {formatPct(payload.vsTypicalPct)}
                </text>
            )}
        </g>
    );
};

const DailyRidershipTooltip: React.FC<{ active?: boolean; payload?: Array<{ payload?: ChartRow }> }> = ({ active, payload }) => {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;
    const dayType = DAY_TYPE_LABEL[row.dayType];
    const item = (label: string, value: React.ReactNode) => (
        <div className="flex justify-between gap-6 py-0.5 tabular-nums">
            <span className="text-gray-500">{label}</span>
            <span className="text-gray-900">{value}</span>
        </div>
    );
    return (
        <div className="min-w-[240px] rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-xs shadow-lg">
            <div className="mb-1.5 text-[13px] font-semibold text-gray-900">
                {longWeekdayDateLabel(row.fullDate)} <span className="font-normal text-gray-400">· {dayType}</span>
            </div>
            {item('Boardings', <b>{formatCount(row.ridership)}</b>)}
            {row.typical !== null && row.vsTypicalPct !== null
                ? item(`vs typical ${dayType} (${formatCount(row.typical)})`, formatPct(row.vsTypicalPct))
                : item(`vs typical ${dayType}`, 'No history')}
            {item('vs same day last week', row.vsPriorWeekPct !== null ? formatPct(row.vsPriorWeekPct) : 'Not loaded')}
            {row.boardingsPerServiceHour !== null && item('Boardings / service hr', row.boardingsPerServiceHour.toFixed(1))}
            {row.topRoute && item('Top route', `${row.topRoute.routeId} · ${formatCount(row.topRoute.ridership)}`)}
        </div>
    );
};

export const DailyRidershipChart: React.FC<DailyRidershipChartProps> = ({ days, historyDays, comparisonDays = [] }) => {
    const benchmarks = useMemo(() => buildRidershipBenchmarks(days, historyDays), [days, historyDays]);
    const rows = useMemo<ChartRow[]>(
        () => buildDailyRidershipRows(days, historyDays, benchmarks)
            .map(row => ({ ...row, label: shortWeekdayDateLabel(row.fullDate) })),
        [benchmarks, days, historyDays],
    );
    const dayTypeSummaries = useMemo(() => summarizeByDayType(rows, benchmarks), [benchmarks, rows]);

    const periodTotal = rows.reduce((sum, row) => sum + row.ridership, 0);
    const comparisonTotal = comparisonDays.reduce((sum, day) => sum + day.system.totalRidership, 0);
    const sameLengthComparison = comparisonDays.length === rows.length;
    const periodChangePct = comparisonDays.length > 0 && comparisonTotal > 0
        ? sameLengthComparison
            ? (periodTotal - comparisonTotal) / comparisonTotal * 100
            : ((periodTotal / rows.length) - (comparisonTotal / comparisonDays.length)) / (comparisonTotal / comparisonDays.length) * 100
        : null;

    const yMax = niceCeiling(Math.max(0, ...rows.map(row => Math.max(row.ridership, row.typical ?? 0))) * 1.1);
    const showLabels = rows.length <= MAX_LABELLED_DAYS;
    const weekendLabels = rows.length <= MAX_SHADED_DAYS
        ? rows.filter(row => row.dayType !== 'weekday').map(row => row.label)
        : [];
    const hasBenchmark = rows.some(row => row.typical !== null);

    if (rows.length === 0) {
        return <p className="py-10 text-center text-sm text-gray-400">No ridership data for the selected period.</p>;
    }

    return (
        <div>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <KpiTile label="Period total" value={formatCount(periodTotal)}>
                    <ChangeLine
                        pct={periodChangePct}
                        suffix={sameLengthComparison ? 'prior period' : 'prior period (per day)'}
                    />
                </KpiTile>
                {dayTypeSummaries.map(summary => (
                    <KpiTile
                        key={summary.dayType}
                        label={summary.days > 1 ? `Avg ${DAY_TYPE_LABEL[summary.dayType].toLowerCase()}` : DAY_TYPE_LABEL[summary.dayType]}
                        value={formatCount(summary.avgRidership)}
                    >
                        <ChangeLine
                            pct={summary.vsTypicalPct}
                            suffix={summary.typical !== null ? `typical (${formatCount(summary.typical)})` : 'typical'}
                        />
                    </KpiTile>
                ))}
            </div>

            <ResponsiveContainer width="100%" height={270}>
                <BarChart data={rows} margin={{ top: 20, right: 10, bottom: 5, left: -4 }}>
                    {weekendLabels.map(label => (
                        <ReferenceArea key={label} x1={label} x2={label} fill="#F3F4F6" fillOpacity={1} ifOverflow="visible" />
                    ))}
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF0F3" />
                    <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: '#4B5563' }}
                        tickLine={false}
                        axisLine={{ stroke: '#9CA3AF' }}
                        interval="preserveStartEnd"
                    />
                    <YAxis
                        domain={[0, yMax]}
                        tickFormatter={formatAxis}
                        tick={{ fontSize: 11, fill: '#6B7280' }}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                    />
                    <Tooltip content={<DailyRidershipTooltip />} cursor={{ fill: '#0891b2', fillOpacity: 0.06 }} />
                    <Bar
                        dataKey="ridership"
                        maxBarSize={88}
                        isAnimationActive={false}
                        shape={(props: unknown) => <BenchmarkBar {...(props as BarShapeProps)} showLabel={showLabels} />}
                    />
                </BarChart>
            </ResponsiveContainer>

            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-600">
                <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm" style={{ background: BAR_COLOR }} />Boardings
                </span>
                {hasBenchmark && (
                    <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block w-[18px] border-t-2 border-dashed" style={{ borderColor: BENCHMARK_COLOR }} />
                        Typical for day type ({RIDERSHIP_BENCHMARK_WEEKS}-week average before this period)
                    </span>
                )}
                {weekendLabels.length > 0 && (
                    <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-3 w-3 rounded-sm border border-gray-200 bg-gray-100" />Weekend
                    </span>
                )}
            </div>

            <details className="mt-3 text-xs">
                <summary className="cursor-pointer select-none text-gray-500 hover:text-gray-700">Show as table</summary>
                <div className="mt-2 overflow-x-auto">
                    <table className="w-full tabular-nums">
                        <thead>
                            <tr className="border-b border-gray-100 text-[11px] uppercase text-gray-500">
                                <th className="px-2 py-1.5 text-left font-semibold">Day</th>
                                <th className="px-2 py-1.5 text-left font-semibold">Type</th>
                                <th className="px-2 py-1.5 text-right font-semibold">Boardings</th>
                                <th className="px-2 py-1.5 text-right font-semibold">Typical</th>
                                <th className="px-2 py-1.5 text-right font-semibold">vs typical</th>
                                <th className="px-2 py-1.5 text-right font-semibold">vs last week</th>
                                <th className="px-2 py-1.5 text-right font-semibold">Bd / svc hr</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(row => (
                                <tr key={row.fullDate} className="border-b border-gray-50 text-gray-700">
                                    <td className="px-2 py-1">{row.label}</td>
                                    <td className="px-2 py-1">{DAY_TYPE_LABEL[row.dayType]}</td>
                                    <td className="px-2 py-1 text-right">{formatCount(row.ridership)}</td>
                                    <td className="px-2 py-1 text-right">{row.typical !== null ? formatCount(row.typical) : '—'}</td>
                                    <td className="px-2 py-1 text-right">{row.vsTypicalPct !== null ? formatPct(row.vsTypicalPct) : '—'}</td>
                                    <td className="px-2 py-1 text-right">{row.vsPriorWeekPct !== null ? formatPct(row.vsPriorWeekPct) : '—'}</td>
                                    <td className="px-2 py-1 text-right">{row.boardingsPerServiceHour !== null ? row.boardingsPerServiceHour.toFixed(1) : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </details>
        </div>
    );
};
