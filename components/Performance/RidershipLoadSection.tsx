import React, { useMemo, useState } from 'react';
import {
    Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ChartCard } from '../Analytics/AnalyticsShared';
import {
    FULL_LOAD,
    MAX_TRIP_IMBALANCE_RATIO,
    MIN_LOAD_SAMPLES,
    type RouteLoadAnalysis,
    type RouteLoadStop,
    type RouteLoadView,
} from '../../utils/performanceRouteLoad';
import { RidershipLoadDiagnostics } from './RidershipLoadDiagnostics';

interface RidershipLoadSectionProps {
    analysis: RouteLoadAnalysis;
}

const BOARDINGS_COLOR = '#06b6d4';
const ALIGHTINGS_COLOR = '#8b5cf6';
const LOAD_COLOR = '#164e63';
const MAX_LOAD_COLOR = '#94a3b8';

interface ChartRow extends RouteLoadStop {
    chartLoad: number | null;
    chartMaxLoad: number | null;
}

function formatValue(value: number | null, digits = 1): string {
    return value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function blockedMessage(view: RouteLoadView): string | null {
    if (view.inferenceBlocked === 'loop') {
        return 'Load is not inferred for loop routes: riders stay on through the terminal, so trips do not start empty. Boardings and alightings are still shown.';
    }
    if (view.inferenceBlocked === 'interlined') {
        return 'Load is not inferred for interlined routes: most trips continue as another route, so riders stay on and trips do not start empty. Boardings and alightings are still shown.';
    }
    return null;
}

function stopNote(stop: RouteLoadStop): string | null {
    if (stop.avgLoad === null) return 'No usable trip counts';
    if (stop.partialPattern) return 'Served by few trips (partial pattern)';
    if (stop.lowSample) return `Too few trips (fewer than ${MIN_LOAD_SAMPLES})`;
    return null;
}

function LoadTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }) {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;
    const note = stopNote(row);
    return (
        <div className="min-w-[220px] rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg">
            <p className="mb-2 font-semibold text-gray-900">{row.stopNumber}. {row.stopName}</p>
            <div className="space-y-1 text-gray-600">
                <p className="flex justify-between gap-6"><span>Avg onboard</span><strong className="text-gray-900">{formatValue(row.avgLoad)}</strong></p>
                <p className="flex justify-between gap-6"><span>Highest trip</span><span className="text-gray-900">{formatValue(row.maxLoad, 0)}</span></p>
                <p className="flex justify-between gap-6"><span>Boardings / trip</span><span className="text-gray-900">{formatValue(row.avgBoardings)}</span></p>
                <p className="flex justify-between gap-6"><span>Alightings / trip</span><span className="text-gray-900">{formatValue(row.avgAlightings)}</span></p>
                <p className="flex justify-between gap-6 text-gray-400"><span>Trips</span><span>{row.loadSamples.toLocaleString()}</span></p>
            </div>
            {note && <p className="mt-2 text-amber-700">{note}</p>}
        </div>
    );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <div className="min-w-0 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
            <p className="truncate text-base font-bold text-gray-900" title={value}>{value}</p>
            <p className="truncate text-xs text-gray-500" title={detail}>{detail}</p>
        </div>
    );
}

export const RidershipLoadSection: React.FC<RidershipLoadSectionProps> = ({ analysis }) => {
    const { views, vehicles } = analysis;
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const selected = views.find(view => view.key === selectedKey) ?? views[0] ?? null;

    const rows = useMemo((): ChartRow[] => (selected?.stops ?? []).map(stop => {
        const usable = stop.avgLoad !== null && !stop.lowSample && !stop.partialPattern;
        return {
            ...stop,
            chartLoad: usable ? stop.avgLoad : null,
            chartMaxLoad: usable ? stop.maxLoad : null,
        };
    }), [selected]);

    const hasLoad = rows.some(row => row.chartLoad !== null);
    const blocked = selected ? blockedMessage(selected) : null;
    const gapCount = rows.filter(row => row.chartLoad === null).length;
    const chartWidth = Math.max(640, rows.length * 44);

    return (
        <ChartCard
            title="Load Along the Route"
            subtitle="Average passengers per trip at each stop, inferred from boardings and alightings"
            headerExtra={views.length > 0 && selected ? (
                <label className="flex items-center gap-2 text-xs text-gray-500">
                    <span className="font-semibold uppercase tracking-wide">Route</span>
                    <select
                        aria-label="Route and direction"
                        value={selected.key}
                        onChange={event => setSelectedKey(event.target.value)}
                        className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800"
                    >
                        {views.map(view => (
                            <option key={view.key} value={view.key}>
                                {view.routeId} {view.direction} — {view.routeName}
                            </option>
                        ))}
                    </select>
                </label>
            ) : undefined}
        >
            {!selected ? (
                <p className="rounded-md bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">No route load profiles for this period.</p>
            ) : (
                <div data-testid="ridership-load-section">
                    <div className="mb-4 grid grid-cols-2 divide-x divide-gray-100 border-y border-gray-100 md:grid-cols-4">
                        <Kpi
                            label="Peak avg onboard"
                            value={formatValue(selected.peakStop?.avgLoad ?? null)}
                            detail={selected.peakStop ? selected.peakStop.stopName : 'No usable trip counts'}
                        />
                        <Kpi
                            label="Highest trip load"
                            value={formatValue(selected.maxTripLoad, 0)}
                            detail="Busiest single trip, any stop"
                        />
                        <Kpi
                            label={`Trips reaching ${FULL_LOAD}`}
                            value={selected.inferenceBlocked ? '—' : selected.fullTripCount.toLocaleString()}
                            detail={selected.inferenceBlocked ? 'Not inferred' : `of ${selected.usableTripCount.toLocaleString()} trips with a load`}
                        />
                        <Kpi
                            label="Trips used"
                            value={selected.usableShare === null ? '—' : `${Math.round(selected.usableShare * 100)}%`}
                            detail={`${selected.usableTripCount.toLocaleString()} of ${selected.tripCount.toLocaleString()} trips · ${selected.serviceDays} day${selected.serviceDays === 1 ? '' : 's'}`}
                        />
                    </div>

                    {blocked && (
                        <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">{blocked}</p>
                    )}
                    {!blocked && !hasLoad && (
                        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            No trips on this route had consistent enough boarding and alighting counts to infer a load in the selected period.
                        </p>
                    )}
                    {hasLoad && gapCount > 0 && (
                        <p className="mb-3 text-xs text-gray-500">
                            {gapCount} stop{gapCount === 1 ? '' : 's'} shown as a gap: served by too few trips.
                        </p>
                    )}

                    <div className="overflow-x-auto">
                        <div style={{ width: chartWidth, minWidth: '100%' }}>
                            <ResponsiveContainer width="100%" height={300}>
                                <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }} barGap={2}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                    <XAxis dataKey="stopNumber" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} interval={0} />
                                    <YAxis
                                        tick={{ fontSize: 10, fill: '#9CA3AF' }}
                                        tickLine={false}
                                        axisLine={false}
                                        label={{ value: 'Passengers per trip', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#9CA3AF' }}
                                    />
                                    <Tooltip content={<LoadTooltip />} />
                                    {!selected.inferenceBlocked && (
                                        <ReferenceLine y={FULL_LOAD} stroke="#b45309" strokeDasharray="6 4" ifOverflow="extendDomain" label={{ value: `Full (${FULL_LOAD})`, position: 'insideTopRight', fontSize: 10, fill: '#b45309' }} />
                                    )}
                                    <Legend wrapperStyle={{ fontSize: 11 }} />
                                    <Bar dataKey="avgBoardings" name="Boardings / trip" fill={BOARDINGS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={14} />
                                    <Bar dataKey="avgAlightings" name="Alightings / trip" fill={ALIGHTINGS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={14} />
                                    <Line dataKey="chartMaxLoad" name="Highest trip" stroke={MAX_LOAD_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls={false} />
                                    <Line dataKey="chartLoad" name="Avg onboard (inferred)" stroke={LOAD_COLOR} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <p className="mt-2 text-xs text-gray-400">
                        Each trip's load is rebuilt stop by stop as boardings minus alightings, starting empty. Alightings are scaled so each trip balances, and trips whose totals differ by more than {Math.round((MAX_TRIP_IMBALANCE_RATIO - 1) * 100)}% are left out.
                    </p>

                    {selected.busiestTrips.length > 0 && (
                        <div className="mt-4">
                            <h4 className="mb-1 text-xs font-semibold text-gray-700">Busiest trips</h4>
                            <p className="mb-2 text-xs text-gray-400">Scheduled trips ranked by their average peak load. Directional: use it to see which trips are busy, not exact counts.</p>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs" data-testid="ridership-busiest-trips">
                                    <thead>
                                        <tr className="border-b border-gray-100 text-left uppercase text-gray-400">
                                            <th className="py-1.5 pr-2">Departs</th>
                                            <th className="py-1.5 pr-2">Block</th>
                                            <th className="py-1.5 pr-2">Usually peaks at</th>
                                            <th className="py-1.5 pr-2 text-right">Avg peak</th>
                                            <th className="py-1.5 pr-2 text-right">Highest</th>
                                            <th className="py-1.5 pr-2 text-right">Days at {FULL_LOAD}+</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selected.busiestTrips.map(trip => (
                                            <tr key={trip.departure} className="border-b border-gray-50 text-gray-700">
                                                <td className="py-1 pr-2 tabular-nums">{trip.departure}</td>
                                                <td className="py-1 pr-2">{trip.block}</td>
                                                <td className="py-1 pr-2">{trip.peakStopName}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums font-semibold">{formatValue(trip.avgPeakLoad)}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{formatValue(trip.maxPeakLoad, 0)}</td>
                                                <td className={`py-1 pr-2 text-right tabular-nums ${trip.fullDays > 0 ? 'font-semibold text-amber-700' : ''}`}>{trip.fullDays} of {trip.days}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    <details className="mt-3 text-xs">
                        <summary className="cursor-pointer font-semibold text-gray-600">Stop table</summary>
                        <div className="mt-2 overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-gray-100 text-left uppercase text-gray-400">
                                        <th className="py-1.5 pr-2">#</th>
                                        <th className="py-1.5 pr-2">Stop</th>
                                        <th className="py-1.5 pr-2 text-right">Boardings / trip</th>
                                        <th className="py-1.5 pr-2 text-right">Alightings / trip</th>
                                        <th className="py-1.5 pr-2 text-right">Avg onboard</th>
                                        <th className="py-1.5 pr-2 text-right">Highest trip</th>
                                        <th className="py-1.5 pr-2 text-right">Trips</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(row => {
                                        const note = stopNote(row);
                                        return (
                                            <tr key={row.key} className={`border-b border-gray-50 ${note ? 'text-gray-400' : 'text-gray-700'}`}>
                                                <td className="py-1 pr-2 tabular-nums">{row.stopNumber}</td>
                                                <td className="py-1 pr-2" title={note ?? undefined}>{row.stopName}{row.isTimepoint ? ' ⏱' : ''}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{formatValue(row.avgBoardings)}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{formatValue(row.avgAlightings)}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{formatValue(row.avgLoad)}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{formatValue(row.maxLoad, 0)}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{row.loadSamples.toLocaleString()}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </details>

                    <RidershipLoadDiagnostics selected={selected} views={views} vehicles={vehicles} />
                </div>
            )}
        </ChartCard>
    );
};
