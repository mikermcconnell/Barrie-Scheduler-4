import React, { useEffect, useMemo, useState } from 'react';
import {
    Bar,
    CartesianGrid,
    ComposedChart,
    Legend,
    Line,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { AlertTriangle, BusFront, ShieldCheck } from 'lucide-react';
import { ChartCard } from '../Analytics/AnalyticsShared';
import type {
    RidershipStopProfileOption,
    RidershipStopProfileResult,
    RidershipStopProfileRow,
} from '../../utils/performanceRidershipStopProfile';

export type RidershipStopProfileChartOption = RidershipStopProfileOption;

export interface RidershipStopProfileChartProps {
    data: RidershipStopProfileResult;
    periodMode: 'single-day' | 'multi-day';
}

interface TooltipRow extends RidershipStopProfileRow {
    stopNumber: number;
}

function LoadPointDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: TooltipRow }) {
    if (typeof cx !== 'number' || typeof cy !== 'number' || !payload || payload.averageLoad === null) return null;
    const observedOnly = payload.loadSource === 'observed';
    return (
        <circle
            cx={cx}
            cy={cy}
            r={3.5}
            fill={observedOnly ? '#164e63' : '#ffffff'}
            stroke={observedOnly ? '#164e63' : '#0284c7'}
            strokeWidth={observedOnly ? 1 : 2}
            data-load-source={payload.loadSource}
        />
    );
}

function stopRowKey(stop: TooltipRow): string {
    const occurrenceIndex = 'occurrenceIndex' in stop && typeof stop.occurrenceIndex === 'number'
        ? stop.occurrenceIndex
        : stop.stopNumber;
    return `${stop.stopId}-${occurrenceIndex}`;
}

function formatMetric(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function loadSourceLabel(row: RidershipStopProfileRow): string {
    switch (row.loadSource) {
        case 'block-inferred':
            return 'Heatmap-estimated onboard';
        case 'mixed':
            return 'Average onboard (mixed estimate)';
        case 'legacy':
            return 'Average onboard (historical estimate)';
        default:
            return 'Average onboard';
    }
}

function MetricSummary({ label, value, detail }: { label: string; value: string; detail?: string }) {
    return (
        <div className="min-w-0 px-4 py-3 first:pl-0 last:pr-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
            <p className="mt-1 truncate text-sm font-bold text-gray-900" title={value}>{value}</p>
            {detail && <p className="mt-0.5 text-[11px] text-gray-400">{detail}</p>}
        </div>
    );
}

function FlowTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: TooltipRow }> }) {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;

    return (
        <div className="max-w-xs rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
            <p className="font-semibold text-gray-900">{row.stopNumber}. {row.stopName}</p>
            <p className="mb-2 text-[11px] text-gray-400">Stop {row.stopId}</p>
            <div className="space-y-1 text-xs">
                <p className="flex justify-between gap-6 text-gray-600"><span>Boardings</span><strong className="text-cyan-700">{formatMetric(row.boardings)}</strong></p>
                <p className="flex justify-between gap-6 text-gray-600"><span>Alightings</span><strong className="text-violet-700">{formatMetric(row.alightings)}</strong></p>
                {row.averageLoad !== null && (
                    <p className="flex justify-between gap-6 text-gray-600"><span>{loadSourceLabel(row)}</span><strong className="text-slate-800">{formatMetric(row.averageLoad)}</strong></p>
                )}
                {row.loadObservationCount !== null && (
                    <p className="flex justify-between gap-6 text-gray-400"><span>Load observations</span><span>{row.loadObservationCount.toLocaleString()}</span></p>
                )}
            </div>
        </div>
    );
}

export const RidershipStopProfileChart: React.FC<RidershipStopProfileChartProps> = ({ data, periodMode }) => {
    const { options: profiles, defaultOptionKey } = data;
    const defaultProfile = profiles.find(profile => profile.key === defaultOptionKey)
        ?? [...profiles].sort((a, b) => b.totalBoardings - a.totalBoardings)[0];
    const [selectedKey, setSelectedKey] = useState<string>(() => defaultProfile?.key ?? '');

    useEffect(() => {
        if (!profiles.some(profile => profile.key === selectedKey)) {
            setSelectedKey(defaultProfile?.key ?? '');
        }
    }, [defaultProfile, profiles, selectedKey]);

    const selected = profiles.find(profile => profile.key === selectedKey) ?? defaultProfile;
    const routes = useMemo(() => {
        const byId = new Map<string, string>();
        profiles.forEach(profile => byId.set(profile.routeId, profile.routeName || `Route ${profile.routeId}`));
        return Array.from(byId, ([routeId, routeName]) => ({ routeId, routeName }))
            .sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true }));
    }, [profiles]);
    const directions = selected
        ? profiles.filter(profile => profile.routeId === selected.routeId)
        : [];

    const selectRoute = (routeId: string) => {
        const candidates = profiles.filter(profile => profile.routeId === routeId);
        const next = [...candidates].sort((a, b) => b.totalBoardings - a.totalBoardings)[0];
        setSelectedKey(next?.key ?? '');
    };

    const rows = useMemo<TooltipRow[]>(() => selected
        ? [...selected.rows]
            .sort((a, b) => a.routeStopIndex - b.routeStopIndex)
            .map((stop, index) => ({ ...stop, stopNumber: index + 1 }))
        : [], [selected]);
    const hasBoardings = rows.some(stop => stop.boardings !== 0);
    const hasAlightings = rows.some(stop => stop.alightings !== 0);
    const hasBars = hasBoardings || hasAlightings;
    const hasLoad = rows.some(stop => stop.averageLoad !== null);
    const busiestBoarding = [...rows].sort((a, b) => b.boardings - a.boardings)[0];
    const busiestAlighting = [...rows].sort((a, b) => b.alightings - a.alightings)[0];
    const peakLoad = [...rows].filter(stop => stop.averageLoad !== null)
        .sort((a, b) => (b.averageLoad ?? 0) - (a.averageLoad ?? 0))[0];
    const isAverage = periodMode === 'multi-day';
    const activityUnit = isAverage ? 'Avg / service day' : 'Daily total';
    const chartWidth = Math.max(760, rows.length * 62);
    const confidence = selected?.loadQuality;
    const confidenceTone = confidence?.rating === 'high'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : confidence?.rating === 'medium'
            ? 'border-sky-200 bg-sky-50 text-sky-800'
            : confidence?.rating === 'low'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-slate-200 bg-slate-50 text-slate-700';
    const accessibleSummary = selected
        ? `${selected.routeId} ${selected.direction}. ${rows.length} stops. ${activityUnit}. ${hasBoardings && busiestBoarding ? `Busiest boarding stop is ${busiestBoarding.stopName} at ${formatMetric(busiestBoarding.boardings)}.` : 'No boarding activity.'} ${hasAlightings && busiestAlighting ? `Busiest alighting stop is ${busiestAlighting.stopName} at ${formatMetric(busiestAlighting.alightings)}.` : 'No alighting activity.'} ${peakLoad ? `Peak average onboard load is ${formatMetric(peakLoad.averageLoad ?? 0)} at ${peakLoad.stopName}.` : 'Average onboard load is unavailable.'}`
        : 'No passenger flow data is available.';

    return (
        <ChartCard
            title="Passenger Flow by Stop"
            subtitle={isAverage
                ? 'Average boardings and alightings per observed service day, with average onboard load'
                : 'Boardings and alightings by stop, with average onboard load'}
            headerExtra={selected?.multipleStopPatterns ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                    <AlertTriangle size={12} aria-hidden="true" /> Multiple stop patterns
                </span>
            ) : undefined}
        >
            {profiles.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center text-center" role="status">
                    <span className="mb-3 rounded-full bg-gray-100 p-3 text-gray-400"><BusFront size={22} aria-hidden="true" /></span>
                    <p className="text-sm font-semibold text-gray-700">No stop-level ridership data</p>
                    <p className="mt-1 max-w-sm text-xs text-gray-400">Try a different date, day type, or route filter.</p>
                </div>
            ) : selected && (
                <>
                    <div className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-gray-100 bg-gray-50/70 px-3 py-2.5" aria-label="Passenger flow controls">
                        <label className="min-w-[190px] text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                            Route
                            <select
                                aria-label="Passenger flow route"
                                value={selected.routeId}
                                onChange={event => selectRoute(event.target.value)}
                                className="mt-1 block w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                            >
                                {routes.map(route => <option key={route.routeId} value={route.routeId}>{route.routeId} — {route.routeName}</option>)}
                            </select>
                        </label>
                        <fieldset>
                            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Direction</legend>
                            <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
                                {directions.map(profile => (
                                    <button
                                        key={profile.key}
                                        type="button"
                                        aria-pressed={profile.key === selected.key}
                                        onClick={() => setSelectedKey(profile.key)}
                                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-cyan-300 ${profile.key === selected.key
                                            ? 'bg-white text-gray-900 shadow-sm'
                                            : 'text-gray-500 hover:bg-white/60 hover:text-gray-700'}`}
                                    >
                                        {profile.direction}
                                    </button>
                                ))}
                            </div>
                        </fieldset>
                        <span className="ml-auto pb-1 text-xs text-gray-400">{selected.serviceDays} observed service {selected.serviceDays === 1 ? 'day' : 'days'}</span>
                    </div>

                    <div className="mb-4 grid grid-cols-2 divide-x divide-y divide-gray-100 border-y border-gray-100 sm:grid-cols-4 sm:divide-y-0">
                        <MetricSummary label="Busiest boarding" value={hasBoardings && busiestBoarding ? busiestBoarding.stopName : '—'} detail={hasBoardings && busiestBoarding ? `${formatMetric(busiestBoarding.boardings)} · ${activityUnit}` : 'No boarding activity'} />
                        <MetricSummary label="Busiest alighting" value={hasAlightings && busiestAlighting ? busiestAlighting.stopName : '—'} detail={hasAlightings && busiestAlighting ? `${formatMetric(busiestAlighting.alightings)} · ${activityUnit}` : 'No alighting activity'} />
                        <MetricSummary
                            label="Peak average onboard"
                            value={peakLoad ? formatMetric(peakLoad.averageLoad ?? 0) : '—'}
                            detail={peakLoad
                                ? `${peakLoad.stopName}${peakLoad.loadSource === 'block-inferred' ? ' · Heatmap estimate' : peakLoad.loadSource === 'mixed' ? ' · Mixed estimate' : ''}`
                                : 'Load unavailable'}
                        />
                        <MetricSummary label="Observed service days" value={selected.serviceDays.toLocaleString()} detail={isAverage ? 'Average denominator' : 'Selected date'} />
                    </div>

                    <section className={`mb-3 rounded-xl border px-4 py-3 ${confidenceTone}`} aria-label="Load confidence" data-testid="load-confidence-panel">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex items-start gap-2">
                                <ShieldCheck size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                                <div>
                                    <h3 className="text-sm font-bold">Load confidence</h3>
                                    <p className="mt-0.5 text-xs opacity-80">Opportunity-weighted APC and inference quality · method v{confidence?.methodVersion ?? 1}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-xl font-black tabular-nums">{confidence?.score === null || confidence?.score === undefined ? '—' : `${confidence.score}/100`}</div>
                                <div className="text-[10px] font-bold uppercase tracking-wider">{confidence?.rating ?? 'unavailable'}</div>
                            </div>
                        </div>
                        {confidence && (
                            <>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                                    <div><span className="block opacity-65">Observed APC</span><strong>{confidence.observedOpportunityCount}/{confidence.totalOpportunityCount}</strong></div>
                                    <div><span className="block opacity-65">Heatmap estimated</span><strong>{confidence.estimatedOpportunityCount}/{confidence.totalOpportunityCount}</strong></div>
                                    <div><span className="block opacity-65">Historical estimate</span><strong>{confidence.legacyEstimatedOpportunityCount}/{confidence.totalOpportunityCount}</strong></div>
                                    <div><span className="block opacity-65">Unavailable</span><strong>{confidence.unavailableOpportunityCount}/{confidence.totalOpportunityCount}</strong></div>
                                </div>
                                {confidence.issues.length > 0 ? (
                                    <ul className="mt-3 space-y-1 border-t border-current/10 pt-2 text-xs" aria-label="Load confidence findings">
                                        {confidence.issues.map(issue => <li key={issue.code} className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{issue.message}</span></li>)}
                                    </ul>
                                ) : (
                                    <p className="mt-3 border-t border-current/10 pt-2 text-xs">No load-quality exceptions were detected for this route and direction.</p>
                                )}
                                <p className="mt-2 text-[11px] opacity-70">Inferred values are planning estimates. Lower-bound anchors and open block endings should be reviewed before operational decisions.</p>
                            </>
                        )}
                    </section>

                    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5" aria-label="Load evidence coverage" data-testid="load-evidence-coverage">
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
                            <strong className="text-slate-800">Load evidence</strong>
                            <span className="inline-flex items-center gap-1.5">
                                <span className="h-2.5 w-2.5 rounded-full bg-cyan-900" aria-hidden="true" />
                                Observed APC: <strong className="text-slate-800">{selected.loadEvidence.observedStopCount}/{selected.loadEvidence.totalStopCount} stops</strong>
                                <span className="text-slate-400">· {selected.loadEvidence.observedObservationCount.toLocaleString()} samples</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <span className="h-2.5 w-2.5 rounded-full border-2 border-sky-600 bg-white" aria-hidden="true" />
                                Heatmap estimate: <strong className="text-slate-800">{selected.loadEvidence.estimatedStopCount}/{selected.loadEvidence.totalStopCount} stops</strong>
                                <span className="text-slate-400">· {selected.loadEvidence.estimatedObservationCount.toLocaleString()} samples</span>
                            </span>
                            <span>Unavailable: <strong className="text-slate-800">{selected.loadEvidence.unavailableStopCount}/{selected.loadEvidence.totalStopCount} stops</strong></span>
                            {selected.loadEvidence.legacyStopCount > 0 && (
                                <span>Historical weighting: <strong className="text-slate-800">{selected.loadEvidence.legacyStopCount} stops</strong> <span className="text-slate-400">· {selected.loadEvidence.legacyDayCount} daily averages</span></span>
                            )}
                        </div>
                    </div>

                    {!hasBars && !hasLoad ? (
                        <div className="flex h-[260px] items-center justify-center text-sm text-gray-400" role="status">No stop activity or reliable load observations for this route and direction.</div>
                    ) : (
                        <>
                            <p className="sr-only" role="img" aria-label={accessibleSummary}>{accessibleSummary}</p>
                            {!hasLoad && <p className="mb-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">Average onboard load is unavailable; boarding and alighting activity is shown.</p>}
                            {!hasBars && <p className="mb-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">No boarding or alighting activity was recorded; available load observations are shown.</p>}
                            {selected.hasEstimatedLoad && !selected.hasBlockInferredLoad && (
                                <p className="mb-2 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                    <strong>Estimated weighting:</strong> historical load averages do not include observation counts; legacy zeroes are omitted because missing APC and true zero cannot be distinguished.
                                </p>
                            )}
                            {selected.hasBlockInferredLoad && (
                                <p className="mb-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                                    <strong>Heatmap-estimated load:</strong> reliable APC load is used where available; missing values are estimated from heatmap boardings minus alightings across consecutive trips on the same route and block.{' '}
                                    {selected.blockInferenceUsesMinimumFeasibleAnchor && selected.blockInferenceAssumedEmptyAnchor
                                        ? 'Some blocks start from an assumed-empty first trip. Where a zero start would produce a negative load, the calculation instead uses the smallest starting load that keeps the full block non-negative; those values are lower-bound estimates.'
                                        : selected.blockInferenceUsesMinimumFeasibleAnchor
                                            ? 'Where a zero start would produce a negative load, the calculation uses the smallest starting load that keeps the full block non-negative. This is a lower-bound estimate.'
                                            : 'The first observed trip in each block is assumed empty.'}{' '}
                                    These values are estimates rather than verified APC loads.
                                </p>
                            )}
                            {selected.invalidBlockInferenceChainCount > 0 && (
                                <p className="mb-2 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                                    <strong>Inference unavailable:</strong> {selected.invalidBlockInferenceChainCount.toLocaleString()} block {selected.invalidBlockInferenceChainCount === 1 ? 'chain was' : 'chains were'} omitted because the passenger changes produced a load outside the plausible range.
                                </p>
                            )}
                            <div
                                className="overflow-x-auto pb-2 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-cyan-300"
                                data-testid="passenger-flow-scroll-region"
                                role="region"
                                aria-label="Passenger flow chart by stop. Scroll horizontally to review every stop."
                                tabIndex={0}
                            >
                                <div style={{ width: chartWidth, minWidth: '100%' }}>
                                    <ResponsiveContainer width="100%" height={360}>
                                        <ComposedChart data={rows} margin={{ top: 12, right: 22, bottom: 15, left: 0 }} barGap={2}>
                                            <CartesianGrid stroke="#eef2f7" strokeDasharray="3 3" vertical={false} />
                                            <XAxis dataKey="stopNumber" tickFormatter={value => `#${value}`} tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} label={{ value: 'Stop sequence', position: 'insideBottom', offset: -10, fontSize: 10, fill: '#9ca3af' }} />
                                            {hasBars && <YAxis yAxisId="activity" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} label={{ value: activityUnit, angle: -90, position: 'insideLeft', fontSize: 10, fill: '#9ca3af' }} />}
                                            {hasLoad && <YAxis yAxisId="load" orientation="right" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} label={{ value: 'Average onboard', angle: 90, position: 'insideRight', fontSize: 10, fill: '#64748b' }} />}
                                            <Tooltip content={<FlowTooltip />} />
                                            <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 11, color: '#4b5563' }} />
                                            {hasBoardings && <Bar yAxisId="activity" dataKey="boardings" name="Boardings" fill="#06b6d4" radius={[3, 3, 0, 0]} maxBarSize={22} />}
                                            {hasAlightings && <Bar yAxisId="activity" dataKey="alightings" name="Alightings" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={22} />}
                                            {hasLoad && <Line yAxisId="load" type="linear" dataKey="averageLoad" name={selected.hasBlockInferredLoad ? 'Average onboard (APC + heatmap estimates)' : selected.hasEstimatedLoad ? 'Average onboard (contains estimates)' : 'Average onboard'} stroke="#164e63" strokeWidth={2.5} dot={<LoadPointDot />} activeDot={{ r: 4 }} connectNulls={false} />}
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                            <ol className="mt-1 grid gap-x-4 gap-y-1 border-t border-gray-100 pt-3 text-[11px] text-gray-500 sm:grid-cols-2 lg:grid-cols-3" aria-label="Stop sequence key">
                                {rows.map(stop => <li key={stopRowKey(stop)} className="truncate"><span className="mr-1 font-semibold text-gray-700">{stop.stopNumber}.</span>{stop.stopName}<span className="sr-only">: {formatMetric(stop.boardings)} boardings, {formatMetric(stop.alightings)} alightings{stop.averageLoad === null ? ', average onboard unavailable' : `, ${formatMetric(stop.averageLoad)} ${loadSourceLabel(stop).toLowerCase()}`}.</span></li>)}
                            </ol>
                        </>
                    )}
                </>
            )}
        </ChartCard>
    );
};
