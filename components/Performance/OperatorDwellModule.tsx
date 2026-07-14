import React, { useCallback, useMemo, useState } from 'react';
import {
    AlertTriangle,
    BarChart3,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Download,
    Info,
    Search,
    ShieldCheck,
    TrendingUp,
} from 'lucide-react';
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { PerformanceDataSummary } from '../../utils/performanceDataTypes';
import {
    buildDwellIncidentReviewModel,
    compareDwellReviewRows,
    type DwellImpactStatus,
    type DwellIncidentReviewRow,
} from '../../utils/performanceDwellReview';
import { buildStopLoadLookup } from '../../utils/schedule/cascadeStoryUtils';
import { exportOperatorDwell, exportOperatorDwellPDF } from './reports/reportExporter';
import DwellIncidentDetailDrawer from './DwellIncidentDetailDrawer';

interface OperatorDwellModuleProps {
    data: PerformanceDataSummary;
}

type ViewMode = 'incidents' | 'patterns';
type SeverityFilter = 'all' | 'high' | 'moderate';
type SortMode = 'priority' | 'newest';

const ROWS_PER_PAGE = 75;

const formatNumber = (value: number): string => new Intl.NumberFormat('en-CA', { maximumFractionDigits: 1 }).format(value);
const minutes = (seconds: number): string => `${(seconds / 60).toFixed(1)} min`;

const impactLabel: Record<DwellImpactStatus, string> = {
    'otp-late': 'OTP-late carryover',
    'delay-carried': 'Delay carried',
    'no-later-carryover': 'No later carryover',
    unknown: 'Unknown',
};

const impactStyles: Record<DwellImpactStatus, string> = {
    'otp-late': 'border-red-200 bg-red-50 text-red-700',
    'delay-carried': 'border-amber-200 bg-amber-50 text-amber-700',
    'no-later-carryover': 'border-emerald-200 bg-emerald-50 text-emerald-700',
    unknown: 'border-gray-200 bg-gray-50 text-gray-600',
};

const SeverityBadge: React.FC<{ severity: 'moderate' | 'high' }> = ({ severity }) => (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
        {severity === 'high' ? 'High' : 'Moderate'}
    </span>
);

const ImpactBadge: React.FC<{ status: DwellImpactStatus }> = ({ status }) => (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${impactStyles[status]}`}>
        {impactLabel[status]}
    </span>
);

const SummaryCard: React.FC<{
    label: string;
    value: string;
    note: string;
    icon: React.ReactNode;
    tone?: 'neutral' | 'amber' | 'red' | 'cyan';
}> = ({ label, value, note, icon, tone = 'neutral' }) => {
    const toneClasses = {
        neutral: 'bg-gray-50 text-gray-600',
        amber: 'bg-amber-50 text-amber-700',
        red: 'bg-red-50 text-red-700',
        cyan: 'bg-cyan-50 text-cyan-700',
    }[tone];
    return (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
                    <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
                </div>
                <div className={`rounded-lg p-2 ${toneClasses}`}>{icon}</div>
            </div>
            <p className="mt-2 text-xs text-gray-500">{note}</p>
        </div>
    );
};

function getRowKey(row: DwellIncidentReviewRow): string {
    return row.incident.incidentId ?? [
        row.incident.date,
        row.incident.tripName,
        row.incident.stopId,
        row.incident.operatorId,
        row.incident.observedDepartureTime,
    ].join('|');
}

function compareNewest(a: DwellIncidentReviewRow, b: DwellIncidentReviewRow): number {
    const date = b.incident.date.localeCompare(a.incident.date);
    return date !== 0 ? date : b.incident.observedDepartureTime.localeCompare(a.incident.observedDepartureTime);
}

export const OperatorDwellModule: React.FC<OperatorDwellModuleProps> = ({ data }) => {
    const [view, setView] = useState<ViewMode>('incidents');
    const [severity, setSeverity] = useState<SeverityFilter>('all');
    const [impact, setImpact] = useState<DwellImpactStatus | 'all'>('all');
    const [operatorId, setOperatorId] = useState('all');
    const [search, setSearch] = useState('');
    const [sortMode, setSortMode] = useState<SortMode>('priority');
    const [page, setPage] = useState(1);
    const [selectedRow, setSelectedRow] = useState<DwellIncidentReviewRow | null>(null);
    const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);

    const model = useMemo(() => buildDwellIncidentReviewModel(data.dailySummaries), [data.dailySummaries]);
    const stopLoadLookup = useMemo(() => buildStopLoadLookup(data.dailySummaries), [data.dailySummaries]);
    const operators = useMemo(() => model.operatorContext.filter(row => row.incidentCount > 0), [model.operatorContext]);

    const activeDates = useMemo(() => data.dailySummaries.map(day => day.date).sort(), [data.dailySummaries]);
    const startDate = activeDates[0] ?? data.metadata.dateRange.start;
    const endDate = activeDates[activeDates.length - 1] ?? data.metadata.dateRange.end;

    const filteredRows = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        return model.rows.filter(row => {
            if (severity !== 'all' && row.incident.severity !== severity) return false;
            if (impact !== 'all' && row.impactStatus !== impact) return false;
            if (operatorId !== 'all' && row.incident.operatorId !== operatorId) return false;
            if (!query) return true;
            return [
                row.incident.routeId,
                row.incident.routeName,
                row.incident.stopName,
                row.incident.tripName,
                row.incident.block,
                row.incident.operatorId,
            ].some(value => value.toLocaleLowerCase().includes(query));
        }).sort(sortMode === 'priority' ? compareDwellReviewRows : compareNewest);
    }, [impact, model.rows, operatorId, search, severity, sortMode]);
    const filtersActive = severity !== 'all'
        || impact !== 'all'
        || operatorId !== 'all'
        || search.trim().length > 0;

    const totalPages = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
    const currentPage = Math.min(page, totalPages);
    const pagedRows = filteredRows.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

    const updateFilter = useCallback((setter: () => void) => {
        setter();
        setPage(1);
    }, []);

    const handleExport = useCallback(async (format: 'excel' | 'pdf') => {
        setExporting(format);
        setExportError(null);
        try {
            if (format === 'excel') {
                if (filtersActive) await exportOperatorDwell(data.dailySummaries, startDate, endDate, filteredRows, true);
                else await exportOperatorDwell(data.dailySummaries, startDate, endDate, filteredRows);
            } else if (filtersActive) {
                await exportOperatorDwellPDF(data.dailySummaries, startDate, endDate, filteredRows, true);
            } else {
                await exportOperatorDwellPDF(data.dailySummaries, startDate, endDate, filteredRows);
            }
        } catch {
            setExportError(`The ${format.toUpperCase()} export could not be created. Please try again.`);
        } finally {
            setExporting(null);
        }
    }, [data.dailySummaries, endDate, filteredRows, filtersActive, startDate]);

    const openRow = (row: DwellIncidentReviewRow) => setSelectedRow(row);
    const highPct = model.totalIncidents > 0 ? model.highCount / model.totalIncidents * 100 : 0;

    return (
        <div className="space-y-5">
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                    <div className="max-w-3xl">
                        <div className="flex items-center gap-2 text-cyan-700">
                            <ShieldCheck size={18} />
                            <span className="text-xs font-bold uppercase tracking-[0.16em]">Operational review</span>
                        </div>
                        <h3 className="mt-2 text-xl font-bold text-gray-900">Dwell Incident Review</h3>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                            Review unusually long stop dwell associated with late departures, then follow the evidence through the incident trip and later service. These are investigation signals, not proof of operator fault.
                        </p>
                        <details className="mt-3 text-sm text-gray-600">
                            <summary className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
                                <Info size={14} /> How incidents are defined
                            </summary>
                            <div className="mt-2 rounded-lg border border-cyan-100 bg-cyan-50/60 px-4 py-3 leading-6">
                                A reportable incident departs more than 3 minutes late and records more than 2 minutes of effective dwell. More than 5 minutes is high severity. Passenger activity, accessibility needs, traffic, schedule design, and other conditions may contribute.
                            </div>
                        </details>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <button type="button" disabled={exporting !== null || data.dailySummaries.length === 0} onClick={() => handleExport('excel')} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                            <Download size={15} /> {exporting === 'excel' ? 'Exporting…' : 'Excel'}
                        </button>
                        <button type="button" disabled={exporting !== null || data.dailySummaries.length === 0} onClick={() => handleExport('pdf')} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                            <Download size={15} /> {exporting === 'pdf' ? 'Exporting…' : 'PDF'}
                        </button>
                    </div>
                </div>
                {exportError && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{exportError}</p>}
            </section>

            {(model.daysMissingDwellData.length > 0 || model.daysNeedingReimport.length > 0) && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-600" />
                    <div>
                        <p className="font-bold">Some selected days have incomplete dwell evidence.</p>
                        <p className="mt-1 text-amber-800">
                            {model.daysMissingDwellData.length > 0 ? `${model.daysMissingDwellData.length} days have no dwell data. ` : ''}
                            {model.daysNeedingReimport.length > 0 ? `${model.daysNeedingReimport.length} days need re-import for exposure rates and complete incident context.` : ''}
                        </p>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                <SummaryCard label="Reportable incidents" value={formatNumber(model.totalIncidents)} note={`${formatNumber(model.reportableDwellMinutes)} reportable dwell minutes`} icon={<AlertTriangle size={18} />} tone="amber" />
                <SummaryCard label="High severity" value={formatNumber(model.highCount)} note={`${highPct.toFixed(0)}% of reportable incidents`} icon={<Clock3 size={18} />} tone="red" />
                <SummaryCard label="OTP-late departures" value={formatNumber(model.otpLateDepartures)} note={`Across ${model.otpCarryoverIncidentCount} originating incidents`} icon={<TrendingUp size={18} />} tone="red" />
                <SummaryCard label="Incidents / 1K visits" value={model.incidentsPer1kEligibleVisits === null ? '—' : model.incidentsPer1kEligibleVisits.toFixed(1)} note={model.eligibleTimepointVisits === null ? 'Re-import required for a valid denominator' : `${formatNumber(model.eligibleTimepointVisits)} eligible timepoint visits`} icon={<BarChart3 size={18} />} tone="cyan" />
            </div>

            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 border-b border-gray-200 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="inline-flex w-fit rounded-lg bg-gray-100 p-1" role="group" aria-label="Dwell review views">
                        <button type="button" aria-pressed={view === 'incidents'} onClick={() => setView('incidents')} className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold ${view === 'incidents' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Incident Queue</button>
                        <button type="button" aria-pressed={view === 'patterns'} onClick={() => setView('patterns')} className={`min-h-11 rounded-md px-4 py-2 text-sm font-semibold ${view === 'patterns' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Patterns</button>
                    </div>
                    {view === 'incidents' && <span className="text-sm text-gray-500">{filteredRows.length} of {model.totalIncidents} incidents</span>}
                </div>

                {view === 'incidents' ? (
                    <div>
                        <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_150px_190px_170px_150px]">
                            <label className="relative">
                                <span className="sr-only">Search incidents</span>
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input aria-label="Search incidents" value={search} onChange={event => updateFilter(() => setSearch(event.target.value))} placeholder="Search route, stop, trip, block, operator" className="min-h-11 w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100" />
                            </label>
                            <select aria-label="Severity" value={severity} onChange={event => updateFilter(() => setSeverity(event.target.value as SeverityFilter))} className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                                <option value="all">All severities</option><option value="high">High only</option><option value="moderate">Moderate only</option>
                            </select>
                            <select aria-label="Downstream effect" value={impact} onChange={event => updateFilter(() => setImpact(event.target.value as DwellImpactStatus | 'all'))} className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                                <option value="all">All downstream effects</option><option value="otp-late">OTP-late carryover</option><option value="delay-carried">Delay carried below threshold</option><option value="no-later-carryover">No later carryover</option><option value="unknown">Unknown</option>
                            </select>
                            <select aria-label="Operator" value={operatorId} onChange={event => updateFilter(() => setOperatorId(event.target.value))} className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                                <option value="all">All operators</option>{operators.map(operator => <option key={operator.operatorId} value={operator.operatorId}>{operator.operatorId}</option>)}
                            </select>
                            <select aria-label="Sort incidents" value={sortMode} onChange={event => { setSortMode(event.target.value as SortMode); setPage(1); }} className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                                <option value="priority">Operational impact</option><option value="newest">Newest first</option>
                            </select>
                        </div>

                        {pagedRows.length === 0 ? (
                            <div className="px-5 py-16 text-center"><ShieldCheck size={28} className="mx-auto text-gray-300" /><p className="mt-3 font-semibold text-gray-600">No reportable incidents match these filters.</p><p className="mt-1 text-sm text-gray-500">Adjust the filters or choose a different dashboard period.</p></div>
                        ) : (
                            <>
                                <div className="hidden overflow-x-auto md:block">
                                    <table className="w-full min-w-[1050px] text-sm">
                                        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                                            <tr><th className="px-4 py-3">When</th><th className="px-4 py-3">Route / stop</th><th className="px-4 py-3">Dwell</th><th className="px-4 py-3">Passenger context</th><th className="px-4 py-3">Operator / block</th><th className="px-4 py-3">Downstream evidence</th></tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {pagedRows.map(row => (
                                                <tr key={getRowKey(row)} onClick={() => openRow(row)} className="cursor-pointer hover:bg-cyan-50/50">
                                                    <td className="px-4 py-3"><div className="font-semibold text-gray-900">{row.incident.date}</div><div className="mt-1 text-xs text-gray-500">{row.incident.observedDepartureTime}</div></td>
                                                    <td className="px-4 py-3"><div className="font-semibold text-gray-900">Route {row.incident.routeId}</div><div className="mt-1 max-w-[230px] truncate text-gray-500" title={row.incident.stopName}>{row.incident.stopName}</div></td>
                                                    <td className="px-4 py-3"><SeverityBadge severity={row.incident.severity as 'moderate' | 'high'} /><div className="mt-1.5 font-semibold text-gray-900">{minutes(row.incident.trackedDwellSeconds)}</div><div className="text-xs text-gray-500">{row.departureLatenessSeconds === null ? 'Late departure' : `${minutes(Math.max(0, row.departureLatenessSeconds))} late`}</div></td>
                                                    <td className="px-4 py-3 text-gray-600"><div>{row.incident.boardings ?? '—'} on · {row.incident.alightings ?? '—'} off</div><div className="mt-1 text-xs text-gray-500">Wheelchair: {row.incident.wheelchairUsageCount ?? '—'} · Load: {row.incident.departureLoadReliable ? (row.incident.departureLoad ?? 0) : '—'}</div></td>
                                                    <td className="px-4 py-3"><div className="font-mono text-gray-800">{row.incident.operatorId}</div><div className="mt-1 text-xs text-gray-500">Block {row.incident.block}</div></td>
                                                    <td className="px-4 py-3"><ImpactBadge status={row.impactStatus} /><div className="mt-1.5 text-xs text-gray-500">{row.cascade && row.cascade.incidentRecordMatched !== false ? `${row.cascade.affectedTripCount} trips touched · ${row.cascade.blastRadius} OTP-late` : 'Re-import for complete evidence'}</div><button type="button" onClick={event => { event.stopPropagation(); openRow(row); }} className="mt-2 rounded-md px-2 py-1 font-semibold text-cyan-700 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400" aria-label={`Review dwell incident on Route ${row.incident.routeId} at ${row.incident.stopName}`}>Review evidence</button></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="divide-y divide-gray-100 md:hidden">
                                    {pagedRows.map(row => (
                                        <button key={getRowKey(row)} type="button" onClick={() => openRow(row)} className="w-full p-4 text-left hover:bg-cyan-50">
                                            <div className="flex items-start justify-between gap-3"><div><div className="font-bold text-gray-900">Route {row.incident.routeId} · {row.incident.stopName}</div><div className="mt-1 text-xs text-gray-500">{row.incident.date} at {row.incident.observedDepartureTime}</div></div><SeverityBadge severity={row.incident.severity as 'moderate' | 'high'} /></div>
                                            <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-gray-800">{minutes(row.incident.trackedDwellSeconds)}</span><ImpactBadge status={row.impactStatus} /></div>
                                            <div className="mt-2 text-xs leading-5 text-gray-600">Operator {row.incident.operatorId} · Block {row.incident.block} · {row.incident.boardings ?? '—'} on / {row.incident.alightings ?? '—'} off · wheelchair {row.incident.wheelchairUsageCount ?? '—'} · load {row.incident.departureLoadReliable ? (row.incident.departureLoad ?? 0) : '—'}{row.cascade && row.cascade.incidentRecordMatched !== false ? ` · ${row.cascade.affectedTripCount} trips touched · ${row.cascade.blastRadius} OTP-late` : ' · downstream evidence unavailable'}</div>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}

                        {filteredRows.length > ROWS_PER_PAGE && (
                            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-500">
                                <span>Showing {(currentPage - 1) * ROWS_PER_PAGE + 1}–{Math.min(currentPage * ROWS_PER_PAGE, filteredRows.length)} of {filteredRows.length}</span>
                                <div className="flex items-center gap-2"><button type="button" aria-label="Previous incident page" disabled={currentPage === 1} onClick={() => setPage(value => Math.max(1, value - 1))} className="min-h-11 min-w-11 rounded-lg border border-gray-200 p-2 disabled:opacity-40"><ChevronLeft size={15} className="mx-auto" /></button><span>{currentPage} / {totalPages}</span><button type="button" aria-label="Next incident page" disabled={currentPage === totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))} className="min-h-11 min-w-11 rounded-lg border border-gray-200 p-2 disabled:opacity-40"><ChevronRight size={15} className="mx-auto" /></button></div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-6 p-4 sm:p-5">
                        <section className="rounded-xl border border-gray-200 p-4">
                            <div><h4 className="font-bold text-gray-900">Exposure-normalized trend</h4><p className="mt-1 text-sm text-gray-500">Reportable incidents per 1,000 eligible timepoint visits.</p></div>
                            {model.dailyTrend.some(point => point.incidentsPer1kEligibleVisits !== null) ? (
                                <><div className="mt-4 h-64" aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><LineChart data={model.dailyTrend}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip formatter={(value: number) => [value.toFixed(1), 'Incidents / 1K visits']} /><Line type="monotone" dataKey="incidentsPer1kEligibleVisits" stroke="#0891b2" strokeWidth={2} connectNulls={false} /></LineChart></ResponsiveContainer></div><table className="sr-only"><caption>Daily reportable dwell incident rate</caption><thead><tr><th>Date</th><th>Incidents per 1,000 eligible visits</th></tr></thead><tbody>{model.dailyTrend.map(point => <tr key={point.date}><td>{point.date}</td><td>{point.incidentsPer1kEligibleVisits?.toFixed(1) ?? 'Unavailable'}</td></tr>)}</tbody></table></>
                            ) : <p className="mt-5 rounded-lg bg-gray-50 px-4 py-8 text-center text-sm text-gray-500">Re-import the selected period to calculate exposure-normalized trends.</p>}
                        </section>

                        <section className="rounded-xl border border-gray-200">
                            <div className="border-b border-gray-100 p-4"><h4 className="font-bold text-gray-900">Recurring route, trip, and stop patterns</h4><p className="mt-1 text-sm text-gray-500">Reportable incidents on at least three distinct service days.</p></div>
                            {model.patterns.length === 0 ? <p className="px-4 py-10 text-center text-sm text-gray-500">No recurring patterns meet the three-day threshold.</p> : (
                                <><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[820px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">Route / stop</th><th className="px-4 py-3">Trip</th><th className="px-4 py-3 text-right">Days</th><th className="px-4 py-3 text-right">Incidents</th><th className="px-4 py-3 text-right">High</th><th className="px-4 py-3 text-right">Avg dwell</th><th className="px-4 py-3 text-right">OTP-late dep.</th><th className="px-4 py-3 text-right">Operators</th></tr></thead><tbody className="divide-y divide-gray-100">{model.patterns.map(pattern => <tr key={pattern.key}><td className="px-4 py-3"><div className="font-semibold text-gray-900">Route {pattern.routeId}</div><div className="mt-1 text-gray-500">{pattern.stopName}</div></td><td className="px-4 py-3 text-gray-600">{pattern.tripName}</td><td className="px-4 py-3 text-right font-semibold">{pattern.distinctDays}</td><td className="px-4 py-3 text-right">{pattern.incidentCount}</td><td className="px-4 py-3 text-right text-red-700">{pattern.highCount}</td><td className="px-4 py-3 text-right">{minutes(pattern.avgDwellSeconds)}</td><td className="px-4 py-3 text-right">{pattern.otpLateDepartures}</td><td className="px-4 py-3 text-right">{pattern.operatorCount}</td></tr>)}</tbody></table></div><div className="divide-y divide-gray-100 md:hidden">{model.patterns.map(pattern => <div key={pattern.key} className="p-4 text-sm"><div className="font-bold text-gray-900">Route {pattern.routeId} · {pattern.stopName}</div><div className="mt-1 text-gray-600">{pattern.tripName}</div><div className="mt-2 text-xs leading-5 text-gray-600">{pattern.distinctDays} days · {pattern.incidentCount} incidents · {pattern.highCount} high · {minutes(pattern.avgDwellSeconds)} avg · {pattern.otpLateDepartures} OTP-late · {pattern.operatorCount} operators</div></div>)}</div></>
                            )}
                        </section>

                        <section className="rounded-xl border border-gray-200">
                            <div className="border-b border-gray-100 p-4"><h4 className="font-bold text-gray-900">Operator context</h4><p className="mt-1 text-sm text-gray-500">Alphabetical operational context—not a ranking or finding of fault.</p></div>
                            {model.operatorContext.length === 0 ? <p className="px-4 py-10 text-center text-sm text-gray-500">No operator context is available.</p> : (
                                <><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[700px] text-sm"><thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">Operator</th><th className="px-4 py-3 text-right">Eligible visits</th><th className="px-4 py-3 text-right">Reportable</th><th className="px-4 py-3 text-right">High</th><th className="px-4 py-3 text-right">Rate / 1K</th><th className="px-4 py-3 text-right">Reportable dwell</th></tr></thead><tbody className="divide-y divide-gray-100">{model.operatorContext.map(operator => <tr key={operator.operatorId}><td className="px-4 py-3 font-mono font-semibold text-gray-900">{operator.operatorId}</td><td className="px-4 py-3 text-right">{operator.eligibleTimepointVisits ?? '—'}</td><td className="px-4 py-3 text-right">{operator.incidentCount}</td><td className="px-4 py-3 text-right text-red-700">{operator.highCount}</td><td className="px-4 py-3 text-right">{operator.incidentsPer1kEligibleVisits?.toFixed(1) ?? '—'}</td><td className="px-4 py-3 text-right">{minutes(operator.reportableDwellSeconds)}</td></tr>)}</tbody></table></div><div className="divide-y divide-gray-100 md:hidden">{model.operatorContext.map(operator => <div key={operator.operatorId} className="p-4 text-sm"><div className="font-mono font-bold text-gray-900">{operator.operatorId}</div><div className="mt-2 text-xs leading-5 text-gray-600">{operator.eligibleTimepointVisits ?? '—'} eligible visits · {operator.incidentCount} reportable · {operator.highCount} high · {operator.incidentsPer1kEligibleVisits?.toFixed(1) ?? '—'} / 1K · {minutes(operator.reportableDwellSeconds)} reportable dwell</div></div>)}</div></>
                            )}
                        </section>
                    </div>
                )}
            </div>

            {selectedRow && (
                <DwellIncidentDetailDrawer row={selectedRow} onClose={() => setSelectedRow(null)} stopLoadLookup={stopLoadLookup} dailySummaries={data.dailySummaries} />
            )}
        </div>
    );
};

export default OperatorDwellModule;
