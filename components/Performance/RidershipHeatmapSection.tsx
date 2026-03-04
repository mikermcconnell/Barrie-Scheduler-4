import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
    PerformanceDataSummary, DayType, RouteRidershipHeatmap,
} from '../../utils/performanceDataTypes';
import { getRouteColor, getRouteTextColor } from '../../utils/config/routeColors';

// ─── Color helpers ───────────────────────────────────────────────────

/** Sqrt-scaled color interpolation for better low-value visibility. */
function interpolateColor(value: number, max: number, channel: 'green' | 'purple'): string {
    if (value === 0 || max === 0) return '#ffffff';
    const ratio = Math.sqrt(Math.min(value / max, 1)); // sqrt for better spread
    if (channel === 'green') {
        // white → #22c55e (green-500)
        const r = Math.round(255 - ratio * 221);
        const g = Math.round(255 - ratio * 58);
        const b = Math.round(255 - ratio * 161);
        return `rgb(${r}, ${g}, ${b})`;
    }
    // white → #a78bfa (violet-400)
    const r = Math.round(255 - ratio * 88);
    const g = Math.round(255 - ratio * 116);
    const b = Math.round(255 - ratio * 5);
    return `rgb(${r}, ${g}, ${b})`;
}

function textColor(value: number, max: number): string {
    if (max === 0) return '#6b7280';
    const ratio = Math.sqrt(Math.min(value / max, 1));
    return ratio > 0.55 ? '#ffffff' : '#374151';
}

function fmtVal(v: number): string {
    if (v === 0) return '';
    return v % 1 === 0 ? String(v) : v.toFixed(1);
}

// ─── Types ───────────────────────────────────────────────────────────

interface Props {
    data: PerformanceDataSummary;
}

type DateRange = 'yesterday' | 'week' | 'month';

const DAY_TYPE_LABELS: Record<DayType, string> = { weekday: 'Weekday', saturday: 'Saturday', sunday: 'Sunday' };

// ─── Multi-day merge ─────────────────────────────────────────────────

function mergeHeatmaps(heatmaps: RouteRidershipHeatmap[]): RouteRidershipHeatmap | null {
    if (heatmaps.length === 0) return null;
    if (heatmaps.length === 1) return heatmaps[0];

    const base = heatmaps[0];
    const tripMap = new Map<string, { trip: typeof base.trips[0]; idx: number }>();
    const allTrips = [...base.trips];
    base.trips.forEach((t, i) => tripMap.set(t.terminalDepartureTime, { trip: t, idx: i }));

    for (let d = 1; d < heatmaps.length; d++) {
        for (const t of heatmaps[d].trips) {
            if (!tripMap.has(t.terminalDepartureTime)) {
                tripMap.set(t.terminalDepartureTime, { trip: t, idx: allTrips.length });
                allTrips.push(t);
            }
        }
    }

    const timeToSec = (raw: string) => {
        const t = raw.trim();
        if (t.includes(':')) {
            const m = t.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
            if (!m) return Number.MAX_SAFE_INTEGER;
            const h = Number.parseInt(m[1], 10);
            const mins = Number.parseInt(m[2], 10);
            const sec = m[3] ? Number.parseInt(m[3], 10) : 0;
            if (!Number.isFinite(h) || !Number.isFinite(mins) || !Number.isFinite(sec)) return Number.MAX_SAFE_INTEGER;
            return (h * 3600) + (mins * 60) + sec;
        }

        const dec = Number.parseFloat(t);
        if (!Number.isFinite(dec) || dec < 0) return Number.MAX_SAFE_INTEGER;
        const wholeDays = Math.floor(dec);
        const dayFraction = dec - wholeDays;
        return wholeDays * 86400 + Math.round(dayFraction * 86400);
    };
    const sortedTrips = [...allTrips].sort((a, b) =>
        timeToSec(a.terminalDepartureTime) - timeToSec(b.terminalDepartureTime)
    );
    const newTripIdx = new Map<string, number>();
    sortedTrips.forEach((t, i) => newTripIdx.set(t.terminalDepartureTime, i));

    const stopMap = new Map<string, typeof base.stops[0]>();
    for (const hm of heatmaps) {
        for (const s of hm.stops) {
            const existing = stopMap.get(s.stopId);
            if (!existing) {
                stopMap.set(s.stopId, { ...s });
            } else {
                existing.isTimepoint = existing.isTimepoint || s.isTimepoint;
                if (s.routeStopIndex < existing.routeStopIndex) {
                    existing.routeStopIndex = s.routeStopIndex;
                }
            }
        }
    }
    const stops = Array.from(stopMap.values()).sort((a, b) =>
        a.routeStopIndex - b.routeStopIndex || a.stopName.localeCompare(b.stopName)
    );
    const stopIdx = new Map<string, number>();
    stops.forEach((s, i) => stopIdx.set(s.stopId, i));

    const acc: ([number, number, number] | null)[][] =
        stops.map(() => sortedTrips.map((): [number, number, number] | null => null));

    for (const hm of heatmaps) {
        for (let si = 0; si < hm.stops.length; si++) {
            const newSi = stopIdx.get(hm.stops[si].stopId);
            if (newSi === undefined) continue;
            for (let ti = 0; ti < hm.trips.length; ti++) {
                const cell = hm.cells[si]?.[ti];
                if (!cell) continue;
                const newTi = newTripIdx.get(hm.trips[ti].terminalDepartureTime);
                if (newTi === undefined) continue;
                const existing = acc[newSi][newTi];
                if (existing) {
                    existing[0] += cell[0];
                    existing[1] += cell[1];
                    existing[2]++;
                } else {
                    acc[newSi][newTi] = [cell[0], cell[1], 1];
                }
            }
        }
    }

    const cells: ([number, number] | null)[][] = acc.map(row =>
        row.map(c => c ? [Math.round(c[0] / c[2] * 10) / 10, Math.round(c[1] / c[2] * 10) / 10] : null)
    );

    return {
        routeId: base.routeId,
        routeName: base.routeName,
        direction: base.direction,
        trips: sortedTrips,
        stops,
        cells,
    };
}

// ─── Component ───────────────────────────────────────────────────────

export const RidershipHeatmapSection: React.FC<Props> = ({ data }) => {
    const [dateRange, setDateRange] = useState<DateRange>('week');
    const [dayTypeFilter, setDayTypeFilter] = useState<DayType | 'all'>('all');
    const [selectedKey, setSelectedKey] = useState<string>('');
    const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [hideEmptyStops, setHideEmptyStops] = useState(true);

    const toggleFullscreen = useCallback(() => setIsFullscreen(prev => !prev), []);

    useEffect(() => {
        if (!isFullscreen) return;
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsFullscreen(false);
        };
        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [isFullscreen]);

    const hasHeatmaps = useMemo(() =>
        data.dailySummaries.some(d => d.ridershipHeatmaps && d.ridershipHeatmaps.length > 0),
        [data]
    );

    const availableDayTypes = useMemo(() => {
        const types = new Set(data.dailySummaries.map(d => d.dayType));
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [data]);

    const filtered = useMemo(() => {
        const sorted = [...data.dailySummaries].sort((a, b) => b.date.localeCompare(a.date));
        if (sorted.length === 0) return [];
        const latest = sorted[0].date;
        const latestDate = new Date(latest + 'T12:00:00');

        let cutoff: Date;
        if (dateRange === 'yesterday') {
            cutoff = latestDate;
        } else if (dateRange === 'week') {
            cutoff = new Date(latestDate);
            cutoff.setDate(cutoff.getDate() - 6);
        } else {
            cutoff = new Date(latestDate);
            cutoff.setDate(cutoff.getDate() - 29);
        }

        const cutoffStr = cutoff.toISOString().slice(0, 10);
        return sorted.filter(d => {
            if (d.date < cutoffStr) return false;
            if (dayTypeFilter !== 'all' && d.dayType !== dayTypeFilter) return false;
            return true;
        });
    }, [data, dateRange, dayTypeFilter]);

    const profileOptions = useMemo(() => {
        const seen = new Map<string, { routeId: string; routeName: string; direction: string }>();
        for (const day of filtered) {
            for (const hm of day.ridershipHeatmaps || []) {
                const key = `${hm.routeId}__${hm.direction}`;
                if (!seen.has(key)) {
                    seen.set(key, { routeId: hm.routeId, routeName: hm.routeName, direction: hm.direction });
                }
            }
        }
        return Array.from(seen.entries())
            .map(([key, v]) => ({ key, label: `Route ${v.routeId} — ${v.direction}`, ...v }))
            .sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true }) || a.direction.localeCompare(b.direction));
    }, [filtered]);

    const activeKey = selectedKey && profileOptions.some(p => p.key === selectedKey)
        ? selectedKey
        : profileOptions[0]?.key || '';

    const merged = useMemo(() => {
        if (!activeKey) return null;
        const heatmaps: RouteRidershipHeatmap[] = [];
        for (const day of filtered) {
            for (const hm of day.ridershipHeatmaps || []) {
                if (`${hm.routeId}__${hm.direction}` === activeKey) {
                    heatmaps.push(hm);
                }
            }
        }
        return mergeHeatmaps(heatmaps);
    }, [filtered, activeKey]);

    // Color scaling + totals
    const { maxBoard, maxAlight, rowTotals, colTotals } = useMemo(() => {
        if (!merged) return { maxBoard: 0, maxAlight: 0, rowTotals: [], colTotals: [] };
        let maxB = 0;
        let maxA = 0;
        const rTotals = merged.stops.map(() => ({ b: 0, a: 0 }));
        const cTotals = merged.trips.map(() => ({ b: 0, a: 0 }));

        for (let si = 0; si < merged.stops.length; si++) {
            for (let ti = 0; ti < merged.trips.length; ti++) {
                const cell = merged.cells[si]?.[ti];
                if (cell) {
                    if (cell[0] > maxB) maxB = cell[0];
                    if (cell[1] > maxA) maxA = cell[1];
                    rTotals[si].b += cell[0];
                    rTotals[si].a += cell[1];
                    cTotals[ti].b += cell[0];
                    cTotals[ti].a += cell[1];
                }
            }
        }
        return { maxBoard: maxB, maxAlight: maxA, rowTotals: rTotals, colTotals: cTotals };
    }, [merged]);

    // Identify stops with any ridership data (boardings or alightings > 0)
    const { visibleStopIndices, emptyStopCount } = useMemo(() => {
        if (!merged) return { visibleStopIndices: [] as number[], emptyStopCount: 0 };
        const indices: number[] = [];
        let empty = 0;
        for (let si = 0; si < merged.stops.length; si++) {
            const hasData = merged.cells[si]?.some(cell => cell && (cell[0] > 0 || cell[1] > 0));
            if (hasData || !hideEmptyStops) {
                indices.push(si);
            }
            if (!hasData) empty++;
        }
        return { visibleStopIndices: indices, emptyStopCount: empty };
    }, [merged, hideEmptyStops]);

    if (!hasHeatmaps) {
        return (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-sm font-bold text-gray-900 mb-2">Ridership Heatmap</h3>
                <p className="text-sm text-gray-500">
                    Reimport STREETS data to see the ridership heatmap. Existing imports don't include the stop×trip matrix.
                </p>
            </div>
        );
    }

    if (!merged || merged.trips.length === 0) {
        return (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-sm font-bold text-gray-900 mb-2">Ridership Heatmap</h3>
                <p className="text-sm text-gray-500">No data for the selected filters.</p>
            </div>
        );
    }

    const tripCount = merged.trips.length;
    const visibleStopCount = visibleStopIndices.length;
    // +1 pair of columns for row totals
    const gridCols = `160px repeat(${tripCount}, 44px 44px) 50px 50px`;
    // header rows + data rows + totals row
    const gridRows = `auto auto repeat(${visibleStopCount}, 28px) 28px`;

    return (
        <div className={isFullscreen
            ? 'fixed inset-0 z-50 bg-white p-4 overflow-hidden flex flex-col'
            : 'bg-white rounded-xl border border-gray-200 p-4'
        }>
            {/* Header */}
            <div className="flex flex-wrap items-center gap-3 mb-4 shrink-0">
                <h3 className="text-sm font-bold text-gray-900">Ridership Heatmap</h3>

                <div className="flex gap-1.5 flex-wrap justify-center">
                    {profileOptions.map(p => {
                        const isActive = activeKey === p.key;
                        const bg = getRouteColor(p.routeId);
                        const fg = getRouteTextColor(p.routeId);
                        return (
                            <button
                                key={p.key}
                                onClick={() => setSelectedKey(p.key)}
                                className={`px-3 py-1 text-xs font-bold rounded-full transition-all ${
                                    isActive ? 'shadow-sm ring-1 ring-black/10' : 'opacity-40 hover:opacity-70'
                                }`}
                                style={{ backgroundColor: bg, color: fg }}
                            >
                                {p.routeId} {p.direction.charAt(0)}
                            </button>
                        );
                    })}
                </div>

                <div className="flex gap-1">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider self-center mr-1">Range:</span>
                    {([['yesterday', 'Latest Day'], ['week', 'Past Week'], ['month', 'Past Month']] as [DateRange, string][]).map(([val, label]) => (
                        <FilterPill key={val} active={dateRange === val} onClick={() => setDateRange(val)}>{label}</FilterPill>
                    ))}
                </div>

                <div className="flex gap-1">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider self-center mr-1">Day:</span>
                    <FilterPill active={dayTypeFilter === 'all'} onClick={() => setDayTypeFilter('all')}>All</FilterPill>
                    {availableDayTypes.map(dt => (
                        <FilterPill key={dt} active={dayTypeFilter === dt} onClick={() => setDayTypeFilter(dt)}>
                            {DAY_TYPE_LABELS[dt]}
                        </FilterPill>
                    ))}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs text-gray-400">
                        {filtered.length} day{filtered.length !== 1 ? 's' : ''} · {tripCount} trips · {merged.stops.length} stops
                    </span>
                    <button
                        onClick={toggleFullscreen}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
                    >
                        {isFullscreen ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m0 0v4m0-4h4m6 6l5 5m0 0v-4m0 4h-4M9 15l-5 5m0 0h4m-4 0v-4m11-6l5-5m0 0h-4m4 0v4" />
                            </svg>
                        ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 mb-3 text-xs text-gray-500">
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: '#22c55e' }} />
                    <span>Boardings</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: '#a78bfa' }} />
                    <span>Alightings</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded border border-gray-200 flex items-center justify-center text-[7px] text-gray-300 font-bold">—</div>
                    <span>Served (0 riders)</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded border border-gray-200" style={{ backgroundColor: '#f3f4f6', backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 2px, #e5e7eb 2px, #e5e7eb 3px)' }} />
                    <span>Not served</span>
                </div>
                {filtered.length > 1 && (
                    <span className="italic">Values are daily averages</span>
                )}
                {emptyStopCount > 0 && (
                    <label className="flex items-center gap-1.5 ml-auto cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={hideEmptyStops}
                            onChange={e => setHideEmptyStops(e.target.checked)}
                            className="rounded border-gray-300 text-cyan-600 focus:ring-cyan-500"
                        />
                        <span>Hide {emptyStopCount} empty stop{emptyStopCount !== 1 ? 's' : ''}</span>
                    </label>
                )}
            </div>

            {/* Heatmap grid */}
            <div className={`overflow-auto ${isFullscreen ? 'flex-1 min-h-0' : 'max-h-[70vh]'}`}>
                <div
                    className="inline-grid"
                    style={{ gridTemplateColumns: gridCols, gridTemplateRows: gridRows }}
                >
                    {/* ── Row 1: Trip time headers ── */}
                    <div className="sticky left-0 top-0 z-30 bg-white" />
                    {merged.trips.map((t, ti) => (
                        <div
                            key={`hdr-${ti}`}
                            className="sticky top-0 z-20 bg-white text-[10px] font-bold text-gray-600 text-center border-b border-gray-200 pb-1 whitespace-nowrap flex items-end justify-center"
                            style={{ gridColumn: `${2 + ti * 2} / span 2` }}
                            title={`${t.tripName} · Block ${t.block}`}
                        >
                            {t.terminalDepartureTime}
                        </div>
                    ))}
                    {/* Total header */}
                    <div
                        className="sticky top-0 z-20 bg-gray-50 text-[10px] font-bold text-gray-600 text-center border-b border-gray-200 pb-1 flex items-end justify-center"
                        style={{ gridColumn: `${2 + tripCount * 2} / span 2` }}
                    >
                        Total
                    </div>

                    {/* ── Row 2: B/A sub-headers ── */}
                    <div className="sticky left-0 top-[21px] z-30 bg-white text-[9px] font-bold text-gray-400 uppercase flex items-center pl-1 border-b border-gray-200">
                        Stop
                    </div>
                    {merged.trips.map((_, ti) => (
                        <React.Fragment key={`sub-${ti}`}>
                            <div className="sticky top-[21px] z-20 bg-white text-[9px] font-bold text-green-600 text-center border-b border-gray-200 flex items-center justify-center">B</div>
                            <div className="sticky top-[21px] z-20 bg-white text-[9px] font-bold text-violet-500 text-center border-b border-gray-200 flex items-center justify-center">A</div>
                        </React.Fragment>
                    ))}
                    <div className="sticky top-[21px] z-20 bg-gray-50 text-[9px] font-bold text-green-600 text-center border-b border-gray-200 flex items-center justify-center">B</div>
                    <div className="sticky top-[21px] z-20 bg-gray-50 text-[9px] font-bold text-violet-500 text-center border-b border-gray-200 flex items-center justify-center">A</div>

                    {/* ── Data rows ── */}
                    {visibleStopIndices.map((si, visIdx) => {
                        const stop = merged.stops[si];
                        const isEven = visIdx % 2 === 0;
                        const stripeBg = isEven ? 'bg-white' : 'bg-gray-50';
                        const rowTotal = rowTotals[si];

                        return (
                            <React.Fragment key={`row-${si}`}>
                                {/* Sticky stop name */}
                                <div
                                    className={`sticky left-0 z-10 text-[10px] truncate pr-2 flex items-center border-b border-gray-50 ${stripeBg} ${
                                        stop.isTimepoint ? 'font-bold text-gray-800 border-l-2 border-l-cyan-400 pl-1.5' : 'text-gray-500 pl-2'
                                    } ${hoveredCell?.row === si ? '!bg-cyan-50' : ''}`}
                                    title={`${stop.stopName} (${stop.stopId})`}
                                >
                                    {stop.stopId ? `${stop.stopName} (${stop.stopId})` : stop.stopName}
                                </div>
                                {/* Data cells */}
                                {merged.trips.map((trip, ti) => {
                                    const cell = merged.cells[si]?.[ti];
                                    const isNull = cell === null;
                                    const board = cell ? cell[0] : 0;
                                    const alight = cell ? cell[1] : 0;
                                    const isZero = !isNull && board === 0;
                                    const isZeroA = !isNull && alight === 0;
                                    const isHovered = hoveredCell?.row === si && hoveredCell?.col === ti;
                                    const isAxisHighlight = hoveredCell && (hoveredCell.row === si || hoveredCell.col === ti);

                                    const nullStyle = isNull ? {
                                        backgroundColor: '#f3f4f6',
                                        backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 3px, #e5e7eb 3px, #e5e7eb 4px)',
                                    } : undefined;

                                    return (
                                        <React.Fragment key={`cell-${si}-${ti}`}>
                                            <div
                                                className={`flex items-center justify-center border-[0.5px] border-gray-100 text-[10px] cursor-default ${
                                                    isHovered ? 'ring-2 ring-green-500 z-10' : ''
                                                } ${isAxisHighlight && !isHovered ? 'opacity-80' : ''}`}
                                                style={isNull ? nullStyle : {
                                                    backgroundColor: interpolateColor(board, maxBoard, 'green'),
                                                    color: textColor(board, maxBoard),
                                                }}
                                                title={isNull ? `${stop.stopName}: not served by ${trip.terminalDepartureTime} trip` : `${stop.stopName} · ${trip.terminalDepartureTime}\nBoard: ${board}`}
                                                onMouseEnter={() => setHoveredCell({ row: si, col: ti })}
                                                onMouseLeave={() => setHoveredCell(null)}
                                            >
                                                {isNull ? '' : isZero ? <span className="text-gray-300">—</span> : fmtVal(board)}
                                            </div>
                                            <div
                                                className={`flex items-center justify-center border-[0.5px] border-gray-100 text-[10px] cursor-default ${
                                                    isHovered ? 'ring-2 ring-violet-500 z-10' : ''
                                                } ${isAxisHighlight && !isHovered ? 'opacity-80' : ''}`}
                                                style={isNull ? nullStyle : {
                                                    backgroundColor: interpolateColor(alight, maxAlight, 'purple'),
                                                    color: textColor(alight, maxAlight),
                                                }}
                                                title={isNull ? `${stop.stopName}: not served by ${trip.terminalDepartureTime} trip` : `${stop.stopName} · ${trip.terminalDepartureTime}\nAlight: ${alight}`}
                                                onMouseEnter={() => setHoveredCell({ row: si, col: ti })}
                                                onMouseLeave={() => setHoveredCell(null)}
                                            >
                                                {isNull ? '' : isZeroA ? <span className="text-gray-300">—</span> : fmtVal(alight)}
                                            </div>
                                        </React.Fragment>
                                    );
                                })}
                                {/* Row totals */}
                                <div className={`flex items-center justify-center border-[0.5px] border-gray-200 text-[10px] font-bold text-green-700 ${stripeBg} border-b border-gray-50`}>
                                    {fmtVal(Math.round(rowTotal.b * 10) / 10) || '0'}
                                </div>
                                <div className={`flex items-center justify-center border-[0.5px] border-gray-200 text-[10px] font-bold text-violet-600 ${stripeBg} border-b border-gray-50`}>
                                    {fmtVal(Math.round(rowTotal.a * 10) / 10) || '0'}
                                </div>
                            </React.Fragment>
                        );
                    })}

                    {/* ── Column totals row ── */}
                    <div className="sticky left-0 z-10 bg-gray-50 text-[10px] font-bold text-gray-700 flex items-center pl-2 border-t border-gray-300">
                        Total
                    </div>
                    {colTotals.map((ct, ti) => (
                        <React.Fragment key={`ctot-${ti}`}>
                            <div className="flex items-center justify-center bg-gray-50 border-t border-gray-300 border-[0.5px] border-gray-200 text-[10px] font-bold text-green-700">
                                {fmtVal(Math.round(ct.b * 10) / 10) || '0'}
                            </div>
                            <div className="flex items-center justify-center bg-gray-50 border-t border-gray-300 border-[0.5px] border-gray-200 text-[10px] font-bold text-violet-600">
                                {fmtVal(Math.round(ct.a * 10) / 10) || '0'}
                            </div>
                        </React.Fragment>
                    ))}
                    {/* Grand total */}
                    <div className="flex items-center justify-center bg-gray-100 border-t border-gray-300 border-[0.5px] border-gray-200 text-[10px] font-extrabold text-green-800">
                        {Math.round(colTotals.reduce((s, c) => s + c.b, 0))}
                    </div>
                    <div className="flex items-center justify-center bg-gray-100 border-t border-gray-300 border-[0.5px] border-gray-200 text-[10px] font-extrabold text-violet-700">
                        {Math.round(colTotals.reduce((s, c) => s + c.a, 0))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const FilterPill: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
    <button
        onClick={onClick}
        className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
            active ? 'bg-cyan-100 text-cyan-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
        }`}
    >
        {children}
    </button>
);
