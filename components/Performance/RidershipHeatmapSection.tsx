import React, { useMemo, useState } from 'react';
import type {
    PerformanceDataSummary, DayType, RouteRidershipHeatmap,
} from '../../utils/performanceDataTypes';

// ─── Color helpers ───────────────────────────────────────────────────

function interpolateColor(value: number, max: number, channel: 'green' | 'purple'): string {
    if (value === 0 || max === 0) return '#ffffff';
    const ratio = Math.min(value / max, 1);
    if (channel === 'green') {
        // white → #22c55e (green-500)
        const r = Math.round(255 - ratio * 221); // 255 → 34
        const g = Math.round(255 - ratio * 58);  // 255 → 197
        const b = Math.round(255 - ratio * 161); // 255 → 94
        return `rgb(${r}, ${g}, ${b})`;
    }
    // white → #a78bfa (violet-400)
    const r = Math.round(255 - ratio * 88);  // 255 → 167
    const g = Math.round(255 - ratio * 116); // 255 → 139
    const b = Math.round(255 - ratio * 5);   // 255 → 250
    return `rgb(${r}, ${g}, ${b})`;
}

function textColor(value: number, max: number): string {
    if (max === 0) return '#6b7280';
    return value / max > 0.6 ? '#ffffff' : '#374151';
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
    // Union of all trips (keyed by terminalDepartureTime)
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

    // Sort trips by departure time — use a simple HH:MM parse
    const timeToSec = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return h * 3600 + (m || 0) * 60;
    };
    const sortedTrips = [...allTrips].sort((a, b) =>
        timeToSec(a.terminalDepartureTime) - timeToSec(b.terminalDepartureTime)
    );
    const newTripIdx = new Map<string, number>();
    sortedTrips.forEach((t, i) => newTripIdx.set(t.terminalDepartureTime, i));

    // Use the first day's stop list (route stops are stable across days)
    const stops = base.stops;
    const stopIdx = new Map<number, number>();
    stops.forEach((s, i) => stopIdx.set(s.routeStopIndex, i));

    // Accumulator: [boardings, alightings, dayCount]
    const acc: ([number, number, number] | null)[][] =
        stops.map(() => sortedTrips.map((): [number, number, number] | null => null));

    for (const hm of heatmaps) {
        // Build this day's trip index
        const dayTripIdx = new Map<string, number>();
        hm.trips.forEach((t, i) => dayTripIdx.set(t.terminalDepartureTime, i));

        for (let si = 0; si < hm.stops.length && si < stops.length; si++) {
            for (let ti = 0; ti < hm.trips.length; ti++) {
                const cell = hm.cells[si]?.[ti];
                if (!cell) continue;
                const newTi = newTripIdx.get(hm.trips[ti].terminalDepartureTime);
                if (newTi === undefined) continue;
                const existing = acc[si][newTi];
                if (existing) {
                    existing[0] += cell[0];
                    existing[1] += cell[1];
                    existing[2]++;
                } else {
                    acc[si][newTi] = [cell[0], cell[1], 1];
                }
            }
        }
    }

    // Average
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

    // Check if any day has heatmap data
    const hasHeatmaps = useMemo(() =>
        data.dailySummaries.some(d => d.ridershipHeatmaps && d.ridershipHeatmaps.length > 0),
        [data]
    );

    // Available day types
    const availableDayTypes = useMemo(() => {
        const types = new Set(data.dailySummaries.map(d => d.dayType));
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [data]);

    // Filter by date range + day type
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

    // Collect all route+direction options across filtered days
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

    // Auto-select first option
    const activeKey = selectedKey && profileOptions.some(p => p.key === selectedKey)
        ? selectedKey
        : profileOptions[0]?.key || '';

    // Merge heatmaps for the selected route+direction across filtered days
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

    // Compute max values for color scaling
    const { maxBoard, maxAlight } = useMemo(() => {
        if (!merged) return { maxBoard: 0, maxAlight: 0 };
        let maxB = 0;
        let maxA = 0;
        for (const row of merged.cells) {
            for (const cell of row) {
                if (cell) {
                    if (cell[0] > maxB) maxB = cell[0];
                    if (cell[1] > maxA) maxA = cell[1];
                }
            }
        }
        return { maxBoard: maxB, maxAlight: maxA };
    }, [merged]);

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

    return (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
            {/* Header */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
                <h3 className="text-sm font-bold text-gray-900">Ridership Heatmap</h3>

                {/* Route selector */}
                <select
                    value={activeKey}
                    onChange={e => setSelectedKey(e.target.value)}
                    className="text-sm font-medium border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:border-cyan-400 focus:outline-none"
                >
                    {profileOptions.map(p => (
                        <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                </select>

                {/* Date range pills */}
                <div className="flex gap-1">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider self-center mr-1">Range:</span>
                    {([['yesterday', 'Yesterday'], ['week', 'Past Week'], ['month', 'Past Month']] as [DateRange, string][]).map(([val, label]) => (
                        <FilterPill key={val} active={dateRange === val} onClick={() => setDateRange(val)}>{label}</FilterPill>
                    ))}
                </div>

                {/* Day type pills */}
                <div className="flex gap-1">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider self-center mr-1">Day:</span>
                    <FilterPill active={dayTypeFilter === 'all'} onClick={() => setDayTypeFilter('all')}>All</FilterPill>
                    {availableDayTypes.map(dt => (
                        <FilterPill key={dt} active={dayTypeFilter === dt} onClick={() => setDayTypeFilter(dt)}>
                            {DAY_TYPE_LABELS[dt]}
                        </FilterPill>
                    ))}
                </div>

                <span className="text-xs text-gray-400 ml-auto">
                    {filtered.length} day{filtered.length !== 1 ? 's' : ''} · {tripCount} trips · {merged.stops.length} stops
                </span>
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
                {filtered.length > 1 && (
                    <span className="italic">Values are daily averages</span>
                )}
            </div>

            {/* Heatmap grid */}
            <div className="overflow-x-auto">
                <div
                    className="inline-grid"
                    style={{
                        gridTemplateColumns: `160px repeat(${tripCount}, 44px 44px)`,
                        gridTemplateRows: `auto auto repeat(${merged.stops.length}, 28px)`,
                    }}
                >
                    {/* Row 1: Trip time headers spanning 2 cols each */}
                    <div className="sticky left-0 z-20 bg-white" />
                    {merged.trips.map((t, ti) => (
                        <div
                            key={`hdr-${ti}`}
                            className="text-[10px] font-bold text-gray-600 text-center border-b border-gray-200 pb-1 whitespace-nowrap"
                            style={{ gridColumn: `${2 + ti * 2} / span 2` }}
                            title={`${t.tripName} · Block ${t.block}`}
                        >
                            {t.terminalDepartureTime}
                        </div>
                    ))}

                    {/* Row 2: B/A sub-headers */}
                    <div className="sticky left-0 z-20 bg-white text-[9px] font-bold text-gray-400 uppercase flex items-center pl-1">
                        Stop
                    </div>
                    {merged.trips.map((_, ti) => (
                        <React.Fragment key={`sub-${ti}`}>
                            <div className="text-[9px] font-bold text-green-600 text-center border-b border-gray-100 pb-0.5">B</div>
                            <div className="text-[9px] font-bold text-violet-500 text-center border-b border-gray-100 pb-0.5">A</div>
                        </React.Fragment>
                    ))}

                    {/* Data rows */}
                    {merged.stops.map((stop, si) => (
                        <React.Fragment key={`row-${si}`}>
                            {/* Sticky stop name */}
                            <div
                                className={`sticky left-0 z-10 bg-white text-[10px] truncate pr-2 flex items-center border-b border-gray-50 ${
                                    stop.isTimepoint ? 'font-bold text-gray-800' : 'text-gray-500'
                                } ${hoveredCell?.row === si ? 'bg-gray-50' : ''}`}
                                title={`${stop.stopName} (${stop.stopId})`}
                            >
                                {stop.stopName}
                            </div>
                            {/* Cells */}
                            {merged.trips.map((trip, ti) => {
                                const cell = merged.cells[si]?.[ti];
                                const board = cell ? cell[0] : 0;
                                const alight = cell ? cell[1] : 0;
                                const isHovered = hoveredCell?.row === si && hoveredCell?.col === ti;
                                const isAxisHighlight = hoveredCell && (hoveredCell.row === si || hoveredCell.col === ti);

                                return (
                                    <React.Fragment key={`cell-${si}-${ti}`}>
                                        {/* Boarding cell */}
                                        <div
                                            className={`flex items-center justify-center border-[0.5px] border-gray-100 text-[10px] cursor-default transition-shadow ${
                                                isHovered ? 'ring-2 ring-green-500 z-10' : ''
                                            } ${isAxisHighlight && !isHovered ? 'opacity-90' : ''}`}
                                            style={{
                                                backgroundColor: cell ? interpolateColor(board, maxBoard, 'green') : '#f9fafb',
                                                color: cell ? textColor(board, maxBoard) : '#d1d5db',
                                            }}
                                            title={cell ? `${stop.stopName} · ${trip.terminalDepartureTime}\nBoard: ${board}` : 'No data'}
                                            onMouseEnter={() => setHoveredCell({ row: si, col: ti })}
                                            onMouseLeave={() => setHoveredCell(null)}
                                        >
                                            {cell ? (board % 1 === 0 ? board : board.toFixed(1)) : ''}
                                        </div>
                                        {/* Alighting cell */}
                                        <div
                                            className={`flex items-center justify-center border-[0.5px] border-gray-100 text-[10px] cursor-default transition-shadow ${
                                                isHovered ? 'ring-2 ring-violet-500 z-10' : ''
                                            } ${isAxisHighlight && !isHovered ? 'opacity-90' : ''}`}
                                            style={{
                                                backgroundColor: cell ? interpolateColor(alight, maxAlight, 'purple') : '#f9fafb',
                                                color: cell ? textColor(alight, maxAlight) : '#d1d5db',
                                            }}
                                            title={cell ? `${stop.stopName} · ${trip.terminalDepartureTime}\nAlight: ${alight}` : 'No data'}
                                            onMouseEnter={() => setHoveredCell({ row: si, col: ti })}
                                            onMouseLeave={() => setHoveredCell(null)}
                                        >
                                            {cell ? (alight % 1 === 0 ? alight : alight.toFixed(1)) : ''}
                                        </div>
                                    </React.Fragment>
                                );
                            })}
                        </React.Fragment>
                    ))}
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
