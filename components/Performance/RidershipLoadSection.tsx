import React, { useMemo, useState } from 'react';
import {
    Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ChartCard } from '../Analytics/AnalyticsShared';
import {
    FULL_LOAD,
    LOAD_TIME_PERIODS,
    MAX_TRIP_IMBALANCE_RATIO,
    MIN_LOAD_SAMPLES,
    type BusyTrip,
    type LoadTimePeriod,
    type RouteLoadAnalysis,
    type RouteLoadStop,
    type RouteLoadView,
} from '../../utils/performanceRouteLoad';
import { RidershipLoadDiagnostics } from './RidershipLoadDiagnostics';

interface RidershipLoadSectionProps {
    /** Builds the load analysis for a time-of-day period; memoised by the caller per period set. */
    analysisForPeriod: (period: LoadTimePeriod) => RouteLoadAnalysis;
}

const BOARDINGS_COLOR = '#06b6d4';
const ALIGHTINGS_COLOR = '#8b5cf6';
const LOAD_COLOR = '#164e63';
const BAND_COLOR = '#cbd5e1';
const TRIP_COLOR = '#c2410c';
const FULL_LOAD_COLOR = '#b45309';
/** Draw the full-load line only once the busiest trip gets this close to it; otherwise it squashes quiet routes. */
const FULL_LOAD_REFERENCE_FROM = 35;
/** Both panels share this y-axis width so their stops line up vertically. */
const Y_AXIS_WIDTH = 44;
const CHART_MARGIN = { top: 8, right: 28, bottom: 4, left: 0 };
const SYNC_ID = 'ridership-load-along-route';
const STOP_LABEL_LINE_LENGTH = 16;
/** Timepoints closer together than this many stops share the axis; only the first gets a name so labels don't collide. */
const MIN_STOPS_BETWEEN_LABELS = 2;
const LEGEND_STYLE = { fontSize: 11, paddingBottom: 4 };
const NETWORK_SUMMARY_LIMIT = 6;

interface ChartRow extends RouteLoadStop {
    chartLoad: number | null;
    /** Middle 80% of trips, as a [p10, p90] range for the shaded band. */
    chartBand: [number, number] | null;
    chartTripLoad: number | null;
    /** Boardings and alightings shown in the lower panel: the selected trip's when one is chosen, else the route average. */
    chartBoardings: number;
    /** Alightings drawn below the zero line. */
    chartAlightings: number;
}

function formatValue(value: number | null, digits = 1): string {
    return value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function absoluteTick(value: number): string {
    return Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/** Splits a name over two lines at a word boundary; the second line is shortened only if still too long. */
function wrapLabel(text: string, lineLength: number): [string, string | null] {
    if (text.length <= lineLength) return [text, null];
    const words = text.split(' ');
    let first = '';
    let i = 0;
    while (i < words.length - 1 && `${first} ${words[i]}`.trim().length <= lineLength) first = `${first} ${words[i++]}`.trim();
    if (!first) first = words[i++];
    const rest = words.slice(i).join(' ');
    return [first, rest.length > lineLength + 4 ? `${rest.slice(0, lineLength + 3)}…` : rest];
}

/** Legend text stays in neutral ink; the swatch beside it carries the series colour. */
function legendText(value: string) {
    return <span style={{ color: '#4b5563' }}>{value}</span>;
}

/** Timepoints that get a name on the axis, skipping any that sit right next to the previous named one. */
function labelledStopNumbers(rows: RouteLoadStop[]): Set<number> {
    const labelled = new Set<number>();
    let lastLabelled = -Infinity;
    for (const row of rows) {
        if (!row.isTimepoint || row.stopNumber - lastLabelled < MIN_STOPS_BETWEEN_LABELS) continue;
        labelled.add(row.stopNumber);
        lastLabelled = row.stopNumber;
    }
    return labelled;
}

function stopNote(stop: RouteLoadStop): string | null {
    if (stop.avgLoad === null) return 'No usable trip counts';
    if (stop.partialPattern) return 'Served by few trips (partial pattern)';
    if (stop.lowSample) return `Too few trips (fewer than ${MIN_LOAD_SAMPLES})`;
    return null;
}

function LoadTooltip({ active, payload, selectedTrip }: {
    active?: boolean;
    payload?: Array<{ payload: ChartRow }>;
    selectedTrip?: BusyTrip | null;
}) {
    const row = payload?.[0]?.payload;
    if (!active || !row) return null;
    const note = stopNote(row);
    return (
        <div className="min-w-[230px] rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-lg">
            <p className="mb-2 font-semibold text-gray-900">{row.stopNumber}. {row.stopName}{row.isTimepoint ? ' (timepoint)' : ''}</p>
            <div className="space-y-1 text-gray-600">
                <p className="flex justify-between gap-6"><span>Avg onboard</span><strong className="text-gray-900">{formatValue(row.avgLoad)}</strong></p>
                <p className="flex justify-between gap-6"><span>Typical range (middle 80%)</span><span className="text-gray-900">{row.p10Load === null ? '—' : `${formatValue(row.p10Load, 0)}–${formatValue(row.p90Load, 0)}`}</span></p>
                {selectedTrip && (
                    <>
                        <p className="flex justify-between gap-6"><span>{selectedTrip.departure} trip onboard</span><span className="font-semibold" style={{ color: TRIP_COLOR }}>{formatValue(row.chartTripLoad)}</span></p>
                        <p className="flex justify-between gap-6"><span>{selectedTrip.departure} trip on / off</span><span className="text-gray-900">{formatValue(row.chartBoardings)} / {formatValue(-row.chartAlightings)}</span></p>
                    </>
                )}
                <p className="flex justify-between gap-6"><span>Boardings / trip</span><span className="text-gray-900">{formatValue(row.avgBoardings)}</span></p>
                <p className="flex justify-between gap-6"><span>Alightings / trip</span><span className="text-gray-900">{formatValue(row.avgAlightings)}</span></p>
                <p className="flex justify-between gap-6 text-gray-400"><span>Trips</span><span>{row.loadSamples.toLocaleString()}</span></p>
            </div>
            {note && <p className="mt-2 text-amber-700">{note}</p>}
        </div>
    );
}

/** X-axis tick: timepoints get an angled stop name, other stops just their number. */
function StopTick({ x, y, payload, rows, labelled }: { x?: number; y?: number; payload?: { value: number }; rows: ChartRow[]; labelled: Set<number> }) {
    const row = rows.find(r => r.stopNumber === payload?.value);
    if (x === undefined || y === undefined || !row) return null;
    if (!labelled.has(row.stopNumber)) {
        return (
            <text x={x} y={y + 10} textAnchor="middle" fontSize={9} fontWeight={row.isTimepoint ? 700 : 400} fill={row.isTimepoint ? '#374151' : '#9CA3AF'}>
                {row.stopNumber}
            </text>
        );
    }
    const [first, second] = wrapLabel(row.stopName, STOP_LABEL_LINE_LENGTH);
    return (
        <text x={x} y={y + 10} textAnchor="middle" fontSize={10} fontWeight={600} fill="#374151">
            <tspan x={x}>{first}</tspan>
            {second && <tspan x={x} dy={12}>{second}</tspan>}
        </text>
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

function Chip({ tone, children, title }: { tone: 'neutral' | 'warning'; children: React.ReactNode; title?: string }) {
    const toneClass = tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600';
    return <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${toneClass}`}>{children}</span>;
}

function SegmentButton({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
    return (
        <button
            type="button"
            aria-pressed={active}
            aria-label={label}
            onClick={onClick}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
        >
            {children}
        </button>
    );
}

function rankForNetwork(views: RouteLoadView[]): RouteLoadView[] {
    return [...views]
        .filter(view => view.maxTripLoad !== null)
        .sort((a, b) => b.fullTripCount - a.fullTripCount
            || (b.maxTripLoad ?? 0) - (a.maxTripLoad ?? 0)
            || (b.peakStop?.avgLoad ?? 0) - (a.peakStop?.avgLoad ?? 0))
        .slice(0, NETWORK_SUMMARY_LIMIT);
}

export const RidershipLoadSection: React.FC<RidershipLoadSectionProps> = ({ analysisForPeriod }) => {
    const [period, setPeriod] = useState<LoadTimePeriod>('all');
    const { views, vehicles } = useMemo(() => analysisForPeriod(period), [analysisForPeriod, period]);
    const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
    const [selectedDirection, setSelectedDirection] = useState<string | null>(null);
    const [selectedTripDeparture, setSelectedTripDeparture] = useState<string | null>(null);

    const routeIds = useMemo(() => [...new Set(views.map(view => view.routeId))], [views]);
    const networkRanking = useMemo(() => rankForNetwork(views), [views]);
    const defaultView = networkRanking[0] ?? views[0] ?? null;
    const routeId = selectedRouteId && routeIds.includes(selectedRouteId) ? selectedRouteId : defaultView?.routeId ?? null;
    const routeViews = views.filter(view => view.routeId === routeId);
    const preferredDirection = selectedRouteId ? selectedDirection : defaultView?.direction ?? null;
    const selected = routeViews.find(view => view.direction === preferredDirection) ?? routeViews[0] ?? null;
    const selectedTrip = selected?.busiestTrips.find(trip => trip.departure === selectedTripDeparture) ?? null;

    const selectView = (view: RouteLoadView) => {
        setSelectedRouteId(view.routeId);
        setSelectedDirection(view.direction);
        setSelectedTripDeparture(null);
    };

    const rows = useMemo((): ChartRow[] => (selected?.stops ?? []).map(stop => {
        const usable = stop.avgLoad !== null && !stop.lowSample && !stop.partialPattern;
        const tripLoad = selectedTrip?.stopLoads[stop.key];
        return {
            ...stop,
            chartLoad: usable ? stop.avgLoad : null,
            chartBand: usable && stop.p10Load !== null && stop.p90Load !== null ? [stop.p10Load, stop.p90Load] : null,
            chartTripLoad: tripLoad ?? null,
            chartBoardings: selectedTrip ? selectedTrip.stopBoardings[stop.key] ?? 0 : stop.avgBoardings,
            chartAlightings: -(selectedTrip ? selectedTrip.stopAlightings[stop.key] ?? 0 : stop.avgAlightings),
        };
    }), [selected, selectedTrip]);

    const hasLoad = rows.some(row => row.chartLoad !== null);
    const gapCount = rows.filter(row => row.chartLoad === null).length;
    const labelled = useMemo(() => labelledStopNumbers(rows), [rows]);
    const hasTimepointLabels = labelled.size > 0;
    const chartWidth = Math.max(640, rows.length * 44);
    const showFullLoad = (selected?.maxTripLoad ?? 0) >= FULL_LOAD_REFERENCE_FROM;
    const periodLabel = LOAD_TIME_PERIODS.find(p => p.id === period)!.label;

    const periodPicker = (
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Time of day">
            {LOAD_TIME_PERIODS.map(option => (
                <SegmentButton key={option.id} active={period === option.id} onClick={() => { setPeriod(option.id); setSelectedTripDeparture(null); }}>
                    {option.label}{option.range && <span className="ml-1 font-normal text-gray-400">{option.range}</span>}
                </SegmentButton>
            ))}
        </div>
    );

    return (
        <ChartCard
            title="Load Along the Route"
            subtitle="Average passengers per trip at each stop, inferred from boardings and alightings"
            headerExtra={routeId && selected ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                    <label className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="font-semibold uppercase tracking-wide">Route</span>
                        <select
                            aria-label="Route"
                            value={routeId}
                            onChange={event => { setSelectedRouteId(event.target.value); setSelectedDirection(null); setSelectedTripDeparture(null); }}
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm text-gray-800"
                        >
                            {routeIds.map(id => (
                                <option key={id} value={id}>{id} — {views.find(view => view.routeId === id)?.routeName}</option>
                            ))}
                        </select>
                    </label>
                    {routeViews.length > 1 && (
                        <div className="inline-flex rounded-lg bg-gray-100 p-0.5" role="group" aria-label="Direction">
                            {routeViews.map(view => (
                                <SegmentButton key={view.key} active={view.key === selected.key} onClick={() => selectView(view)} label={`Direction ${view.direction}`}>
                                    {view.direction}
                                </SegmentButton>
                            ))}
                        </div>
                    )}
                </div>
            ) : undefined}
        >
            <div className="mb-3">{periodPicker}</div>
            {!selected ? (
                <p className="rounded-md bg-gray-50 px-3 py-6 text-center text-sm text-gray-500">
                    {period === 'all' ? 'No route load profiles for this period.' : `No trips in the ${periodLabel.toLowerCase()} for this period.`}
                </p>
            ) : (
                <div data-testid="ridership-load-section">
                    {networkRanking.length > 1 && (
                        <div className="mb-4" data-testid="ridership-load-network">
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Busiest routes · {periodLabel}</p>
                            <div className="flex flex-wrap gap-2">
                                {networkRanking.map(view => (
                                    <button
                                        key={view.key}
                                        type="button"
                                        onClick={() => selectView(view)}
                                        aria-pressed={view.key === selected.key}
                                        className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${view.key === selected.key ? 'border-cyan-300 bg-cyan-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                                    >
                                        <span className="font-semibold text-gray-800">{view.routeId} {view.direction}</span>
                                        <span className="ml-2 text-gray-500">peak trip {formatValue(view.maxTripLoad, 0)}</span>
                                        {view.fullTripCount > 0 && <span className="ml-2 font-semibold text-amber-700">{view.fullTripCount} at {FULL_LOAD}+</span>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="mb-3 grid grid-cols-2 divide-x divide-gray-100 border-y border-gray-100 md:grid-cols-4">
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
                            value={selected.fullTripCount.toLocaleString()}
                            detail={`of ${selected.usableTripCount.toLocaleString()} trips with a load`}
                        />
                        <Kpi
                            label="Trips used"
                            value={selected.usableShare === null ? '—' : `${Math.round(selected.usableShare * 100)}%`}
                            detail={`${selected.usableTripCount.toLocaleString()} of ${selected.tripCount.toLocaleString()} trips · ${selected.serviceDays} day${selected.serviceDays === 1 ? '' : 's'}`}
                        />
                    </div>

                    <div className="mb-3 flex flex-wrap gap-1.5" data-testid="ridership-load-notes">
                        {!hasLoad && (
                            <Chip tone="warning">No trips had consistent enough boarding and alighting counts to infer a load.</Chip>
                        )}
                        {selected.carriesLoad && (
                            <Chip tone="neutral" title="Riders still onboard at the end of a trip are carried into the bus's next trip on the same block, so trips do not always start empty.">
                                Loop route: trips may start with riders aboard
                            </Chip>
                        )}
                        {hasLoad && gapCount > 0 && (
                            <Chip tone="neutral" title="These stops are served by too few trips to give a reliable average, so the load line has a gap there.">
                                {gapCount} stop{gapCount === 1 ? '' : 's'} with too few trips
                            </Chip>
                        )}
                        {!showFullLoad && selected.maxTripLoad !== null && (
                            <Chip tone="neutral">
                                Well below full: busiest trip peaked at {formatValue(selected.maxTripLoad, 0)} (full is {FULL_LOAD})
                            </Chip>
                        )}
                        {selectedTrip && (
                            <Chip tone="neutral">
                                Showing the {selectedTrip.departure} trip
                                <button type="button" onClick={() => setSelectedTripDeparture(null)} className="ml-1.5 font-semibold text-slate-500 hover:text-slate-800" aria-label="Clear selected trip">×</button>
                            </Chip>
                        )}
                    </div>

                    <div className="overflow-x-auto">
                        <div style={{ width: chartWidth, minWidth: '100%' }}>
                            <p className="mb-1 text-[11px] font-semibold text-gray-600">Onboard (riders per trip)</p>
                            <ResponsiveContainer width="100%" height={360}>
                                <ComposedChart data={rows} margin={CHART_MARGIN} syncId={SYNC_ID}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                    <XAxis dataKey="stopNumber" scale="band" tick={false} tickLine={false} height={4} interval={0} />
                                    <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                                    <Tooltip content={<LoadTooltip selectedTrip={selectedTrip} />} />
                                    {showFullLoad && (
                                        <ReferenceLine y={FULL_LOAD} stroke={FULL_LOAD_COLOR} strokeDasharray="6 4" ifOverflow="extendDomain" label={{ value: `Full (${FULL_LOAD})`, position: 'insideTopRight', fontSize: 10, fill: FULL_LOAD_COLOR }} />
                                    )}
                                    <Legend verticalAlign="top" align="right" wrapperStyle={LEGEND_STYLE} formatter={legendText} />
                                    <Area dataKey="chartBand" name="Typical range (middle 80% of trips)" legendType="square" stroke={BAND_COLOR} strokeWidth={0} fill={BAND_COLOR} fillOpacity={0.6} connectNulls={false} isAnimationActive={false} />
                                    <Line dataKey="chartLoad" name="Avg onboard (inferred)" stroke={LOAD_COLOR} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
                                    {selectedTrip && (
                                        <Line dataKey="chartTripLoad" name={`${selectedTrip.departure} trip`} stroke={TRIP_COLOR} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
                                    )}
                                </ComposedChart>
                            </ResponsiveContainer>

                            <p className="mb-1 mt-3 text-[11px] font-semibold text-gray-600">
                                {selectedTrip
                                    ? <>Boardings and alightings on the <span style={{ color: TRIP_COLOR }}>{selectedTrip.departure} trip</span> (average of {selectedTrip.days} day{selectedTrip.days === 1 ? '' : 's'})</>
                                    : 'Boardings and alightings (per trip)'}
                            </p>
                            <ResponsiveContainer width="100%" height={hasTimepointLabels ? 252 : 240}>
                                <ComposedChart data={rows} margin={CHART_MARGIN} syncId={SYNC_ID} stackOffset="sign">
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                    <XAxis
                                        dataKey="stopNumber"
                                        tick={<StopTick rows={rows} labelled={labelled} />}
                                        tickLine={false}
                                        interval={0}
                                        height={hasTimepointLabels ? 48 : 24}
                                    />
                                    <YAxis width={Y_AXIS_WIDTH} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} tickFormatter={absoluteTick} />
                                    <Tooltip content={() => null} />
                                    <ReferenceLine y={0} stroke="#cbd5e1" />
                                    <Legend verticalAlign="top" align="right" wrapperStyle={LEGEND_STYLE} formatter={legendText} />
                                    <Bar dataKey="chartBoardings" name="Boardings (up)" stackId="movement" fill={BOARDINGS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={14} />
                                    <Bar dataKey="chartAlightings" name="Alightings (down)" stackId="movement" fill={ALIGHTINGS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={14} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <p className="mt-2 text-xs text-gray-400">
                        Named and bold-numbered stops are timepoints; other stops show their number (hover for names). Each trip's load is rebuilt stop by stop as boardings minus alightings, starting empty (loop routes may start with riders already aboard, inferred from alightings the trip's own boardings can't explain). Alightings are scaled so the counts balance, and trips whose totals differ by more than {Math.round((MAX_TRIP_IMBALANCE_RATIO - 1) * 100)}% are left out.
                    </p>

                    {selected.busiestTrips.length > 0 && (
                        <div className="mt-4">
                            <h4 className="mb-1 text-xs font-semibold text-gray-700">Busiest trips · {periodLabel}</h4>
                            <p className="mb-2 text-xs text-gray-400">Scheduled trips ranked by their average peak load. Click a trip to draw its load on the chart. Directional: use it to see which trips are busy, not exact counts.</p>
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
                                        {selected.busiestTrips.map(trip => {
                                            const isSelected = trip.departure === selectedTripDeparture;
                                            return (
                                                <tr
                                                    key={trip.departure}
                                                    onClick={() => setSelectedTripDeparture(isSelected ? null : trip.departure)}
                                                    aria-selected={isSelected}
                                                    className={`cursor-pointer border-b border-gray-50 text-gray-700 ${isSelected ? 'bg-orange-50' : 'hover:bg-gray-50'}`}
                                                >
                                                    <td className="py-1 pr-2 tabular-nums">
                                                        <button type="button" className="font-semibold text-gray-800 underline-offset-2 hover:underline" aria-label={`Show the ${trip.departure} trip on the chart`}>
                                                            {trip.departure}
                                                        </button>
                                                    </td>
                                                    <td className="py-1 pr-2">{trip.block}</td>
                                                    <td className="py-1 pr-2">{trip.peakStopName}</td>
                                                    <td className="py-1 pr-2 text-right tabular-nums font-semibold">{formatValue(trip.avgPeakLoad)}</td>
                                                    <td className="py-1 pr-2 text-right tabular-nums">{formatValue(trip.maxPeakLoad, 0)}</td>
                                                    <td className={`py-1 pr-2 text-right tabular-nums ${trip.fullDays > 0 ? 'font-semibold text-amber-700' : ''}`}>{trip.fullDays} of {trip.days}</td>
                                                </tr>
                                            );
                                        })}
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
                                        <th className="py-1.5 pr-2 text-right">Typical range</th>
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
                                                <td className={`py-1 pr-2 ${row.isTimepoint ? 'font-semibold' : ''}`} title={note ?? undefined}>{row.stopName}{row.isTimepoint ? ' ⏱' : ''}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{formatValue(row.avgBoardings)}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{formatValue(row.avgAlightings)}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{formatValue(row.avgLoad)}</td>
                                                <td className="py-1 pr-2 text-right tabular-nums">{row.p10Load === null ? '—' : `${formatValue(row.p10Load, 0)}–${formatValue(row.p90Load, 0)}`}</td>
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
