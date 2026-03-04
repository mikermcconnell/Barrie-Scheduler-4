import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { AlertTriangle, Clock, Timer, Users } from 'lucide-react';
import { MetricCard, ChartCard, fmt } from '../../Analytics/AnalyticsShared';
import type { DailySummary, DayType, DwellIncident, OperatorDwellSummary } from '../../../utils/performanceDataTypes';
import { aggregateDwellAcrossDays } from '../../../utils/schedule/operatorDwellUtils';
import { addDaysToISODate, getISOWeekStartMonday, toDateSortKey } from '../../../utils/performanceDateUtils';
import { exportOperatorDwell, exportOperatorDwellPDF } from './reportExporter';

interface OperatorDwellReportProps {
    filteredDays: DailySummary[];
    allDays: DailySummary[];
    startDate: string;
    endDate: string;
    dayTypeFilter: DayType | 'all';
}

// ─── Helpers ──────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const INCIDENTS_PER_PAGE = 100;

function getPriorPeriodDays(
    allDays: DailySummary[],
    startDate: string,
    endDate: string,
    dayTypeFilter: DayType | 'all',
): DailySummary[] {
    const startKey = toDateSortKey(startDate);
    const endKey = toDateSortKey(endDate);
    if (!Number.isFinite(startKey) || !Number.isFinite(endKey) || endKey < startKey) return [];

    const rangeDays = Math.max(1, Math.floor((endKey - startKey) / MS_PER_DAY) + 1);
    const priorEndKey = startKey - MS_PER_DAY;
    const priorStartKey = priorEndKey - ((rangeDays - 1) * MS_PER_DAY);

    return allDays.filter(d => {
        const dayKey = toDateSortKey(d.date);
        if (!Number.isFinite(dayKey)) return false;
        if (dayKey < priorStartKey || dayKey > priorEndKey) return false;
        if (dayTypeFilter !== 'all' && d.dayType !== dayTypeFilter) return false;
        return true;
    });
}

const SeverityBadge: React.FC<{ severity: 'moderate' | 'high' }> = ({ severity }) => (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
        severity === 'high'
            ? 'bg-red-100 text-red-700'
            : 'bg-amber-100 text-amber-700'
    }`}>
        {severity === 'high' ? 'High' : 'Moderate'}
    </span>
);

function formatDelta(current: number, prior: number): string {
    const diff = current - prior;
    if (diff === 0) return '';
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff} vs prior`;
}

// ─── Component ────────────────────────────────────────────────────────

export const OperatorDwellReport: React.FC<OperatorDwellReportProps> = ({
    filteredDays, allDays, startDate, endDate, dayTypeFilter,
}) => {
    const [selectedOperator, setSelectedOperator] = useState<string | null>(null);
    const [incidentPage, setIncidentPage] = useState(1);
    const [exportingExcel, setExportingExcel] = useState(false);
    const [exportingPDF, setExportingPDF] = useState(false);
    const canExport = filteredDays.length > 0;

    const handleExportExcel = useCallback(async () => {
        if (!canExport) return;
        setExportingExcel(true);
        try { await exportOperatorDwell(filteredDays, startDate, endDate); }
        finally { setExportingExcel(false); }
    }, [canExport, filteredDays, startDate, endDate]);

    const handleExportPDF = useCallback(async () => {
        if (!canExport) return;
        setExportingPDF(true);
        try { await exportOperatorDwellPDF(filteredDays, startDate, endDate); }
        finally { setExportingPDF(false); }
    }, [canExport, filteredDays, startDate, endDate]);

    const metrics = useMemo(
        () => aggregateDwellAcrossDays(filteredDays),
        [filteredDays]
    );

    const priorDays = useMemo(
        () => getPriorPeriodDays(allDays, startDate, endDate, dayTypeFilter),
        [allDays, dayTypeFilter, startDate, endDate]
    );
    const priorMetrics = useMemo(
        () => aggregateDwellAcrossDays(priorDays),
        [priorDays]
    );

    const filteredIncidents = useMemo((): DwellIncident[] => {
        const classified = metrics.incidents.filter(i => i.severity !== 'minor');
        if (!selectedOperator) return classified;
        return classified.filter(i => i.operatorId === selectedOperator);
    }, [metrics, selectedOperator]);

    useEffect(() => {
        setIncidentPage(1);
    }, [selectedOperator, filteredIncidents.length]);

    const totalIncidentPages = Math.max(1, Math.ceil(filteredIncidents.length / INCIDENTS_PER_PAGE));
    const currentIncidentPage = Math.min(incidentPage, totalIncidentPages);
    const pagedIncidents = useMemo(() => {
        const start = (currentIncidentPage - 1) * INCIDENTS_PER_PAGE;
        return filteredIncidents.slice(start, start + INCIDENTS_PER_PAGE);
    }, [currentIncidentPage, filteredIncidents]);

    // Normalized metric helpers
    const numDays = filteredDays.length || 1;
    const totalTrips = filteredDays.reduce((s, d) => s + (d.system?.tripCount ?? 0), 0);
    const highCount = metrics.byOperator.reduce((s, o) => s + o.highCount, 0);
    const priorHighCount = priorMetrics.byOperator.reduce((s, o) => s + o.highCount, 0);
    const incPerDay = metrics.totalIncidents / numDays;
    const priorNumDays = priorDays.length || 1;
    const priorIncPerDay = priorMetrics.totalIncidents / priorNumDays;
    const avgDwellPerIncident = metrics.totalIncidents > 0
        ? metrics.totalTrackedDwellMinutes / metrics.totalIncidents : 0;
    const priorAvgDwell = priorMetrics.totalIncidents > 0
        ? priorMetrics.totalTrackedDwellMinutes / priorMetrics.totalIncidents : 0;
    const highPct = metrics.totalIncidents > 0
        ? Math.round((highCount / metrics.totalIncidents) * 100) : 0;
    const priorHighPct = priorMetrics.totalIncidents > 0
        ? Math.round((priorHighCount / priorMetrics.totalIncidents) * 100) : 0;
    const avgPerOperator = metrics.byOperator.length > 0
        ? (metrics.totalIncidents / metrics.byOperator.length).toFixed(1) : '0';

    // Weekly trend data
    const weeklyTrend = useMemo(() => {
        const weeks = new Map<string, { incidents: number; high: number; trips: number; days: number }>();
        for (const day of filteredDays) {
            const weekKey = getISOWeekStartMonday(day.date) ?? day.date;
            const prev = weeks.get(weekKey) ?? { incidents: 0, high: 0, trips: 0, days: 0 };
            const dwell = day.byOperatorDwell;
            prev.incidents += dwell?.totalIncidents ?? 0;
            prev.high += dwell?.byOperator.reduce((s, o) => s + o.highCount, 0) ?? 0;
            prev.trips += day.system?.tripCount ?? 0;
            prev.days += 1;
            weeks.set(weekKey, prev);
        }
        return [...weeks.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([weekStart, w]) => {
                const weekEnd = addDaysToISODate(weekStart, 6) ?? weekStart;
                const label = `${weekStart.slice(5)} – ${weekEnd.slice(5)}`;
                return {
                    weekStart,
                    label,
                    incPerDay: +(w.incidents / w.days).toFixed(1),
                    highPerDay: +(w.high / w.days).toFixed(1),
                    per1kTrips: w.trips > 0 ? +((w.incidents / w.trips) * 1000).toFixed(1) : 0,
                };
            });
    }, [filteredDays]);

    return (
        <div className="space-y-5">
            {/* Export + Title Row */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-bold text-gray-900">Operator Dwell Report</h3>
                    <p className="text-xs text-gray-400">{startDate} — {endDate}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleExportExcel}
                        disabled={exportingExcel || !canExport}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {exportingExcel ? 'Exporting...' : 'Export Excel'}
                    </button>
                    <button
                        onClick={handleExportPDF}
                        disabled={exportingPDF || !canExport}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {exportingPDF ? 'Exporting...' : 'Export PDF'}
                    </button>
                </div>
            </div>

            {/* Normalized Metric Cards with prior period comparison */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    icon={<AlertTriangle size={18} />}
                    label="Incidents / Day"
                    value={incPerDay.toFixed(1)}
                    color="amber"
                    subValue={priorMetrics.totalIncidents > 0
                        ? `${formatDelta(+incPerDay.toFixed(1), +priorIncPerDay.toFixed(1))} / day`
                        : `${fmt(metrics.totalIncidents)} total · ${numDays} days`}
                />
                <MetricCard
                    icon={<Clock size={18} />}
                    label="Avg Dwell / Incident"
                    value={`${avgDwellPerIncident.toFixed(1)} min`}
                    color="cyan"
                    subValue={priorAvgDwell > 0
                        ? `${formatDelta(+avgDwellPerIncident.toFixed(1), +priorAvgDwell.toFixed(1))} min`
                        : `${fmt(metrics.totalTrackedDwellMinutes)} min total`}
                />
                <MetricCard
                    icon={<Timer size={18} />}
                    label="High Severity"
                    value={`${highPct}%`}
                    color="red"
                    subValue={priorHighPct > 0
                        ? `${fmt(highCount)} of ${fmt(metrics.totalIncidents)} · ${formatDelta(highPct, priorHighPct)}%`
                        : `${fmt(highCount)} of ${fmt(metrics.totalIncidents)}`}
                />
                <MetricCard
                    icon={<Users size={18} />}
                    label="Operators w/ Incidents"
                    value={fmt(metrics.byOperator.length)}
                    color="indigo"
                    subValue={`${avgPerOperator} avg each${priorMetrics.byOperator.length > 0 ? ` · ${formatDelta(metrics.byOperator.length, priorMetrics.byOperator.length)}` : ''}`}
                />
            </div>

            {/* Operator Summary + Incident Detail Side-by-Side */}
            <div className="grid grid-cols-1 lg:grid-cols-[35%_1fr] gap-4 items-start">
                {/* Operator Summary Table */}
                <ChartCard
                    title="Operators"
                    subtitle="Click to filter"
                    headerExtra={selectedOperator ? (
                        <button
                            onClick={() => setSelectedOperator(null)}
                            className="text-xs text-cyan-600 hover:text-cyan-700 font-medium"
                        >
                            Clear
                        </button>
                    ) : undefined}
                >
                    {metrics.byOperator.length === 0 ? (
                        <p className="text-sm text-gray-400 py-8 text-center">No dwell incidents in selected period</p>
                    ) : (
                        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-white">
                                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                                        <th className="pb-2 pr-3 font-medium">Operator</th>
                                        <th className="pb-2 pr-3 font-medium text-right">Mod</th>
                                        <th className="pb-2 pr-3 font-medium text-right">High</th>
                                        <th className="pb-2 pr-3 font-medium text-right">Total</th>
                                        <th className="pb-2 font-medium text-right">Avg (min)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {metrics.byOperator.map((op: OperatorDwellSummary) => {
                                        const isSelected = selectedOperator === op.operatorId;
                                        return (
                                            <tr
                                                key={op.operatorId}
                                                onClick={() => setSelectedOperator(isSelected ? null : op.operatorId)}
                                                className={`border-b border-gray-100 cursor-pointer transition-colors ${
                                                    isSelected ? 'bg-cyan-50' : 'hover:bg-gray-50'
                                                }`}
                                            >
                                                <td className="py-2 pr-3 font-medium text-gray-900">{op.operatorId}</td>
                                                <td className="py-2 pr-3 text-right text-amber-600">{op.moderateCount}</td>
                                                <td className="py-2 pr-3 text-right text-red-600">{op.highCount}</td>
                                                <td className="py-2 pr-3 text-right font-medium">{op.totalIncidents}</td>
                                                <td className="py-2 text-right">{(op.avgTrackedDwellSeconds / 60).toFixed(1)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </ChartCard>

                {/* Incident Detail Table */}
                <ChartCard
                    title="Incident Detail"
                    subtitle={selectedOperator ? `Filtered to operator ${selectedOperator}` : 'All incidents'}
                >
                    {filteredIncidents.length === 0 ? (
                        <p className="text-sm text-gray-400 py-8 text-center">No incidents to display</p>
                    ) : (
                        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-white">
                                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                                        <th className="pb-2 pr-3 font-medium">Date</th>
                                        <th className="pb-2 pr-3 font-medium">Route</th>
                                        <th className="pb-2 pr-3 font-medium">Stop</th>
                                        <th className="pb-2 pr-3 font-medium">Arrival</th>
                                        <th className="pb-2 pr-3 font-medium">Departure</th>
                                        <th className="pb-2 pr-3 font-medium text-right">Tracked (min)</th>
                                        <th className="pb-2 font-medium">Severity</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pagedIncidents.map((inc, idx) => (
                                        <tr key={`${inc.operatorId}-${inc.date}-${inc.stopId}-${idx}`} className="border-b border-gray-100">
                                            <td className="py-2 pr-3 text-gray-600">{inc.date}</td>
                                            <td className="py-2 pr-3 text-gray-600">{inc.routeId}</td>
                                            <td className="py-2 pr-3 text-gray-600 max-w-[180px] truncate" title={inc.stopName}>{inc.stopName}</td>
                                            <td className="py-2 pr-3 text-gray-600 tabular-nums">{inc.observedArrivalTime}</td>
                                            <td className="py-2 pr-3 text-gray-600 tabular-nums">{inc.observedDepartureTime}</td>
                                            <td className="py-2 pr-3 text-right tabular-nums">{(inc.trackedDwellSeconds / 60).toFixed(1)}</td>
                                            <td className="py-2"><SeverityBadge severity={inc.severity as 'moderate' | 'high'} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {filteredIncidents.length > INCIDENTS_PER_PAGE && (
                        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                            <span>
                                Showing {(currentIncidentPage - 1) * INCIDENTS_PER_PAGE + 1}
                                {'-'}
                                {Math.min(currentIncidentPage * INCIDENTS_PER_PAGE, filteredIncidents.length)}
                                {' '}of {filteredIncidents.length}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setIncidentPage(page => Math.max(1, page - 1))}
                                    disabled={currentIncidentPage === 1}
                                    className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"
                                >
                                    Prev
                                </button>
                                <span>
                                    Page {currentIncidentPage} / {totalIncidentPages}
                                </span>
                                <button
                                    onClick={() => setIncidentPage(page => Math.min(totalIncidentPages, page + 1))}
                                    disabled={currentIncidentPage === totalIncidentPages}
                                    className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </ChartCard>
            </div>

            {/* Weekly Trend Chart */}
            {weeklyTrend.length > 1 && (
                <ChartCard title="Weekly Trend" subtitle="Incidents per day by week — are things improving?">
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={weeklyTrend}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                            <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 11 }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                            <Tooltip
                                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                                labelFormatter={(_, payload) => {
                                    const w = payload?.[0]?.payload?.weekStart;
                                    return w ? `Week of ${w}` : '';
                                }}
                            />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            <Line yAxisId="left" type="monotone" dataKey="incPerDay" name="Incidents / Day" stroke="#0891b2" strokeWidth={2} dot={{ r: 3 }} />
                            <Line yAxisId="left" type="monotone" dataKey="highPerDay" name="High / Day" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                            {totalTrips > 0 && (
                                <Line yAxisId="right" type="monotone" dataKey="per1kTrips" name="Per 1K Trips" stroke="#7c3aed" strokeWidth={1.5} dot={false} />
                            )}
                        </LineChart>
                    </ResponsiveContainer>
                </ChartCard>
            )}
        </div>
    );
};
