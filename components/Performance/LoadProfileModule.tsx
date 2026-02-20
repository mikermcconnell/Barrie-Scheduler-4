import React, { useMemo, useState } from 'react';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend, ReferenceLine, ComposedChart, Line, Cell,
} from 'recharts';
import { ChartCard } from '../Analytics/AnalyticsShared';
import type { PerformanceDataSummary, DayType, RouteLoadProfile } from '../../utils/performanceDataTypes';
import { DEFAULT_LOAD_CAP } from '../../utils/performanceDataTypes';
import { getRouteColor, getRouteTextColor } from '../../utils/config/routeColors';

interface LoadProfileModuleProps {
    data: PerformanceDataSummary;
}

const DAY_TYPE_LABELS: Record<DayType, string> = { weekday: 'Weekday', saturday: 'Saturday', sunday: 'Sunday' };

export const LoadProfileModule: React.FC<LoadProfileModuleProps> = ({ data }) => {
    const availableDayTypes = useMemo(() => {
        const types = new Set(data.dailySummaries.map(d => d.dayType));
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [data]);

    const [dayTypeFilter, setDayTypeFilter] = useState<DayType | 'all'>('all');

    const filtered = useMemo(() => {
        if (dayTypeFilter === 'all') return data.dailySummaries;
        return data.dailySummaries.filter(d => d.dayType === dayTypeFilter);
    }, [data, dayTypeFilter]);

    // Merge load profiles across filtered days
    const mergedProfiles = useMemo(() => {
        const profileMap = new Map<string, { profile: RouteLoadProfile; dayCount: number }>();

        for (const day of filtered) {
            for (const lp of day.loadProfiles) {
                const key = `${lp.routeId}__${lp.direction}`;
                const existing = profileMap.get(key);
                if (!existing) {
                    profileMap.set(key, {
                        profile: {
                            ...lp,
                            stops: lp.stops.map(s => ({ ...s })),
                        },
                        dayCount: 1,
                    });
                } else {
                    existing.dayCount++;
                    for (let i = 0; i < lp.stops.length && i < existing.profile.stops.length; i++) {
                        const es = existing.profile.stops[i];
                        const ns = lp.stops[i];
                        es.avgBoardings += ns.avgBoardings;
                        es.avgAlightings += ns.avgAlightings;
                        es.avgLoad += ns.avgLoad;
                        es.maxLoad = Math.max(es.maxLoad, ns.maxLoad);
                    }
                    existing.profile.tripCount += lp.tripCount;
                }
            }
        }

        // Average across days
        for (const { profile, dayCount } of profileMap.values()) {
            if (dayCount > 1) {
                for (const s of profile.stops) {
                    s.avgBoardings = Math.round(s.avgBoardings / dayCount);
                    s.avgAlightings = Math.round(s.avgAlightings / dayCount);
                    s.avgLoad = Math.round(s.avgLoad / dayCount);
                }
            }
        }

        return Array.from(profileMap.values())
            .map(p => p.profile)
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

    const activeProfile = useMemo(
        () => mergedProfiles.find(p => `${p.routeId}__${p.direction}` === selectedProfile),
        [mergedProfiles, selectedProfile]
    );

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

    if (mergedProfiles.length === 0) {
        return <div className="text-center text-gray-400 py-16">No load profile data available.</div>;
    }

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-400 uppercase">Day Type:</span>
                    <div className="flex gap-1">
                        <FilterPill active={dayTypeFilter === 'all'} onClick={() => setDayTypeFilter('all')}>All</FilterPill>
                        {availableDayTypes.map(dt => (
                            <FilterPill key={dt} active={dayTypeFilter === dt} onClick={() => setDayTypeFilter(dt)}>
                                {DAY_TYPE_LABELS[dt]}
                            </FilterPill>
                        ))}
                    </div>
                </div>
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
                        subtitle={`${activeProfile.routeName} — avg passenger load at each stop (${activeProfile.tripCount} trips)`}
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
                                        <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">#</th>
                                        <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Stop</th>
                                        <th className="text-center py-2 px-2 font-bold text-gray-500 text-xs uppercase">TP</th>
                                        <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Board</th>
                                        <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Alight</th>
                                        <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Avg Load</th>
                                        <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Max Load</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeProfile.stops.map((s, i) => (
                                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                            <td className="py-1.5 px-2 text-gray-400">{i + 1}</td>
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
