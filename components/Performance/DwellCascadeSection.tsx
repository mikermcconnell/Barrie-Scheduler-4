import React, { useMemo, useState } from 'react';
import { Zap, Target, Activity, AlertTriangle, ChevronDown, ChevronRight, Shield } from 'lucide-react';
import type {
    PerformanceDataSummary,
    DwellCascade,
    CascadeAffectedTrip,
    CascadeStopImpact,
    TerminalRecoveryStats,
    DailyCascadeMetrics,
    DwellSeverity,
} from '../../utils/performanceDataTypes';
import { MetricCard, ChartCard, fmt } from '../Analytics/AnalyticsShared';
import { aggregateCascadeAcrossDays } from '../../utils/schedule/operatorDwellUtils';
import { buildStopLoadLookup } from '../../utils/schedule/cascadeStoryUtils';
import CascadeStorySlideOver from './CascadeStorySlideOver';

interface DwellCascadeSectionProps {
    data: PerformanceDataSummary;
}

const CascadeBadge: React.FC<{ cascaded: boolean }> = ({ cascaded }) => (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
        cascaded
            ? 'bg-red-100 text-red-700'
            : 'bg-emerald-100 text-emerald-700'
    }`}>
        {cascaded ? 'Cascaded' : 'Absorbed'}
    </span>
);

const RecoveryBadge: React.FC<{ sufficient: boolean }> = ({ sufficient }) => (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
        sufficient
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-amber-100 text-amber-700'
    }`}>
        {sufficient ? 'Sufficient' : 'Needs More Recovery'}
    </span>
);

const SeverityBadge: React.FC<{ severity: DwellSeverity }> = ({ severity }) => (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${
        severity === 'high'
            ? 'bg-red-100 text-red-700'
            : 'bg-amber-100 text-amber-700'
    }`}>
        {severity.toUpperCase()}
    </span>
);

/** Format seconds to min string with 1 decimal. */
const fmtMin = (sec: number): string => (sec / 60).toFixed(1);

/** Format percentage. */
const fmtPct = (n: number, d: number): string => d === 0 ? '—' : `${Math.round((n / d) * 100)}%`;

/** Strip seconds from HH:MM:SS → HH:MM */
const fmtTime = (hhmm: string): string => hhmm.length >= 5 ? hhmm.slice(0, 5) : hhmm;

const CASCADES_PER_PAGE = 50;

export const DwellCascadeSection: React.FC<DwellCascadeSectionProps> = ({ data }) => {
    const [expandedCascade, setExpandedCascade] = useState<number | null>(null);
    const [stopFilter, setStopFilter] = useState<string | null>(null);
    const [cascadePage, setCascadePage] = useState(1);
    const [showDetails, setShowDetails] = useState(false);
    const [selectedCascade, setSelectedCascade] = useState<DwellCascade | null>(null);

    const hasCascadeData = data.dailySummaries.some(d => d.byCascade);

    const metrics: DailyCascadeMetrics = useMemo(
        () => aggregateCascadeAcrossDays(data.dailySummaries),
        [data.dailySummaries],
    );

    const stopLoadLookup = useMemo(
        () => buildStopLoadLookup(data.dailySummaries),
        [data.dailySummaries],
    );

    // Banner: total trips operated
    const totalTripsOperated = useMemo(
        () => data.dailySummaries.reduce((sum, d) => sum + (d.system?.tripCount ?? 0), 0),
        [data.dailySummaries],
    );

    const cascadedOnly = useMemo(
        () => metrics.cascades.filter(c => c.blastRadius > 0),
        [metrics.cascades],
    );

    // OTP impact: actual vs estimated without cascades
    const otpImpact = useMemo(() => {
        const totalAssessed = data.dailySummaries.reduce((sum, d) => sum + (d.system?.otp?.total ?? 0), 0);
        const totalOnTime = data.dailySummaries.reduce((sum, d) => sum + (d.system?.otp?.onTime ?? 0), 0);
        if (totalAssessed === 0) return null;
        const actualPct = (totalOnTime / totalAssessed) * 100;
        const penaltyPp = (metrics.totalBlastRadius / totalAssessed) * 100;
        const whatIfPct = Math.min(100, actualPct + penaltyPp);
        return { actualPct, penaltyPp, whatIfPct };
    }, [data.dailySummaries, metrics.totalBlastRadius]);

    // Worst incident by blast radius
    const worstIncident = useMemo(
        () => cascadedOnly.length > 0
            ? [...cascadedOnly].sort((a, b) => b.blastRadius - a.blastRadius)[0]
            : null,
        [cascadedOnly],
    );

    // Route attribution: total trips and cascade-caused late per route
    const routeRows = useMemo(() => {
        // Build routeId → { routeId, routeName, totalTrips } from dailySummaries
        const routeMap = new Map<string, { routeId: string; routeName: string; totalTrips: number }>();
        for (const day of data.dailySummaries) {
            for (const r of (day.byRoute ?? [])) {
                const existing = routeMap.get(r.routeId);
                if (existing) {
                    existing.totalTrips += r.tripCount;
                } else {
                    routeMap.set(r.routeId, {
                        routeId: r.routeId,
                        routeName: r.routeName,
                        totalTrips: r.tripCount,
                    });
                }
            }
        }

        // Count cascade-caused late trips per route
        const cascadeLateByRoute = new Map<string, number>();
        for (const c of cascadedOnly) {
            for (const ct of c.cascadedTrips) {
                if (ct.otpStatus === 'late') {
                    cascadeLateByRoute.set(ct.routeId, (cascadeLateByRoute.get(ct.routeId) ?? 0) + 1);
                }
            }
        }

        // Join and filter: only routes with cascade-caused > 0
        const rows: { routeId: string; routeName: string; totalTrips: number; cascadeCaused: number; otpPenaltyPp: number }[] = [];
        for (const [routeId, count] of cascadeLateByRoute.entries()) {
            const routeInfo = routeMap.get(routeId);
            if (routeInfo && count > 0) {
                const otpPenaltyPp = routeInfo.totalTrips > 0 ? (count / routeInfo.totalTrips) * 100 : 0;
                rows.push({ ...routeInfo, cascadeCaused: count, otpPenaltyPp });
            }
        }

        return rows.sort((a, b) => b.otpPenaltyPp - a.otpPenaltyPp);
    }, [data.dailySummaries, cascadedOnly]);

    // Top 5 incidents by blast radius
    const topIncidents = useMemo(
        () => cascadedOnly
            .filter(c => c.trackedDwellSeconds >= 300) // 5+ min dwell only — smaller values likely not the causal dwell
            .sort((a, b) => b.blastRadius - a.blastRadius)
            .slice(0, 5),
        [cascadedOnly],
    );

    const isMultiDay = data.dailySummaries.length > 1;

    // Existing detail: filter cascades by selected stop
    const worstTerminal = metrics.byTerminal.length > 0 ? metrics.byTerminal[0] : null;
    const filteredCascades = stopFilter
        ? metrics.cascades.filter(c => `${c.stopId}||${c.stopName}||${c.routeId}` === stopFilter)
        : metrics.cascades;
    const totalPages = Math.max(1, Math.ceil(filteredCascades.length / CASCADES_PER_PAGE));
    const currentPage = Math.min(cascadePage, totalPages);
    const pagedCascades = filteredCascades.slice(
        (currentPage - 1) * CASCADES_PER_PAGE,
        currentPage * CASCADES_PER_PAGE,
    );

    if (!hasCascadeData) {
        return (
            <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
                <span>
                    <strong>Cascade data not available.</strong>
                    {' '}Re-import STREETS data to compute cascade analysis.
                </span>
            </div>
        );
    }

    if (metrics.cascades.length === 0) {
        return (
            <div className="text-sm text-gray-400 py-12 text-center">
                No dwell incidents in selected period — no cascades to analyze.
            </div>
        );
    }

    return (
        <>
        <div className="space-y-5">

            {/* ── A: Impact Attribution Banner ── */}
            <div className={`flex items-start gap-3 px-4 py-4 rounded-lg border ${
                metrics.totalBlastRadius > 0
                    ? 'bg-red-50 border-red-200'
                    : 'bg-emerald-50 border-emerald-200'
            }`}>
                <Zap size={18} className={`mt-0.5 shrink-0 ${
                    metrics.totalBlastRadius > 0 ? 'text-red-500' : 'text-emerald-500'
                }`} />
                <div className="min-w-0">
                    {metrics.totalBlastRadius === 0 ? (
                        <p className="text-sm font-medium text-emerald-800">
                            All dwell incidents absorbed by recovery — no OTP impact detected.
                        </p>
                    ) : (
                        <>
                            <p className="text-sm font-semibold text-red-800">
                                Dwell cascades impacted an estimated{' '}
                                <span className="font-bold">{fmt(metrics.totalBlastRadius)}</span>
                                {' '}of{' '}
                                <span className="font-bold">{fmt(totalTripsOperated)}</span>
                                {' '}operated trips ({fmtPct(metrics.totalBlastRadius, totalTripsOperated)})
                                {isMultiDay ? ' across the selected period' : ' today'}.
                            </p>
                            {otpImpact && (
                                <p className="text-sm text-red-700 mt-1">
                                    Network OTP:{' '}
                                    <span className="font-semibold">{otpImpact.actualPct.toFixed(1)}%</span>
                                    {' '}actual → est.{' '}
                                    <span className="font-semibold text-red-800">{otpImpact.whatIfPct.toFixed(1)}%</span>
                                    {' '}without cascades
                                    {' '}
                                    <span className="text-red-500">(+{otpImpact.penaltyPp.toFixed(1)} pp)</span>
                                    <span
                                        className="ml-1.5 text-red-400 cursor-help"
                                        title="Upper-bound estimate. Assumes cascade-affected trips would otherwise be on time. Trips late for multiple reasons may be counted once."
                                    >(?)</span>
                                </p>
                            )}
                            {worstIncident && (
                                <p className="text-xs text-red-600 mt-1.5">
                                    Worst: Route {worstIncident.routeId} · Block {worstIncident.block} · {worstIncident.stopName}
                                    {' '}({fmtTime(worstIncident.observedDepartureTime)})
                                    {' '}—{' '}
                                    {fmtMin(worstIncident.trackedDwellSeconds)} min excess dwell → {worstIncident.affectedTripCount} trips affected
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* ── B + C: Two-column grid ── */}
            {(routeRows.length > 0 || topIncidents.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-[40%_1fr] gap-4 items-start">

                    {/* B: Route Attribution Table */}
                    <ChartCard
                        title="Route Attribution"
                        subtitle="Cascade-caused late trips by route"
                    >
                        {routeRows.length === 0 ? (
                            <p className="text-sm text-gray-400 py-8 text-center">No route attribution data</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                                            <th className="pb-2 pr-3 font-medium">Route</th>
                                            <th className="pb-2 pr-2 font-medium text-right">Trips</th>
                                            <th className="pb-2 pr-2 font-medium text-right">Cascade Late</th>
                                            <th className="pb-2 pr-2 font-medium text-right">OTP Penalty</th>
                                            <th className="pb-2 font-medium w-20"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {routeRows.map(row => {
                                            const maxPenalty = routeRows[0]?.otpPenaltyPp ?? 1;
                                            const barPct = maxPenalty > 0 ? (row.otpPenaltyPp / maxPenalty) * 100 : 0;
                                            return (
                                                <tr key={row.routeId} className="border-b border-gray-100">
                                                    <td className="py-2 pr-3">
                                                        <span className="font-medium text-gray-800">{row.routeId}</span>
                                                        <span className="ml-1.5 text-xs text-gray-400 truncate">{row.routeName}</span>
                                                    </td>
                                                    <td className="py-2 pr-2 text-right text-gray-500 tabular-nums">{fmt(row.totalTrips)}</td>
                                                    <td className="py-2 pr-2 text-right font-semibold text-red-600 tabular-nums">
                                                        {row.cascadeCaused}
                                                    </td>
                                                    <td className="py-2 pr-2 text-right tabular-nums text-red-600 font-medium">
                                                        {row.otpPenaltyPp.toFixed(1)} pp
                                                    </td>
                                                    <td className="py-2">
                                                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                                                            <div
                                                                className="bg-red-400 h-1.5 rounded-full"
                                                                style={{ width: `${Math.max(barPct, 2)}%` }}
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </ChartCard>

                    {/* C: Top Incident Cards */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-semibold text-gray-800">Top Incidents</h3>
                                <p className="text-xs text-gray-500">Highest blast-radius dwell events</p>
                            </div>
                        </div>
                        {topIncidents.length === 0 ? (
                            <p className="text-sm text-gray-400 py-4 text-center">No cascaded incidents</p>
                        ) : (
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                {topIncidents.map((incident, i) => {
                                    const lastTrip = incident.cascadedTrips.length > 0
                                        ? incident.cascadedTrips[incident.cascadedTrips.length - 1]
                                        : null;
                                    const recoveryTrip = incident.cascadedTrips.find(ct => ct.recoveredHere);
                                    return (
                                        <div
                                            key={`${incident.block}-${incident.tripName}-${incident.date}-${i}`}
                                            className="border border-gray-200 rounded-lg p-3 bg-white cursor-pointer hover:border-cyan-300 hover:shadow-sm transition-all"
                                            onClick={() => setSelectedCascade(incident)}
                                        >
                                            {/* Card header */}
                                            <div className="flex items-start justify-between gap-2 mb-1.5">
                                                <div className="min-w-0">
                                                    <span className="text-sm font-semibold text-gray-800">
                                                        Route {incident.routeId}
                                                    </span>
                                                    <span className="mx-1.5 text-gray-300">·</span>
                                                    <span className="text-sm text-gray-500 font-mono">Block {incident.block}</span>
                                                </div>
                                                <SeverityBadge severity={incident.severity} />
                                            </div>
                                            {/* Location + time */}
                                            <p className="text-xs text-gray-500 mb-2">
                                                {incident.stopName}
                                                <span className="mx-1.5 text-gray-300">·</span>
                                                {fmtTime(incident.observedDepartureTime)}
                                                {isMultiDay && (
                                                    <span className="ml-1.5 text-gray-400">({incident.date})</span>
                                                )}
                                            </p>
                                            {/* Metrics row */}
                                            <div className="flex items-center gap-4 text-xs text-gray-600 py-2 border-t border-b border-gray-100 mb-2">
                                                <span>
                                                    <span className="font-medium text-red-600">{fmtMin(incident.trackedDwellSeconds)} min</span>
                                                    {' '}excess dwell
                                                </span>
                                                <span>
                                                    <span className="font-medium text-gray-700">{fmtMin(incident.recoveryTimeAvailableSeconds)} min</span>
                                                    {' '}recovery
                                                </span>
                                            </div>
                                            {/* Trip pills */}
                                            {incident.cascadedTrips.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mb-2">
                                                    {incident.cascadedTrips.map((ct, ctIdx) => (
                                                        <span
                                                            key={ctIdx}
                                                            title={`${ct.tripName} — ${ct.otpStatus}`}
                                                            className={`inline-flex items-center px-1.5 py-0.5 text-xs rounded font-medium ${
                                                                ct.otpStatus === 'late'
                                                                    ? 'bg-red-100 text-red-700'
                                                                    : 'bg-emerald-100 text-emerald-700'
                                                            }`}
                                                        >
                                                            {ct.tripName}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {/* Footer */}
                                            <p className="text-xs text-gray-500">
                                                <span className="font-semibold text-red-600">{incident.affectedTripCount}</span>
                                                {' '}trips affected · {incident.blastRadius} late departures
                                                {recoveryTrip ? (
                                                    <span className="text-emerald-600"> · Recovered at {recoveryTrip.tripName}</span>
                                                ) : lastTrip && !lastTrip.recoveredHere ? (
                                                    <span className="text-red-500"> · Not recovered</span>
                                                ) : null}
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Details collapsible ── */}
            <div>
                <button
                    onClick={() => setShowDetails(v => !v)}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors py-1"
                >
                    {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {showDetails ? 'Hide details' : 'Show details'}
                </button>

                {showDetails && (
                    <div className="space-y-5 mt-4">
                        {/* KPI Cards */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <MetricCard
                                icon={<Zap size={18} />}
                                label="Cascaded Incidents"
                                value={`${fmt(metrics.totalCascaded)} / ${fmt(metrics.cascades.length)}`}
                                color="red"
                                subValue={`${fmtPct(metrics.totalCascaded, metrics.cascades.length)} escaped recovery`}
                            />
                            <MetricCard
                                icon={<Target size={18} />}
                                label="Avg Blast Radius"
                                value={metrics.avgBlastRadius.toFixed(1)}
                                color="amber"
                                subValue="trips affected per cascade"
                            />
                            <MetricCard
                                icon={<Activity size={18} />}
                                label="Total OTP Damage"
                                value={fmt(metrics.totalBlastRadius)}
                                color="cyan"
                                subValue="trip-observations made late by dwell"
                            />
                            <MetricCard
                                icon={<Shield size={18} />}
                                label="Worst Terminal"
                                value={worstTerminal ? worstTerminal.stopName.split(' ').slice(0, 3).join(' ') : '—'}
                                color="indigo"
                                subValue={worstTerminal
                                    ? `${worstTerminal.cascadedCount} cascades · ${fmtPct(worstTerminal.absorbedCount, worstTerminal.incidentCount)} absorbed`
                                    : 'No terminal data'}
                            />
                        </div>

                        {/* Stop Impact Ranking + Cascade Detail */}
                        <div className="grid grid-cols-1 lg:grid-cols-[35%_1fr] gap-4 items-start">
                            {/* Stop Impact Ranking */}
                            <ChartCard
                                title="Stop Impact Ranking"
                                subtitle="Stops ranked by downstream OTP damage"
                                headerExtra={stopFilter ? (
                                    <button
                                        onClick={() => { setStopFilter(null); setCascadePage(1); }}
                                        className="text-xs text-cyan-600 hover:text-cyan-700 font-medium"
                                    >
                                        Clear filter
                                    </button>
                                ) : undefined}
                            >
                                {metrics.byStop.length === 0 ? (
                                    <p className="text-sm text-gray-400 py-8 text-center">No stop data</p>
                                ) : (
                                    <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0 bg-white">
                                                <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                                                    <th className="pb-2 pr-3 font-medium">Stop</th>
                                                    <th className="pb-2 pr-3 font-medium">Route</th>
                                                    <th className="pb-2 pr-2 font-medium text-right">Inc</th>
                                                    <th className="pb-2 pr-2 font-medium text-right">Casc</th>
                                                    <th className="pb-2 pr-2 font-medium text-right">Avg BR</th>
                                                    <th className="pb-2 font-medium text-right">Damage</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {metrics.byStop.map((stop: CascadeStopImpact) => {
                                                    const key = `${stop.stopId}||${stop.stopName}||${stop.routeId}`;
                                                    const isSelected = stopFilter === key;
                                                    return (
                                                        <tr
                                                            key={`${stop.stopId}-${stop.routeId}`}
                                                            onClick={() => {
                                                                setStopFilter(isSelected ? null : key);
                                                                setCascadePage(1);
                                                                setExpandedCascade(null);
                                                            }}
                                                            className={`border-b border-gray-100 cursor-pointer transition-colors ${
                                                                isSelected ? 'bg-cyan-50' : 'hover:bg-gray-50'
                                                            }`}
                                                        >
                                                            <td className="py-2 pr-3 text-gray-700 max-w-[140px] truncate" title={stop.stopName}>
                                                                {stop.stopName}
                                                            </td>
                                                            <td className="py-2 pr-3 text-gray-500">{stop.routeId}</td>
                                                            <td className="py-2 pr-2 text-right">{stop.incidentCount}</td>
                                                            <td className="py-2 pr-2 text-right text-red-600 font-medium">{stop.cascadedCount}</td>
                                                            <td className="py-2 pr-2 text-right">{stop.avgBlastRadius.toFixed(1)}</td>
                                                            <td className="py-2 text-right font-medium text-amber-600">{stop.totalBlastRadius}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </ChartCard>

                            {/* Cascade Detail */}
                            <ChartCard
                                title="Cascade Detail"
                                subtitle={stopFilter ? 'Filtered by stop — click row to expand' : 'All cascades — click row to expand'}
                            >
                                {filteredCascades.length === 0 ? (
                                    <p className="text-sm text-gray-400 py-8 text-center">No cascades to display</p>
                                ) : (
                                    <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0 bg-white">
                                                <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                                                    <th className="pb-2 pr-1 font-medium w-5"></th>
                                                    <th className="pb-2 pr-3 font-medium">Date</th>
                                                    <th className="pb-2 pr-3 font-medium">Block</th>
                                                    <th className="pb-2 pr-3 font-medium">Trip</th>
                                                    <th className="pb-2 pr-3 font-medium">Stop</th>
                                                    <th className="pb-2 pr-2 font-medium text-right">Dwell</th>
                                                    <th className="pb-2 pr-2 font-medium text-right">Recovery</th>
                                                    <th className="pb-2 pr-2 font-medium text-right">BR</th>
                                                    <th className="pb-2 font-medium">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {pagedCascades.map((cascade: DwellCascade, idx: number) => {
                                                    const globalIdx = (currentPage - 1) * CASCADES_PER_PAGE + idx;
                                                    const isExpanded = expandedCascade === globalIdx;
                                                    return (
                                                        <React.Fragment key={`${cascade.block}-${cascade.tripName}-${cascade.date}-${idx}`}>
                                                            <tr
                                                                onClick={() => setExpandedCascade(isExpanded ? null : globalIdx)}
                                                                className={`border-b border-gray-100 cursor-pointer transition-colors ${
                                                                    isExpanded ? 'bg-gray-50' : 'hover:bg-gray-50'
                                                                }`}
                                                            >
                                                                <td className="py-2 pr-1 text-gray-400">
                                                                    {cascade.cascadedTrips.length > 0 ? (
                                                                        isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
                                                                    ) : null}
                                                                </td>
                                                                <td className="py-2 pr-3 text-gray-600">{cascade.date}</td>
                                                                <td className="py-2 pr-3 text-gray-600 font-mono text-xs">{cascade.block}</td>
                                                                <td className="py-2 pr-3 text-gray-700 max-w-[120px] truncate" title={cascade.tripName}>
                                                                    {cascade.tripName}
                                                                </td>
                                                                <td className="py-2 pr-3 text-gray-600 max-w-[120px] truncate" title={cascade.stopName}>
                                                                    {cascade.stopName}
                                                                </td>
                                                                <td className="py-2 pr-2 text-right tabular-nums">{fmtMin(cascade.trackedDwellSeconds)}</td>
                                                                <td className="py-2 pr-2 text-right tabular-nums">{Number.isFinite(cascade.recoveryTimeAvailableSeconds) ? fmtMin(cascade.recoveryTimeAvailableSeconds) : '—'}</td>
                                                                <td className="py-2 pr-2 text-right font-medium tabular-nums">
                                                                    {cascade.blastRadius > 0 ? (
                                                                        <span className="text-red-600">{cascade.blastRadius}</span>
                                                                    ) : (
                                                                        <span className="text-gray-400">0</span>
                                                                    )}
                                                                </td>
                                                                <td className="py-2"><CascadeBadge cascaded={cascade.blastRadius > 0} /></td>
                                                            </tr>
                                                            {isExpanded && cascade.cascadedTrips.length > 0 && (
                                                                <tr>
                                                                    <td colSpan={9} className="p-0">
                                                                        <div className="bg-gray-50 border-l-2 border-cyan-300 ml-5 px-4 py-2">
                                                                            <p className="text-xs text-gray-500 font-medium mb-1.5">
                                                                                Downstream affected trips ({cascade.cascadedTrips.length})
                                                                            </p>
                                                                            <table className="w-full text-xs">
                                                                                <thead>
                                                                                    <tr className="text-gray-400 uppercase tracking-wider">
                                                                                        <th className="pb-1 pr-3 text-left font-medium">Trip</th>
                                                                                        <th className="pb-1 pr-3 text-left font-medium">Route</th>
                                                                                        <th className="pb-1 pr-3 text-left font-medium">Sched. Dep</th>
                                                                                        <th className="pb-1 pr-2 text-right font-medium">Late (min)</th>
                                                                                        <th className="pb-1 pr-2 text-left font-medium">OTP</th>
                                                                                        <th className="pb-1 font-medium">Recovery</th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody>
                                                                                    {cascade.cascadedTrips.map((ct, ctIdx) => (
                                                                                        <tr key={ctIdx} className="border-t border-gray-200">
                                                                                            <td className="py-1.5 pr-3 text-gray-700 max-w-[120px] truncate">{ct.tripName}</td>
                                                                                            <td className="py-1.5 pr-3 text-gray-500">{ct.routeId}</td>
                                                                                            <td className="py-1.5 pr-3 text-gray-500 tabular-nums">{ct.terminalDepartureTime}</td>
                                                                                            <td className={`py-1.5 pr-2 text-right tabular-nums font-medium ${
                                                                                                ct.lateSeconds > 300 ? 'text-red-600' : 'text-amber-600'
                                                                                            }`}>
                                                                                                {fmtMin(ct.lateSeconds)}
                                                                                            </td>
                                                                                            <td className="py-1.5 pr-2">
                                                                                                <span className={`text-xs ${
                                                                                                    ct.otpStatus === 'late' ? 'text-red-600'
                                                                                                        : ct.otpStatus === 'early' ? 'text-amber-600'
                                                                                                            : 'text-emerald-600'
                                                                                                }`}>
                                                                                                    {ct.otpStatus}
                                                                                                </span>
                                                                                            </td>
                                                                                            <td className="py-1.5">
                                                                                                {ct.recoveredHere ? (
                                                                                                    <span className="text-emerald-600 font-medium">Recovered here</span>
                                                                                                ) : (
                                                                                                    <span className="text-red-500">Still late</span>
                                                                                                )}
                                                                                            </td>
                                                                                        </tr>
                                                                                    ))}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {filteredCascades.length > CASCADES_PER_PAGE && (
                                    <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                                        <span>
                                            Showing {(currentPage - 1) * CASCADES_PER_PAGE + 1}
                                            {'-'}
                                            {Math.min(currentPage * CASCADES_PER_PAGE, filteredCascades.length)}
                                            {' '}of {filteredCascades.length}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setCascadePage(p => Math.max(1, p - 1))}
                                                disabled={currentPage === 1}
                                                className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"
                                            >
                                                Prev
                                            </button>
                                            <span>Page {currentPage} / {totalPages}</span>
                                            <button
                                                onClick={() => setCascadePage(p => Math.min(totalPages, p + 1))}
                                                disabled={currentPage === totalPages}
                                                className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40"
                                            >
                                                Next
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </ChartCard>
                        </div>

                        {/* Terminal Recovery Analysis */}
                        {metrics.byTerminal.length > 0 && (
                            <ChartCard
                                title="Terminal Recovery Analysis"
                                subtitle="Is scheduled recovery time sufficient to absorb dwell at each turnpoint?"
                            >
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                                                <th className="pb-2 pr-3 font-medium">Terminal Stop</th>
                                                <th className="pb-2 pr-3 font-medium">Route</th>
                                                <th className="pb-2 pr-2 font-medium text-right">Incidents</th>
                                                <th className="pb-2 pr-2 font-medium text-right">Absorbed</th>
                                                <th className="pb-2 pr-2 font-medium text-right">Avg Recovery</th>
                                                <th className="pb-2 pr-2 font-medium text-right">Avg Late Exit</th>
                                                <th className="pb-2 font-medium">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {metrics.byTerminal.map((t: TerminalRecoveryStats) => (
                                                <tr key={`${t.stopId}-${t.routeId}`} className="border-b border-gray-100">
                                                    <td className="py-2 pr-3 text-gray-700 max-w-[200px] truncate" title={t.stopName}>
                                                        {t.stopName}
                                                    </td>
                                                    <td className="py-2 pr-3 text-gray-500">{t.routeId}</td>
                                                    <td className="py-2 pr-2 text-right">{t.incidentCount}</td>
                                                    <td className="py-2 pr-2 text-right">
                                                        <span className="text-emerald-600 font-medium">{fmtPct(t.absorbedCount, t.incidentCount)}</span>
                                                    </td>
                                                    <td className="py-2 pr-2 text-right tabular-nums">{fmtMin(t.avgScheduledRecoverySeconds)} min</td>
                                                    <td className="py-2 pr-2 text-right tabular-nums">{fmtMin(t.avgExcessLateSeconds)} min</td>
                                                    <td className="py-2"><RecoveryBadge sufficient={t.sufficientRecovery} /></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </ChartCard>
                        )}
                    </div>
                )}
            </div>
        </div>
        {selectedCascade && (
            <CascadeStorySlideOver
                cascade={selectedCascade}
                onClose={() => setSelectedCascade(null)}
                stopLoadLookup={stopLoadLookup}
                dailySummaries={data.dailySummaries}
            />
        )}
        </>
    );
};
