import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { AlertTriangle, Clock, Users, Timer } from 'lucide-react';
import type { PerformanceDataSummary, DwellIncident, OperatorDwellSummary } from '../../utils/performanceDataTypes';
import { MetricCard, ChartCard, fmt } from '../Analytics/AnalyticsShared';
import { aggregateDwellAcrossDays } from '../../utils/schedule/operatorDwellUtils';
import { exportOperatorDwell, exportOperatorDwellPDF } from './reports/reportExporter';
import { DwellCascadeSection } from './DwellCascadeSection';
import {
    addDaysToISODate,
    compareDateStrings,
    getISOWeekStartMonday,
    normalizeToISODate,
} from '../../utils/performanceDateUtils';

interface OperatorDwellModuleProps {
    data: PerformanceDataSummary;
}

const INCIDENTS_PER_PAGE = 100;

const SeverityBadge: React.FC<{ severity: 'moderate' | 'high' }> = ({ severity }) => (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
        severity === 'high'
            ? 'bg-red-100 text-red-700'
            : 'bg-amber-100 text-amber-700'
    }`}>
        {severity === 'high' ? 'High' : 'Moderate'}
    </span>
);

export const OperatorDwellModule: React.FC<OperatorDwellModuleProps> = ({ data }) => {
    const [subView, setSubView] = useState<'incidents' | 'cascade'>('incidents');
    const [selectedOperator, setSelectedOperator] = useState<string | null>(null);
    const [incidentPage, setIncidentPage] = useState(1);
    const [exportingExcel, setExportingExcel] = useState(false);
    const [exportingPDF, setExportingPDF] = useState(false);

    const activeDates = useMemo(
        () => [...new Set(
            data.dailySummaries
                .map(d => normalizeToISODate(d.date) ?? d.date)
                .filter((date): date is string => Boolean(date))
        )].sort(compareDateStrings),
        [data.dailySummaries]
    );
    const startDate = activeDates[0] ?? data.metadata.dateRange.start;
    const endDate = activeDates[activeDates.length - 1] ?? data.metadata.dateRange.end;
    const canExport = data.dailySummaries.length > 0;

    const handleExportExcel = useCallback(async () => {
        if (!canExport) return;
        setExportingExcel(true);
        try { await exportOperatorDwell(data.dailySummaries, startDate, endDate); }
        finally { setExportingExcel(false); }
    }, [canExport, data.dailySummaries, startDate, endDate]);

    const handleExportPDF = useCallback(async () => {
        if (!canExport) return;
        setExportingPDF(true);
        try { await exportOperatorDwellPDF(data.dailySummaries, startDate, endDate); }
        finally { setExportingPDF(false); }
    }, [canExport, data.dailySummaries, startDate, endDate]);

    const metrics = useMemo(
        () => aggregateDwellAcrossDays(data.dailySummaries),
        [data.dailySummaries]
    );

    const filteredIncidents = useMemo((): DwellIncident[] => {
        if (!selectedOperator) return metrics.incidents;
        return metrics.incidents.filter(i => i.operatorId === selectedOperator);
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

    const missingDwellDates = useMemo(
        () => data.dailySummaries.filter(d => !d.byOperatorDwell).map(d => d.date),
        [data.dailySummaries]
    );
    const numDays = data.dailySummaries.filter(d => d.byOperatorDwell).length || 1;
    const totalTrips = data.dailySummaries.reduce((s, d) => s + (d.system?.tripCount ?? 0), 0);
    const highCount = metrics.byOperator.reduce((s, o) => s + o.highCount, 0);
    const incPerDay = metrics.totalIncidents / numDays;
    const avgDwellPerIncident = metrics.totalIncidents > 0
        ? metrics.totalTrackedDwellMinutes / metrics.totalIncidents : 0;
    const highPct = metrics.totalIncidents > 0
        ? Math.round((highCount / metrics.totalIncidents) * 100) : 0;
    const avgPerOperator = metrics.byOperator.length > 0
        ? (metrics.totalIncidents / metrics.byOperator.length).toFixed(1) : '0';

    // Daily dwell hours trend
    const dailyDwellTrend = useMemo(() => {
        return data.dailySummaries
            .map(d => {
                const totalSec = d.byOperatorDwell?.incidents.reduce((s, i) => s + i.trackedDwellSeconds, 0) ?? 0;
                return { date: d.date, hours: +(totalSec / 3600).toFixed(2) };
            })
            .sort((a, b) => a.date.localeCompare(b.date));
    }, [data.dailySummaries]);

    // Weekly trend data
    const weeklyTrend = useMemo(() => {
        const weeks = new Map<string, { incidents: number; high: number; trips: number; days: number }>();
        for (const day of data.dailySummaries) {
            const iso = normalizeToISODate(day.date) ?? day.date;
            const weekKey = getISOWeekStartMonday(iso) ?? iso;
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
    }, [data.dailySummaries]);

    return (
        <div className="space-y-5">
            {/* Sub-view toggle */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
                <button
                    onClick={() => setSubView('incidents')}
                    className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        subView === 'incidents'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Incidents
                </button>
                <button
                    onClick={() => setSubView('cascade')}
                    className={`px-3.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        subView === 'cascade'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Cascade Analysis
                </button>
            </div>

            {subView === 'cascade' ? (
                <DwellCascadeSection data={data} />
            ) : (<>
            {/* Missing dwell data warning */}
            {missingDwellDates.length > 0 && (
                <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
                    <span>
                        <strong>{missingDwellDates.length} day{missingDwellDates.length !== 1 ? 's' : ''} missing dwell data</strong>
                        {' '}— re-import to fix:{' '}
                        <span className="font-mono">{missingDwellDates.join(', ')}</span>
                    </span>
                </div>
            )}
            {/* Normalized Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    icon={<AlertTriangle size={18} />}
                    label="Incidents / Day"
                    value={incPerDay.toFixed(1)}
                    color="amber"
                    subValue={`${fmt(metrics.totalIncidents)} total · ${numDays} days`}
                />
                <MetricCard
                    icon={<Clock size={18} />}
                    label="Total Dwell Hours"
                    value={`${(metrics.totalTrackedDwellMinutes / 60).toFixed(1)} hr`}
                    color="cyan"
                    subValue={`${fmt(metrics.totalTrackedDwellMinutes)} min · ${avgDwellPerIncident.toFixed(1)} avg/inc`}
                />
                <MetricCard
                    icon={<Timer size={18} />}
                    label="High Severity"
                    value={`${highPct}%`}
                    color="red"
                    subValue={`${fmt(highCount)} of ${fmt(metrics.totalIncidents)}`}
                />
                <MetricCard
                    icon={<Users size={18} />}
                    label="Operators w/ Incidents"
                    value={fmt(metrics.byOperator.length)}
                    color="indigo"
                    subValue={`${avgPerOperator} avg each`}
                />
            </div>

            {/* Operator Summary + Incident Detail Side-by-Side */}
            <div className="grid grid-cols-1 lg:grid-cols-[35%_1fr] gap-4 items-start">
                {/* Operator Summary Table */}
                <ChartCard
                    title="Operators"
                    subtitle="Click to filter"
                    headerExtra={
                        <div className="flex items-center gap-2">
                            {selectedOperator && (
                                <button
                                    onClick={() => setSelectedOperator(null)}
                                    className="text-xs text-cyan-600 hover:text-cyan-700 font-medium"
                                >
                                    Clear
                                </button>
                            )}
                            <button
                                onClick={handleExportExcel}
                                disabled={exportingExcel || !canExport}
                                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {exportingExcel ? '...' : 'Excel'}
                            </button>
                            <button
                                onClick={handleExportPDF}
                                disabled={exportingPDF || !canExport}
                                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {exportingPDF ? '...' : 'PDF'}
                            </button>
                        </div>
                    }
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
                                        <th className="pb-2 pr-3 font-medium text-right">Total (hr)</th>
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
                                                <td className="py-2 pr-3 text-right font-medium text-cyan-700">{(op.totalTrackedDwellSeconds / 3600).toFixed(2)}</td>
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
                                            <td className="py-2"><SeverityBadge severity={inc.severity} /></td>
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

            {/* Daily Dwell Hours Chart */}
            {dailyDwellTrend.length > 1 && (
                <ChartCard title="Total Dwell Hours / Day" subtitle="How is cumulative operator dwell trending day to day?">
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={dailyDwellTrend}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 11 }} unit="h" />
                            <Tooltip
                                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                                formatter={(v: number) => [`${v} hr`, 'Total Dwell']}
                            />
                            <Line type="monotone" dataKey="hours" name="Dwell Hours" stroke="#0891b2" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </ChartCard>
            )}

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
            </>)}
        </div>
    );
};
