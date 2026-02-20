import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Users, Timer } from 'lucide-react';
import type { PerformanceDataSummary, DwellIncident, OperatorDwellSummary } from '../../utils/performanceDataTypes';
import { MetricCard, ChartCard, fmt } from '../Analytics/AnalyticsShared';
import { aggregateDwellAcrossDays } from '../../utils/schedule/operatorDwellUtils';

interface OperatorDwellModuleProps {
    data: PerformanceDataSummary;
    onExportExcel?: () => void;
    onExportPDF?: () => void;
    exportingExcel?: boolean;
    exportingPDF?: boolean;
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

export const OperatorDwellModule: React.FC<OperatorDwellModuleProps> = ({
    data, onExportExcel, onExportPDF, exportingExcel, exportingPDF,
}) => {
    const [selectedOperator, setSelectedOperator] = useState<string | null>(null);

    const metrics = useMemo(
        () => aggregateDwellAcrossDays(data.dailySummaries),
        [data.dailySummaries]
    );

    const filteredIncidents = useMemo((): DwellIncident[] => {
        if (!selectedOperator) return metrics.incidents;
        return metrics.incidents.filter(i => i.operatorId === selectedOperator);
    }, [metrics, selectedOperator]);

    const operatorsWithIncidents = metrics.byOperator.length;
    const highCount = metrics.byOperator.reduce((s, o) => s + o.highCount, 0);

    return (
        <div className="space-y-5">
            {/* Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    icon={<AlertTriangle size={18} />}
                    label="Total Incidents"
                    value={fmt(metrics.totalIncidents)}
                    color="amber"
                />
                <MetricCard
                    icon={<Clock size={18} />}
                    label="Total Tracked Dwell"
                    value={`${metrics.totalTrackedDwellMinutes} min`}
                    color="cyan"
                />
                <MetricCard
                    icon={<Timer size={18} />}
                    label="High Severity"
                    value={fmt(highCount)}
                    color="red"
                />
                <MetricCard
                    icon={<Users size={18} />}
                    label="Operators w/ Incidents"
                    value={fmt(operatorsWithIncidents)}
                    color="indigo"
                />
            </div>

            {/* Operator Summary Table */}
            <ChartCard
                title="Operator Summary"
                subtitle="Click a row to filter incidents by operator"
                headerExtra={
                    <div className="flex items-center gap-2">
                        {selectedOperator && (
                            <button
                                onClick={() => setSelectedOperator(null)}
                                className="text-xs text-cyan-600 hover:text-cyan-700 font-medium"
                            >
                                Clear filter
                            </button>
                        )}
                        {onExportExcel && (
                            <button
                                onClick={onExportExcel}
                                disabled={exportingExcel}
                                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {exportingExcel ? 'Exporting...' : 'Excel'}
                            </button>
                        )}
                        {onExportPDF && (
                            <button
                                onClick={onExportPDF}
                                disabled={exportingPDF}
                                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {exportingPDF ? 'Exporting...' : 'PDF'}
                            </button>
                        )}
                    </div>
                }
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
                subtitle={selectedOperator ? `Filtered to operator ${selectedOperator}` : 'All incidents — click an operator above to filter'}
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
