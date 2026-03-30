import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { AlertTriangle, ArrowUpDown, ChevronDown, ChevronUp, Clock, Users, Timer, TrendingUp } from 'lucide-react';
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
    shortDateLabel,
} from '../../utils/performanceDateUtils';

interface OperatorDwellModuleProps {
    data: PerformanceDataSummary;
}

const INCIDENTS_PER_PAGE = 100;
type TrendDatesStyle = 'monthDay' | 'numeric' | 'iso';
const TREND_DATES_STYLE: TrendDatesStyle = 'monthDay';

type SortCol = 'date' | 'routeId' | 'stopName' | 'observedArrivalTime' | 'observedDepartureTime' | 'trackedDwellSeconds' | 'severity';
type SortDir = 'asc' | 'desc';
type OperatorSortCol = 'operatorId' | 'moderateCount' | 'highCount' | 'totalIncidents' | 'totalTrackedDwellSeconds' | 'avgTrackedDwellSeconds' | 'incidentsPer100ServiceHours';
type TrendSortCol = 'routeId' | 'tripName' | 'block' | 'stopName' | 'approxTime' | 'distinctDays' | 'totalIncidents' | 'avgDwellMin' | 'operators' | 'dates';
const SEVERITY_ORDER: Record<string, number> = { moderate: 1, high: 2 };
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const SeverityBadge: React.FC<{ severity: 'moderate' | 'high' }> = ({ severity }) => (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
        severity === 'high'
            ? 'bg-red-100 text-red-700'
            : 'bg-amber-100 text-amber-700'
    }`}>
        {severity === 'high' ? 'High' : 'Moderate'}
    </span>
);

function formatTrendDate(dateStr: string, style: TrendDatesStyle): string {
    const iso = normalizeToISODate(dateStr);
    if (!iso) return dateStr;

    if (style === 'iso') return shortDateLabel(iso);

    const [yearStr, monthStr, dayStr] = iso.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const parsed = new Date(Date.UTC(year, month - 1, day, 12));
    if (Number.isNaN(parsed.getTime())) return iso;

    const formatOpts: Intl.DateTimeFormatOptions = style === 'numeric'
        ? { month: 'numeric', day: 'numeric' }
        : { month: 'short', day: 'numeric' };
    return parsed.toLocaleDateString('en-US', formatOpts);
}

function formatTrendDates(dates: string[], style: TrendDatesStyle): string {
    return dates.map(d => formatTrendDate(d, style)).join(', ');
}

function compareText(a: string, b: string): number {
    return collator.compare(a ?? '', b ?? '');
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
    if (!active) return <ArrowUpDown size={11} className="opacity-25" />;
    return dir === 'desc'
        ? <ChevronDown size={11} />
        : <ChevronUp size={11} />;
}

function SortableHeader({
    label,
    right = false,
    active,
    dir,
    onClick,
    title,
}: {
    label: string;
    right?: boolean;
    active: boolean;
    dir: SortDir;
    onClick: () => void;
    title?: string;
}) {
    return (
        <th className={`pb-2 pr-3 font-medium ${right ? 'text-right' : ''}`}>
            <button
                type="button"
                onClick={onClick}
                title={title}
                className={`inline-flex items-center gap-0.5 cursor-pointer select-none hover:text-gray-700 transition-colors ${right ? 'justify-end w-full' : ''}`}
            >
                {label}
                <SortIcon active={active} dir={dir} />
            </button>
        </th>
    );
}

export const OperatorDwellModule: React.FC<OperatorDwellModuleProps> = ({ data }) => {
    const [subView, setSubView] = useState<'incidents' | 'cascade'>('incidents');
    const [selectedOperator, setSelectedOperator] = useState<string | null>(null);
    const [incidentPage, setIncidentPage] = useState(1);
    const [sortCol, setSortCol] = useState<SortCol>('trackedDwellSeconds');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [operatorSortCol, setOperatorSortCol] = useState<OperatorSortCol>('totalIncidents');
    const [operatorSortDir, setOperatorSortDir] = useState<SortDir>('desc');
    const [trendSortCol, setTrendSortCol] = useState<TrendSortCol>('distinctDays');
    const [trendSortDir, setTrendSortDir] = useState<SortDir>('desc');
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
        const classified = metrics.incidents.filter(i => i.severity !== 'minor');
        if (!selectedOperator) return classified;
        return classified.filter(i => i.operatorId === selectedOperator);
    }, [metrics, selectedOperator]);

    const handleSort = useCallback((col: SortCol) => {
        if (col === sortCol) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortCol(col);
            setSortDir('desc');
        }
        setIncidentPage(1);
    }, [sortCol]);

    const sortedIncidents = useMemo(() => {
        const sorted = [...filteredIncidents];
        sorted.sort((a, b) => {
            let cmp = 0;
            if (sortCol === 'trackedDwellSeconds') {
                cmp = a.trackedDwellSeconds - b.trackedDwellSeconds;
            } else if (sortCol === 'severity') {
                cmp = (SEVERITY_ORDER[a.severity] ?? 0) - (SEVERITY_ORDER[b.severity] ?? 0);
            } else if (sortCol === 'date') {
                cmp = compareDateStrings(a.date, b.date);
            } else {
                cmp = compareText(a[sortCol], b[sortCol]);
            }
            return sortDir === 'desc' ? -cmp : cmp;
        });
        return sorted;
    }, [filteredIncidents, sortCol, sortDir]);

    useEffect(() => {
        setIncidentPage(1);
    }, [selectedOperator, filteredIncidents.length]);

    const totalIncidentPages = Math.max(1, Math.ceil(sortedIncidents.length / INCIDENTS_PER_PAGE));
    const currentIncidentPage = Math.min(incidentPage, totalIncidentPages);
    const pagedIncidents = useMemo(() => {
        const start = (currentIncidentPage - 1) * INCIDENTS_PER_PAGE;
        return sortedIncidents.slice(start, start + INCIDENTS_PER_PAGE);
    }, [currentIncidentPage, sortedIncidents]);

    const missingDwellDates = useMemo(() => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        return data.dailySummaries
            .filter(d => !d.byOperatorDwell)
            .map(d => d.date)
            .filter(date => new Date(`${date}T12:00:00`) >= cutoff);
    }, [data.dailySummaries]);
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

    // Trending dwell locations: high-severity incidents at same stop + same trip on 3+ distinct days
    const trendingLocations = useMemo(() => {
        const highIncidents = metrics.incidents.filter(i => i.severity === 'high');
        if (highIncidents.length === 0) return [];

        const groups = new Map<string, DwellIncident[]>();
        for (const inc of highIncidents) {
            if (!inc.tripName) continue;
            const key = `${inc.stopId}||${inc.tripName}`;
            const arr = groups.get(key);
            if (arr) arr.push(inc);
            else groups.set(key, [inc]);
        }

        const trends: {
            stopName: string;
            stopId: string;
            routeId: string;
            tripName: string;
            blocks: string[];
            approxTime: string;
            distinctDays: number;
            dates: string[];
            totalIncidents: number;
            avgDwellMin: number;
            operators: string[];
        }[] = [];

        for (const [, incidents] of groups) {
            const dates = [...new Set(incidents.map(i => i.date))].sort();
            if (dates.length < 3) continue;

            const operators = [...new Set(incidents.map(i => i.operatorId))].sort();
            const blocks = [...new Set(incidents.map(i => i.block))].sort();
            const totalDwell = incidents.reduce((s, i) => s + i.trackedDwellSeconds, 0);
            // Use earliest incident by date for a stable representative time
            const earliest = incidents.reduce((best, i) => i.date < best.date ? i : best);

            trends.push({
                stopName: earliest.stopName,
                stopId: earliest.stopId,
                routeId: earliest.routeId,
                tripName: earliest.tripName,
                blocks,
                approxTime: earliest.observedArrivalTime.slice(0, 5),
                distinctDays: dates.length,
                dates,
                totalIncidents: incidents.length,
                avgDwellMin: +(totalDwell / incidents.length / 60).toFixed(1),
                operators,
            });
        }

        return trends.sort((a, b) => {
            const mult = trendSortDir === 'asc' ? 1 : -1;
            let cmp = 0;
            switch (trendSortCol) {
                case 'routeId':
                    cmp = compareText(a.routeId, b.routeId);
                    break;
                case 'tripName':
                    cmp = compareText(a.tripName, b.tripName);
                    break;
                case 'block':
                    cmp = compareText(a.blocks.join(', '), b.blocks.join(', '));
                    break;
                case 'stopName':
                    cmp = compareText(a.stopName, b.stopName);
                    break;
                case 'approxTime':
                    cmp = compareText(a.approxTime, b.approxTime);
                    break;
                case 'distinctDays':
                    cmp = a.distinctDays - b.distinctDays;
                    break;
                case 'totalIncidents':
                    cmp = a.totalIncidents - b.totalIncidents;
                    break;
                case 'avgDwellMin':
                    cmp = a.avgDwellMin - b.avgDwellMin;
                    break;
                case 'operators':
                    cmp = compareText(a.operators.join(', '), b.operators.join(', '));
                    break;
                case 'dates':
                    cmp = compareText(a.dates.join(', '), b.dates.join(', '));
                    break;
            }
            return mult * cmp;
        });
    }, [metrics.incidents, trendSortCol, trendSortDir]);

    const operatorSummary = useMemo(() => {
        const rows = [...metrics.byOperator];
        rows.sort((a, b) => {
            const mult = operatorSortDir === 'asc' ? 1 : -1;
            let cmp = 0;
            switch (operatorSortCol) {
                case 'operatorId':
                    cmp = compareText(a.operatorId, b.operatorId);
                    break;
                case 'moderateCount':
                    cmp = a.moderateCount - b.moderateCount;
                    break;
                case 'highCount':
                    cmp = a.highCount - b.highCount;
                    break;
                case 'totalIncidents':
                    cmp = a.totalIncidents - b.totalIncidents;
                    break;
                case 'totalTrackedDwellSeconds':
                    cmp = a.totalTrackedDwellSeconds - b.totalTrackedDwellSeconds;
                    break;
                case 'avgTrackedDwellSeconds':
                    cmp = a.avgTrackedDwellSeconds - b.avgTrackedDwellSeconds;
                    break;
                case 'incidentsPer100ServiceHours':
                    cmp = (a.incidentsPer100ServiceHours ?? 0) - (b.incidentsPer100ServiceHours ?? 0);
                    break;
            }
            return mult * cmp;
        });
        return rows;
    }, [metrics.byOperator, operatorSortCol, operatorSortDir]);

    const handleOperatorSort = useCallback((col: OperatorSortCol) => {
        if (col === operatorSortCol) {
            setOperatorSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setOperatorSortCol(col);
            setOperatorSortDir('desc');
        }
    }, [operatorSortCol]);

    const handleTrendSort = useCallback((col: TrendSortCol) => {
        if (col === trendSortCol) {
            setTrendSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setTrendSortCol(col);
            setTrendSortDir('desc');
        }
    }, [trendSortCol]);

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
                    label="per 100 Svc Hours"
                    value={metrics.incidentsPer100ServiceHours?.toFixed(1) ?? '—'}
                    color="indigo"
                    subValue={`${metrics.byOperator.length} operators · ${avgPerOperator} avg each`}
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
                                        <SortableHeader label="Operator" active={operatorSortCol === 'operatorId'} dir={operatorSortDir} onClick={() => handleOperatorSort('operatorId')} />
                                        <SortableHeader label="Mod" right active={operatorSortCol === 'moderateCount'} dir={operatorSortDir} onClick={() => handleOperatorSort('moderateCount')} />
                                        <SortableHeader label="High" right active={operatorSortCol === 'highCount'} dir={operatorSortDir} onClick={() => handleOperatorSort('highCount')} />
                                        <SortableHeader label="Total" right active={operatorSortCol === 'totalIncidents'} dir={operatorSortDir} onClick={() => handleOperatorSort('totalIncidents')} />
                                        <SortableHeader label="Total (hr)" right active={operatorSortCol === 'totalTrackedDwellSeconds'} dir={operatorSortDir} onClick={() => handleOperatorSort('totalTrackedDwellSeconds')} />
                                        <SortableHeader label="Avg (min)" right active={operatorSortCol === 'avgTrackedDwellSeconds'} dir={operatorSortDir} onClick={() => handleOperatorSort('avgTrackedDwellSeconds')} />
                                        <SortableHeader label="/100h" right active={operatorSortCol === 'incidentsPer100ServiceHours'} dir={operatorSortDir} onClick={() => handleOperatorSort('incidentsPer100ServiceHours')} title="Incidents per 100 service hours" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {operatorSummary.map((op: OperatorDwellSummary) => {
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
                                                <td className="py-2 pr-3 text-right">{(op.avgTrackedDwellSeconds / 60).toFixed(1)}</td>
                                                <td className="py-2 text-right tabular-nums text-indigo-600">{op.incidentsPer100ServiceHours?.toFixed(1) ?? '—'}</td>
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
                                        <SortableHeader label="Date" active={sortCol === 'date'} dir={sortDir} onClick={() => handleSort('date')} />
                                        <SortableHeader label="Route" active={sortCol === 'routeId'} dir={sortDir} onClick={() => handleSort('routeId')} />
                                        <SortableHeader label="Stop" active={sortCol === 'stopName'} dir={sortDir} onClick={() => handleSort('stopName')} />
                                        <SortableHeader label="Arrival" active={sortCol === 'observedArrivalTime'} dir={sortDir} onClick={() => handleSort('observedArrivalTime')} />
                                        <SortableHeader label="Departure" active={sortCol === 'observedDepartureTime'} dir={sortDir} onClick={() => handleSort('observedDepartureTime')} />
                                        <SortableHeader label="Tracked (min)" right active={sortCol === 'trackedDwellSeconds'} dir={sortDir} onClick={() => handleSort('trackedDwellSeconds')} />
                                        <SortableHeader label="Severity" active={sortCol === 'severity'} dir={sortDir} onClick={() => handleSort('severity')} />
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
                    {sortedIncidents.length > INCIDENTS_PER_PAGE && (
                        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                            <span>
                                Showing {(currentIncidentPage - 1) * INCIDENTS_PER_PAGE + 1}
                                {'-'}
                                {Math.min(currentIncidentPage * INCIDENTS_PER_PAGE, sortedIncidents.length)}
                                {' '}of {sortedIncidents.length}
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

            {/* Trending Dwell Locations */}
            {trendingLocations.length > 0 && (
                <ChartCard
                    title="Trending Dwell Locations"
                    subtitle="High-severity incidents recurring on the same trip at the same stop on 3+ days"
                    headerExtra={
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded-full">
                            <TrendingUp size={12} />
                            {trendingLocations.length} trend{trendingLocations.length !== 1 ? 's' : ''}
                        </span>
                    }
                >
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                                    <SortableHeader label="Route" active={trendSortCol === 'routeId'} dir={trendSortDir} onClick={() => handleTrendSort('routeId')} />
                                    <SortableHeader label="Trip" active={trendSortCol === 'tripName'} dir={trendSortDir} onClick={() => handleTrendSort('tripName')} />
                                    <SortableHeader label="Block" active={trendSortCol === 'block'} dir={trendSortDir} onClick={() => handleTrendSort('block')} />
                                    <SortableHeader label="Stop" active={trendSortCol === 'stopName'} dir={trendSortDir} onClick={() => handleTrendSort('stopName')} />
                                    <SortableHeader label="~Time" active={trendSortCol === 'approxTime'} dir={trendSortDir} onClick={() => handleTrendSort('approxTime')} />
                                    <SortableHeader label="Days" right active={trendSortCol === 'distinctDays'} dir={trendSortDir} onClick={() => handleTrendSort('distinctDays')} />
                                    <SortableHeader label="Incidents" right active={trendSortCol === 'totalIncidents'} dir={trendSortDir} onClick={() => handleTrendSort('totalIncidents')} />
                                    <SortableHeader label="Avg (min)" right active={trendSortCol === 'avgDwellMin'} dir={trendSortDir} onClick={() => handleTrendSort('avgDwellMin')} />
                                    <SortableHeader label="Operators" active={trendSortCol === 'operators'} dir={trendSortDir} onClick={() => handleTrendSort('operators')} />
                                    <SortableHeader label="Dates" active={trendSortCol === 'dates'} dir={trendSortDir} onClick={() => handleTrendSort('dates')} />
                                </tr>
                            </thead>
                            <tbody>
                                {trendingLocations.map((t, idx) => (
                                    <tr key={`${t.stopId}-${t.tripName}-${idx}`} className="border-b border-gray-100">
                                        <td className="py-2 pr-3 text-gray-600">{t.routeId}</td>
                                        <td className="py-2 pr-3 text-gray-900 font-medium">{t.tripName}</td>
                                        <td className="py-2 pr-3 text-gray-600 text-xs">{t.blocks.join(', ')}</td>
                                        <td className="py-2 pr-3 text-gray-900 max-w-[200px] truncate" title={t.stopName}>{t.stopName}</td>
                                        <td className="py-2 pr-3 text-gray-600 tabular-nums">{t.approxTime}</td>
                                        <td className="py-2 pr-3 text-right font-bold text-red-700 tabular-nums">{`${t.distinctDays}/${numDays}`}</td>
                                        <td className="py-2 pr-3 text-right">{t.totalIncidents}</td>
                                        <td className="py-2 pr-3 text-right tabular-nums">{t.avgDwellMin}</td>
                                        <td className="py-2 pr-3 text-gray-600 text-xs">{t.operators.join(', ')}</td>
                                        <td className="py-2 text-gray-500 text-xs">{formatTrendDates(t.dates, TREND_DATES_STYLE)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </ChartCard>
            )}
            </>)}
        </div>
    );
};
