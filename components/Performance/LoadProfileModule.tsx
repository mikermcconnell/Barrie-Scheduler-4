import React, { useMemo, useState } from 'react';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend, ReferenceLine, ComposedChart, Line, Cell,
} from 'recharts';
import { ChartCard } from '../Analytics/AnalyticsShared';
import type { PerformanceDataSummary, RouteLoadProfile } from '../../utils/performanceDataTypes';
import { DEFAULT_LOAD_CAP } from '../../utils/performanceDataTypes';
import { getRouteColor, getRouteTextColor } from '../../utils/config/routeColors';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';

interface LoadProfileModuleProps {
    data: PerformanceDataSummary;
}

const MIN_LOAD_PROFILE_DAYS = 5;
type SortDir = 'asc' | 'desc';
type StopSortKey = 'stopIndex' | 'stopName' | 'tp' | 'boardings' | 'alightings' | 'avgLoad' | 'maxLoad';

function compareText(a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function compareNumber(a: number, b: number): number {
    return a - b;
}

function SortableHeader({
    label,
    sortKey,
    activeKey,
    direction,
    onClick,
    align = 'left',
}: {
    label: string;
    sortKey: StopSortKey;
    activeKey: StopSortKey;
    direction: SortDir;
    onClick: (key: StopSortKey) => void;
    align?: 'left' | 'right' | 'center';
}) {
    const active = activeKey === sortKey;
    const alignClass = align === 'right' ? 'justify-end text-right' : align === 'center' ? 'justify-center text-center' : 'justify-start text-left';
    return (
        <th className="py-2 px-2 font-bold text-gray-500 text-xs uppercase">
            <button
                type="button"
                onClick={() => onClick(sortKey)}
                className={`w-full inline-flex items-center gap-0.5 ${alignClass} cursor-pointer select-none hover:text-gray-700 transition-colors`}
            >
                <span>{label}</span>
                {active ? (
                    direction === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                ) : (
                    <ArrowUpDown size={11} className="opacity-25" />
                )}
            </button>
        </th>
    );
}

export const LoadProfileModule: React.FC<LoadProfileModuleProps> = ({ data }) => {
    const filtered = data.dailySummaries;
    const daysWithLoadProfiles = useMemo(
        () => filtered.reduce((count, day) => count + (day.loadProfiles.length > 0 ? 1 : 0), 0),
        [filtered]
    );

    // Merge load profiles across filtered days
    const mergedProfiles = useMemo(() => {
        type StopAccumulator = {
            stopName: string;
            stopId: string;
            routeStopIndex: number;
            isTimepoint: boolean;
            sumBoardings: number;
            sumAlightings: number;
            sumLoad: number;
            maxLoad: number;
            sampleCount: number;
        };
        type ProfileAccumulator = {
            routeId: string;
            routeName: string;
            direction: string;
            tripCount: number;
            stops: Map<string, StopAccumulator>;
        };
        const profileMap = new Map<string, ProfileAccumulator>();

        for (const day of filtered) {
            for (const lp of day.loadProfiles) {
                const key = `${lp.routeId}__${lp.direction}`;
                let acc = profileMap.get(key);
                if (!acc) {
                    acc = {
                        routeId: lp.routeId,
                        routeName: lp.routeName,
                        direction: lp.direction,
                        tripCount: 0,
                        stops: new Map<string, StopAccumulator>(),
                    };
                    profileMap.set(key, acc);
                }

                acc.tripCount += lp.tripCount;
                for (const stop of lp.stops) {
                    const stopKey = stop.stopId || `${stop.routeStopIndex}__${stop.stopName}`;
                    const existingStop = acc.stops.get(stopKey);
                    if (!existingStop) {
                        acc.stops.set(stopKey, {
                            stopName: stop.stopName,
                            stopId: stop.stopId,
                            routeStopIndex: stop.routeStopIndex,
                            isTimepoint: stop.isTimepoint,
                            sumBoardings: stop.avgBoardings,
                            sumAlightings: stop.avgAlightings,
                            sumLoad: stop.avgLoad,
                            maxLoad: stop.maxLoad,
                            sampleCount: 1,
                        });
                    } else {
                        existingStop.sumBoardings += stop.avgBoardings;
                        existingStop.sumAlightings += stop.avgAlightings;
                        existingStop.sumLoad += stop.avgLoad;
                        existingStop.maxLoad = Math.max(existingStop.maxLoad, stop.maxLoad);
                        existingStop.isTimepoint = existingStop.isTimepoint || stop.isTimepoint;
                        existingStop.sampleCount++;
                        if (stop.routeStopIndex < existingStop.routeStopIndex) {
                            existingStop.routeStopIndex = stop.routeStopIndex;
                        }
                    }
                }
            }
        }

        return Array.from(profileMap.values())
            .map((p): RouteLoadProfile => ({
                routeId: p.routeId,
                routeName: p.routeName,
                direction: p.direction,
                tripCount: p.tripCount,
                stops: Array.from(p.stops.values())
                    .map(s => ({
                        stopName: s.stopName,
                        stopId: s.stopId,
                        routeStopIndex: s.routeStopIndex,
                        avgBoardings: s.sampleCount > 0 ? Math.round(s.sumBoardings / s.sampleCount) : 0,
                        avgAlightings: s.sampleCount > 0 ? Math.round(s.sumAlightings / s.sampleCount) : 0,
                        // Note: avgLoad is an unweighted average-of-averages across days. A proper weighted
                        // average would require per-stop reliable-load-trip counts on LoadProfileStop.
                        // Accepted approximation since same-route APC coverage is stable day-to-day.
                        avgLoad: s.sampleCount > 0 ? Math.round(s.sumLoad / s.sampleCount) : 0,
                        maxLoad: s.maxLoad,
                        isTimepoint: s.isTimepoint,
                    }))
                    .sort((a, b) => a.routeStopIndex - b.routeStopIndex || a.stopName.localeCompare(b.stopName)),
            }))
            .sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true }) || a.direction.localeCompare(b.direction));
    }, [filtered]);

    // Route+direction options for selector
    const profileOptions = useMemo(() =>
        mergedProfiles.map(p => ({
            key: `${p.routeId}__${p.direction}`,
            label: `Route ${p.routeId} — ${p.direction}`,
            routeId: p.routeId,
            direction: p.direction,
            routeName: p.routeName,
            tripCount: p.tripCount,
        })),
        [mergedProfiles]
    );

    const [selectedProfile, setSelectedProfile] = useState<string>(profileOptions[0]?.key ?? '');
    const [stopSortKey, setStopSortKey] = useState<StopSortKey>('stopIndex');
    const [stopSortDir, setStopSortDir] = useState<SortDir>('asc');

    const activeProfile = useMemo(
        () => mergedProfiles.find(p => `${p.routeId}__${p.direction}` === selectedProfile),
        [mergedProfiles, selectedProfile]
    );

    const sortedStops = useMemo(() => {
        if (!activeProfile) return [];
        const rows = [...activeProfile.stops];
        rows.sort((a, b) => {
            const mult = stopSortDir === 'asc' ? 1 : -1;
            let cmp = 0;
            switch (stopSortKey) {
                case 'stopIndex':
                    cmp = compareNumber(a.routeStopIndex, b.routeStopIndex);
                    break;
                case 'stopName':
                    cmp = compareText(a.stopName, b.stopName);
                    break;
                case 'tp':
                    cmp = compareNumber(Number(a.isTimepoint), Number(b.isTimepoint));
                    break;
                case 'boardings':
                    cmp = compareNumber(a.avgBoardings, b.avgBoardings);
                    break;
                case 'alightings':
                    cmp = compareNumber(a.avgAlightings, b.avgAlightings);
                    break;
                case 'avgLoad':
                    cmp = compareNumber(a.avgLoad, b.avgLoad);
                    break;
                case 'maxLoad':
                    cmp = compareNumber(a.maxLoad, b.maxLoad);
                    break;
            }
            if (cmp !== 0) return mult * cmp;
            return compareNumber(a.routeStopIndex, b.routeStopIndex) || compareText(a.stopName, b.stopName);
        });
        return rows;
    }, [activeProfile, stopSortDir, stopSortKey]);

    const toggleStopSort = (key: StopSortKey) => {
        setStopSortKey(prev => {
            if (prev === key) {
                setStopSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'));
                return prev;
            }
            setStopSortDir(key === 'stopIndex' || key === 'stopName' || key === 'tp' ? 'asc' : 'desc');
            return key;
        });
    };

    // Update selection if it becomes invalid
    React.useEffect(() => {
        if (profileOptions.length > 0 && !profileOptions.find(p => p.key === selectedProfile)) {
            setSelectedProfile(profileOptions[0].key);
        }
    }, [profileOptions, selectedProfile]);

    const qualityStats = useMemo(() => {
        let loadCapped = 0;
        let apcExcludedFromLoad = 0;
        for (const day of filtered) {
            loadCapped += day.dataQuality.loadCapped;
            apcExcludedFromLoad += day.dataQuality.apcExcludedFromLoad;
        }
        return { loadCapped, apcExcludedFromLoad };
    }, [filtered]);

    // Top 5 peak-load trips across filtered days
    const topLoadTrips = useMemo(() => {
        const tripMap = new Map<string, { maxLoad: number; totalMaxLoad: number; count: number; routeId: string; routeName: string; direction: string; block: string; terminalDepartureTime: string; tripName: string }>();

        for (const day of filtered) {
            for (const t of day.byTrip) {
                const key = `${t.routeId}__${t.direction}__${t.terminalDepartureTime}`;
                const existing = tripMap.get(key);
                if (!existing) {
                    tripMap.set(key, {
                        maxLoad: t.maxLoad,
                        totalMaxLoad: t.maxLoad,
                        count: 1,
                        routeId: t.routeId,
                        routeName: t.routeName,
                        direction: t.direction,
                        block: t.block,
                        terminalDepartureTime: t.terminalDepartureTime,
                        tripName: t.tripName,
                    });
                } else {
                    existing.totalMaxLoad += t.maxLoad;
                    existing.count++;
                    existing.maxLoad = Math.max(existing.maxLoad, t.maxLoad);
                }
            }
        }

        return Array.from(tripMap.values())
            .map(t => ({
                ...t,
                avgMaxLoad: Math.round(t.totalMaxLoad / t.count),
                label: `Rte ${t.routeId} ${t.direction}`,
                time: t.terminalDepartureTime,
                color: getRouteColor(t.routeId),
            }))
            .sort((a, b) => b.avgMaxLoad - a.avgMaxLoad)
            .slice(0, 5);
    }, [filtered]);

    const chartData = useMemo(() => {
        if (!activeProfile) return [];
        return activeProfile.stops.map(s => ({
            name: s.stopName.length > 20 ? s.stopName.slice(0, 18) + '...' : s.stopName,
            fullName: s.stopName,
            boardings: Math.round(s.avgBoardings),
            alightings: Math.round(s.avgAlightings),
            load: Math.round(s.avgLoad),
            maxLoad: Math.round(s.maxLoad),
            isTimepoint: s.isTimepoint,
        }));
    }, [activeProfile]);

    if (daysWithLoadProfiles < MIN_LOAD_PROFILE_DAYS) {
        return (
            <div className="flex items-center justify-center h-48 text-sm text-gray-400">
                Insufficient data - need at least {MIN_LOAD_PROFILE_DAYS} days ({daysWithLoadProfiles} available for this filter)
            </div>
        );
    }

    if (mergedProfiles.length === 0) {
        return <div className="text-center text-gray-400 py-16">No load profile data available.</div>;
    }

    return (
        <div className="space-y-6">
            {/* Route selector */}
            <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-400 uppercase">Route:</span>
                    <div className="flex gap-1.5 flex-wrap justify-center">
                        {profileOptions.map(p => {
                            const isActive = selectedProfile === p.key;
                            const bg = getRouteColor(p.routeId);
                            const fg = getRouteTextColor(p.routeId);
                            return (
                                <button
                                    key={p.key}
                                    onClick={() => setSelectedProfile(p.key)}
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
                </div>
            </div>

            {/* Data quality badges */}
            {(qualityStats.loadCapped > 0 || qualityStats.apcExcludedFromLoad > 0) && (
                <div className="flex items-center gap-3 flex-wrap">
                    {qualityStats.loadCapped > 0 && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            ⚠ {qualityStats.loadCapped.toLocaleString()} records capped at {DEFAULT_LOAD_CAP} — possible APC issues
                        </span>
                    )}
                    {qualityStats.apcExcludedFromLoad > 0 && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-600 border border-blue-200">
                            {qualityStats.apcExcludedFromLoad.toLocaleString()} records excluded (no APC)
                        </span>
                    )}
                </div>
            )}

            {/* Top 5 Peak Load Trips — horizontal bar race */}
            {topLoadTrips.length > 0 && (
                <ChartCard
                    title="Top 5 Peak Load Trips"
                    subtitle={`Highest average peak passenger load${filtered.length > 1 ? ` across ${filtered.length} days` : ''}`}
                >
                    <ResponsiveContainer width="100%" height={topLoadTrips.length * 64 + 24}>
                        <BarChart
                            data={topLoadTrips}
                            layout="vertical"
                            margin={{ top: 4, right: 40, bottom: 4, left: 0 }}
                            barCategoryGap="20%"
                        >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                            <XAxis
                                type="number"
                                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                                domain={[0, (max: number) => Math.max(max + 5, DEFAULT_LOAD_CAP + 5)]}
                            />
                            <YAxis
                                type="category"
                                dataKey="label"
                                width={90}
                                tick={({ x, y, payload }: { x: number; y: number; payload: { value: string; index: number } }) => {
                                    const trip = topLoadTrips[payload.index];
                                    return (
                                        <g transform={`translate(${x},${y})`}>
                                            <text x={-4} y={-6} textAnchor="end" fontSize={11} fontWeight={700} fill="#374151">
                                                {payload.value}
                                            </text>
                                            <text x={-4} y={8} textAnchor="end" fontSize={9} fill="#9CA3AF">
                                                {trip?.time} · {trip?.block}
                                            </text>
                                        </g>
                                    );
                                }}
                            />
                            <ReferenceLine
                                x={DEFAULT_LOAD_CAP}
                                stroke="#EF4444"
                                strokeDasharray="4 3"
                                strokeWidth={1.5}
                                label={{ value: `Cap ${DEFAULT_LOAD_CAP}`, position: 'top', fontSize: 9, fill: '#EF4444' }}
                            />
                            <Tooltip
                                content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const d = payload[0].payload;
                                    return (
                                        <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-100 text-sm">
                                            <p className="font-bold text-gray-800">{d.tripName}</p>
                                            <p className="text-gray-500 text-xs mb-1">{d.routeName} · {d.direction}</p>
                                            <p className="text-cyan-600">Avg Peak Load: <span className="font-bold">{d.avgMaxLoad}</span></p>
                                            {d.count > 1 && (
                                                <p className="text-gray-400 text-xs">Highest: {d.maxLoad} (across {d.count} days)</p>
                                            )}
                                            <p className="text-gray-400 text-xs">Block: {d.block}</p>
                                        </div>
                                    );
                                }}
                            />
                            <Bar dataKey="avgMaxLoad" radius={[0, 6, 6, 0]} barSize={24}>
                                {topLoadTrips.map((trip, i) => (
                                    <Cell key={i} fill={trip.color} fillOpacity={0.85} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            )}

            {activeProfile && (
                <>
                    {/* Load Curve — the key Transify replacement chart */}
                    <ChartCard
                        title={`Load Profile: Route ${activeProfile.routeId} ${activeProfile.direction}`}
                        subtitle={`${activeProfile.routeName} — avg passenger load at each stop (${activeProfile.tripCount} trips across ${filtered.length} day${filtered.length !== 1 ? 's' : ''})`}
                    >
                        <ResponsiveContainer width="100%" height={350}>
                            <AreaChart data={chartData} margin={{ top: 10, right: 10, bottom: 60, left: -10 }}>
                                <defs>
                                    <linearGradient id="loadGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                <XAxis
                                    dataKey="name"
                                    tick={{ fontSize: 9, fill: '#9CA3AF' }}
                                    angle={-45}
                                    textAnchor="end"
                                    height={80}
                                    interval={0}
                                />
                                <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                                <Tooltip
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null;
                                        const d = payload[0].payload;
                                        return (
                                            <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-100 text-sm">
                                                <p className="font-bold text-gray-800 mb-1">{d.fullName}</p>
                                                <p className="text-cyan-600">Load: <span className="font-bold">{d.load}</span></p>
                                                <p className="text-emerald-600">Boardings: <span className="font-bold">{d.boardings}</span></p>
                                                <p className="text-purple-600">Alightings: <span className="font-bold">{d.alightings}</span></p>
                                                <p className="text-gray-400">Max load: {d.maxLoad}</p>
                                                {d.isTimepoint && <p className="text-amber-600 text-xs mt-1">Timepoint</p>}
                                            </div>
                                        );
                                    }}
                                />
                                <Area type="monotone" dataKey="load" stroke="#06b6d4" strokeWidth={2} fill="url(#loadGradient)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </ChartCard>

                    {/* Boardings/Alightings bar chart */}
                    <ChartCard
                        title="Boardings & Alightings"
                        subtitle="Where passengers get on and off along the route"
                    >
                        <ResponsiveContainer width="100%" height={300}>
                            <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 60, left: -10 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                <XAxis
                                    dataKey="name"
                                    tick={{ fontSize: 9, fill: '#9CA3AF' }}
                                    angle={-45}
                                    textAnchor="end"
                                    height={80}
                                    interval={0}
                                />
                                <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: 11 }} />
                                <Bar dataKey="boardings" name="Boardings" fill="#22c55e" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="alightings" name="Alightings" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                                <Line type="monotone" dataKey="load" name="Load" stroke="#06b6d4" strokeWidth={2} dot={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </ChartCard>

                    {/* Stop detail table */}
                    <ChartCard title="Stop-Level Detail" subtitle="Full load profile data">
                        <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                            <table className="w-full text-sm">
                                <thead className="sticky top-0 bg-white">
                                    <tr className="border-b border-gray-100">
                                        <SortableHeader label="#" sortKey="stopIndex" activeKey={stopSortKey} direction={stopSortDir} onClick={toggleStopSort} />
                                        <SortableHeader label="Stop" sortKey="stopName" activeKey={stopSortKey} direction={stopSortDir} onClick={toggleStopSort} />
                                        <SortableHeader label="TP" sortKey="tp" activeKey={stopSortKey} direction={stopSortDir} onClick={toggleStopSort} align="center" />
                                        <SortableHeader label="Board" sortKey="boardings" activeKey={stopSortKey} direction={stopSortDir} onClick={toggleStopSort} align="right" />
                                        <SortableHeader label="Alight" sortKey="alightings" activeKey={stopSortKey} direction={stopSortDir} onClick={toggleStopSort} align="right" />
                                        <SortableHeader label="Avg Load" sortKey="avgLoad" activeKey={stopSortKey} direction={stopSortDir} onClick={toggleStopSort} align="right" />
                                        <SortableHeader label="Max Load" sortKey="maxLoad" activeKey={stopSortKey} direction={stopSortDir} onClick={toggleStopSort} align="right" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedStops.map((s) => (
                                        <tr key={`${s.stopId}-${s.routeStopIndex}`} className="border-b border-gray-50 hover:bg-gray-50">
                                            <td className="py-1.5 px-2 text-gray-400">{s.routeStopIndex + 1}</td>
                                            <td className="py-1.5 px-2 text-gray-700">{s.stopName}</td>
                                            <td className="py-1.5 px-2 text-center">
                                                {s.isTimepoint && <span className="text-amber-500 text-xs font-bold">TP</span>}
                                            </td>
                                            <td className="py-1.5 px-2 text-right text-emerald-600 font-medium">{Math.round(s.avgBoardings)}</td>
                                            <td className="py-1.5 px-2 text-right text-purple-600 font-medium">{Math.round(s.avgAlightings)}</td>
                                            <td className="py-1.5 px-2 text-right font-bold text-gray-900">{Math.round(s.avgLoad)}</td>
                                            <td className="py-1.5 px-2 text-right text-gray-500">{Math.round(s.maxLoad)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </ChartCard>
                </>
            )}
        </div>
    );
};
