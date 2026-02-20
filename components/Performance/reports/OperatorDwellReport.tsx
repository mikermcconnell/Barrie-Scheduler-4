import React, { useMemo, useState } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { AlertTriangle, Clock, Timer, Users } from 'lucide-react';
import { MetricCard, ChartCard, fmt } from '../../Analytics/AnalyticsShared';
import type { DailySummary, DwellIncident, OperatorDwellSummary } from '../../../utils/performanceDataTypes';
import { aggregateDwellAcrossDays } from '../../../utils/schedule/operatorDwellUtils';
import { shortDateLabel, toDateSortKey } from '../../../utils/performanceDateUtils';

interface OperatorDwellReportProps {
    filteredDays: DailySummary[];
    allDays: DailySummary[];
    startDate: string;
    endDate: string;
    onExportExcel?: () => void;
    onExportPDF?: () => void;
    exportingExcel?: boolean;
    exportingPDF?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getPriorPeriodDays(allDays: DailySummary[], startDate: string, endDate: string): DailySummary[] {
    const start = new Date(startDate + 'T12:00:00');
    const end = new Date(endDate + 'T12:00:00');
    const durationMs = end.getTime() - start.getTime();
    const priorEnd = new Date(start.getTime() - 86400000);
    const priorStart = new Date(priorEnd.getTime() - durationMs);
    const priorStartStr = priorStart.toISOString().slice(0, 10);
    const priorEndStr = priorEnd.toISOString().slice(0, 10);
    const priorStartKey = toDateSortKey(priorStartStr);
    const priorEndKey = toDateSortKey(priorEndStr);
    return allDays.filter(d => {
        const dayKey = toDateSortKey(d.date);
        if (!Number.isFinite(dayKey)) return false;
        return dayKey >= priorStartKey && dayKey <= priorEndKey;
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
    filteredDays, allDays, startDate, endDate,
    onExportExcel, onExportPDF, exportingExcel, exportingPDF,
}) => {
    const [selectedOperator, setSelectedOperator] = useState<string | null>(null);

    const metrics = useMemo(
        () => aggregateDwellAcrossDays(filteredDays),
        [filteredDays]
    );

    const priorMetrics = useMemo(() => {
        const priorDays = getPriorPeriodDays(allDays, startDate, endDate);
        return aggregateDwellAcrossDays(priorDays);
    }, [allDays, startDate, endDate]);

    const filteredIncidents = useMemo((): DwellIncident[] => {
        if (!selectedOperator) return metrics.incidents;
        return metrics.incidents.filter(i => i.operatorId === selectedOperator);
    }, [metrics, selectedOperator]);

    // Daily trend data
    const dailyTrend = useMemo(() => {
        const byDate = new Map<string, { incidents: number; moderate: number; high: number; trackedMin: number }>();
        for (const day of filteredDays) {
            const dwell = day.byOperatorDwell;
            byDate.set(day.date, {
                incidents: dwell?.totalIncidents ?? 0,
                moderate: dwell?.byOperator.reduce((s, o) => s + o.moderateCount, 0) ?? 0,
                high: dwell?.byOperator.reduce((s, o) => s + o.highCount, 0) ?? 0,
                trackedMin: dwell?.totalTrackedDwellMinutes ?? 0,
            });
        }
        return [...byDate.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, data]) => ({ date, label: shortDateLabel(date), ...data }));
    }, [filteredDays]);

    const highCount = metrics.byOperator.reduce((s, o) => s + o.highCount, 0);
    const priorHighCount = priorMetrics.byOperator.reduce((s, o) => s + o.highCount, 0);

    return (
        <div className="space-y-5">
            {/* Export + Title Row */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-bold text-gray-900">Operator Dwell Report</h3>
                    <p className="text-xs text-gray-400">{startDate} — {endDate}</p>
                </div>
                <div className="flex items-center gap-2">
                    {onExportExcel && (
                        <button
                            onClick={onExportExcel}
                            disabled={exportingExcel}
                            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {exportingExcel ? 'Exporting...' : 'Export Excel'}
                        </button>
                    )}
                    {onExportPDF && (
                        <button
                            onClick={onExportPDF}
                            disabled={exportingPDF}
                            className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {exportingPDF ? 'Exporting...' : 'Export PDF'}
                        </button>
                    )}
                </div>
            </div>

            {/* Metric Cards with prior period comparison */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    icon={<AlertTriangle size={18} />}
                    label="Total Incidents"
                    value={fmt(metrics.totalIncidents)}
                    color="amber"
                    subValue={priorMetrics.totalIncidents > 0 ? formatDelta(metrics.totalIncidents, priorMetrics.totalIncidents) : undefined}
                />
                <MetricCard
                    icon={<Clock size={18} />}
                    label="Total Tracked Dwell"
                    value={`${metrics.totalTrackedDwellMinutes} min`}
                    color="cyan"
                    subValue={priorMetrics.totalTrackedDwellMinutes > 0 ? `${formatDelta(metrics.totalTrackedDwellMinutes, priorMetrics.totalTrackedDwellMinutes)} min` : undefined}
                />
                <MetricCard
                    icon={<Timer size={18} />}
                    label="High Severity"
                    value={fmt(highCount)}
                    color="red"
                    subValue={priorHighCount > 0 ? formatDelta(highCount, priorHighCount) : undefined}
                />
                <MetricCard
                    icon={<Users size={18} />}
                    label="Operators w/ Incidents"
                    value={fmt(metrics.byOperator.length)}
                    color="indigo"
                    subValue={priorMetrics.byOperator.length > 0 ? formatDelta(metrics.byOperator.length, priorMetrics.byOperator.length) : undefined}
                />
            </div>

            {/* Daily Trend Chart */}
            {dailyTrend.length > 1 && (
                <ChartCard title="Daily Incident Trend" subtitle="Dwell incidents per day across date range">
                    <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={dailyTrend}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                            <Tooltip
                                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
                                labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ''}
                            />
                            <Line type="monotone" dataKey="incidents" name="Total" stroke="#0891b2" strokeWidth={2} dot={{ r: 3 }} />
                            <Line type="monotone" dataKey="high" name="High" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </ChartCard>
            )}

            {/* Operator Summary Table */}
            <ChartCard
                title="Operator Summary"
                subtitle="Click a row to filter incidents"
                headerExtra={selectedOperator ? (
                    <button
                        onClick={() => setSelectedOperator(null)}
                        className="text-xs text-cyan-600 hover:text-cyan-700 font-medium"
                    >
                        Clear filter
                    </button>
                ) : undefined}
            >
                {metrics.byOperator.length === 0 ? (
                    <p className="text-sm text-gray-400 py-8 text-center">No dwell incidents in selected period</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                                    <th className="pb-2 pr-4 font-medium">Operator</th>
                                    <th className="pb-2 pr-4 font-medium text-right">Moderate</th>
                                    <th className="pb-2 pr-4 font-medium text-right">High</th>
                                    <th className="pb-2 pr-4 font-medium text-right">Total</th>
                                    <th className="pb-2 pr-4 font-medium text-right">Tracked (min)</th>
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
                                            <td className="py-2 pr-4 font-medium text-gray-900">{op.operatorId}</td>
                                            <td className="py-2 pr-4 text-right text-amber-600">{op.moderateCount}</td>
                                            <td className="py-2 pr-4 text-right text-red-600">{op.highCount}</td>
                                            <td className="py-2 pr-4 text-right font-medium">{op.totalIncidents}</td>
                                            <td className="py-2 pr-4 text-right">{(op.totalTrackedDwellSeconds / 60).toFixed(1)}</td>
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
                                    <th className="pb-2 pr-3 font-medium">Operator</th>
                                    <th className="pb-2 pr-3 font-medium">Date</th>
                                    <th className="pb-2 pr-3 font-medium">Route</th>
                                    <th className="pb-2 pr-3 font-medium">Stop</th>
                                    <th className="pb-2 pr-3 font-medium">Arrival</th>
                                    <th className="pb-2 pr-3 font-medium">Departure</th>
                                    <th className="pb-2 pr-3 font-medium text-right">Raw (min)</th>
                                    <th className="pb-2 pr-3 font-medium text-right">Tracked (min)</th>
                                    <th className="pb-2 font-medium">Severity</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredIncidents.map((inc, idx) => (
                                    <tr key={`${inc.operatorId}-${inc.date}-${inc.stopId}-${idx}`} className="border-b border-gray-100">
                                        <td className="py-2 pr-3 font-medium text-gray-900">{inc.operatorId}</td>
                                        <td className="py-2 pr-3 text-gray-600">{inc.date}</td>
                                        <td className="py-2 pr-3 text-gray-600">{inc.routeId}</td>
                                        <td className="py-2 pr-3 text-gray-600 max-w-[200px] truncate" title={inc.stopName}>{inc.stopName}</td>
                                        <td className="py-2 pr-3 text-gray-600 tabular-nums">{inc.observedArrivalTime}</td>
                                        <td className="py-2 pr-3 text-gray-600 tabular-nums">{inc.observedDepartureTime}</td>
                                        <td className="py-2 pr-3 text-right tabular-nums">{(inc.rawDwellSeconds / 60).toFixed(1)}</td>
                                        <td className="py-2 pr-3 text-right tabular-nums">{(inc.trackedDwellSeconds / 60).toFixed(1)}</td>
                                        <td className="py-2"><SeverityBadge severity={inc.severity} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </ChartCard>
        </div>
    );
};
