import React, { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, ReferenceLine,
} from 'recharts';
import { Clock, Users, Bus, AlertTriangle, ArrowUpDown, Filter, Download } from 'lucide-react';
import { MetricCard, ChartCard } from '../../Analytics/AnalyticsShared';
import type { DailySummary } from '../../../utils/performanceDataTypes';
import { exportRoutePerformance } from './reportExporter';

interface RoutePerformanceReportProps {
    filteredDays: DailySummary[];
    startDate: string;
    endDate: string;
}

type TripSortField = 'terminalDepartureTime' | 'block' | 'otp' | 'boardings' | 'maxLoad';

export const RoutePerformanceReport: React.FC<RoutePerformanceReportProps> = ({ filteredDays, startDate, endDate }) => {
    const [selectedRoute, setSelectedRoute] = useState<string>('');
    const [tripSortField, setTripSortField] = useState<TripSortField>('terminalDepartureTime');
    const [tripSortAsc, setTripSortAsc] = useState(true);
    const [showWorstOnly, setShowWorstOnly] = useState(false);
    const [exporting, setExporting] = useState(false);

    // Available routes
    const routes = useMemo(() => {
        const routeMap = new Map<string, string>();
        for (const day of filteredDays) {
            for (const r of day.byRoute) {
                if (!routeMap.has(r.routeId)) routeMap.set(r.routeId, r.routeName);
            }
        }
        return Array.from(routeMap.entries())
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    }, [filteredDays]);

    // Auto-select first route
    const activeRoute = selectedRoute || (routes.length > 0 ? routes[0].id : '');

    // Route KPIs
    const routeKPI = useMemo(() => {
        if (!activeRoute) return null;
        const routeDays = filteredDays
            .map(d => d.byRoute.find(r => r.routeId === activeRoute))
            .filter((r): r is NonNullable<typeof r> => r != null);
        if (routeDays.length === 0) return null;

        const n = routeDays.length;
        return {
            otp: Math.round(routeDays.reduce((s, r) => s + r.otp.onTimePercent, 0) / n * 10) / 10,
            earlyPct: Math.round(routeDays.reduce((s, r) => s + r.otp.earlyPercent, 0) / n * 10) / 10,
            latePct: Math.round(routeDays.reduce((s, r) => s + r.otp.latePercent, 0) / n * 10) / 10,
            ridership: routeDays.reduce((s, r) => s + r.ridership, 0),
            alightings: routeDays.reduce((s, r) => s + r.alightings, 0),
            tripCount: routeDays.reduce((s, r) => s + r.tripCount, 0),
            serviceHours: Math.round(routeDays.reduce((s, r) => s + r.serviceHours, 0) * 10) / 10,
            avgLoad: Math.round(routeDays.reduce((s, r) => s + r.avgLoad, 0) / n * 10) / 10,
            maxLoad: Math.max(...routeDays.map(r => r.maxLoad)),
            wheelchairTrips: routeDays.reduce((s, r) => s + r.wheelchairTrips, 0),
            avgDeviation: Math.round(routeDays.reduce((s, r) => s + r.avgDeviationSeconds, 0) / n),
            bph: (() => {
                const svc = routeDays.reduce((s, r) => s + r.serviceHours, 0);
                const rid = routeDays.reduce((s, r) => s + r.ridership, 0);
                return svc > 0 ? Math.round(rid / svc * 10) / 10 : 0;
            })(),
        };
    }, [filteredDays, activeRoute]);

    // OTP by timepoint (stop-level, filtered to route)
    const timepointOTP = useMemo(() => {
        if (!activeRoute) return [];
        const stopMap = new Map<string, {
            stopName: string; otp: number[]; early: number[]; late: number[];
            deviations: number[]; boardings: number;
        }>();
        for (const day of filteredDays) {
            for (const stop of day.byStop) {
                if (!stop.isTimepoint) continue;
                // Filter to route's stops - check if any trips on this route visit this stop
                const routeTrips = day.byTrip.filter(t => t.routeId === activeRoute);
                if (routeTrips.length === 0) continue;
                // We can't perfectly filter stops by route from byStop (it's system-wide),
                // so we use a heuristic: look at stops that appear in the load profiles for this route
                const routeProfiles = day.loadProfiles.filter(lp => lp.routeId === activeRoute);
                const routeStopIds = new Set(routeProfiles.flatMap(lp => lp.stops.map(s => s.stopId)));
                if (routeStopIds.size > 0 && !routeStopIds.has(stop.stopId)) continue;

                const existing = stopMap.get(stop.stopId) || {
                    stopName: stop.stopName, otp: [], early: [], late: [], deviations: [], boardings: 0,
                };
                existing.otp.push(stop.otp.onTimePercent);
                existing.early.push(stop.otp.earlyPercent);
                existing.late.push(stop.otp.latePercent);
                existing.deviations.push(stop.otp.avgDeviationSeconds);
                existing.boardings += stop.boardings;
                stopMap.set(stop.stopId, existing);
            }
        }
        const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        return Array.from(stopMap.values())
            .map(s => ({
                stopName: s.stopName,
                otp: Math.round(avg(s.otp) * 10) / 10,
                early: Math.round(avg(s.early) * 10) / 10,
                late: Math.round(avg(s.late) * 10) / 10,
                avgDeviation: Math.round(avg(s.deviations)),
                boardings: s.boardings,
            }))
            .sort((a, b) => a.otp - b.otp); // worst first
    }, [filteredDays, activeRoute]);

    // Ridership by stop (from load profiles)
    const stopRidership = useMemo(() => {
        if (!activeRoute) return [];
        const stopMap = new Map<string, { stopName: string; boardings: number; alightings: number; avgLoad: number; count: number }>();
        for (const day of filteredDays) {
            for (const lp of day.loadProfiles) {
                if (lp.routeId !== activeRoute) continue;
                for (const stop of lp.stops) {
                    const existing = stopMap.get(stop.stopId) || {
                        stopName: stop.stopName, boardings: 0, alightings: 0, avgLoad: 0, count: 0,
                    };
                    existing.boardings += stop.avgBoardings * lp.tripCount;
                    existing.alightings += stop.avgAlightings * lp.tripCount;
                    existing.avgLoad += stop.avgLoad;
                    existing.count++;
                    stopMap.set(stop.stopId, existing);
                }
            }
        }
        return Array.from(stopMap.values())
            .map(s => ({
                stopName: s.stopName.length > 25 ? s.stopName.slice(0, 25) + '...' : s.stopName,
                fullName: s.stopName,
                boardings: Math.round(s.boardings),
                alightings: Math.round(s.alightings),
                avgLoad: s.count > 0 ? Math.round(s.avgLoad / s.count * 10) / 10 : 0,
            }))
            .sort((a, b) => b.boardings - a.boardings)
            .slice(0, 20);
    }, [filteredDays, activeRoute]);

    // Daily trend for this route
    const dailyTrend = useMemo(() => {
        if (!activeRoute) return [];
        return filteredDays
            .map(d => {
                const route = d.byRoute.find(r => r.routeId === activeRoute);
                if (!route) return null;
                return {
                    date: d.date.slice(5),
                    fullDate: d.date,
                    otp: route.otp.onTimePercent,
                    ridership: route.ridership,
                };
            })
            .filter((d): d is NonNullable<typeof d> => d != null)
            .sort((a, b) => a.fullDate.localeCompare(b.fullDate));
    }, [filteredDays, activeRoute]);

    // Trip table
    const tripData = useMemo(() => {
        if (!activeRoute) return [];
        const tripMap = new Map<string, {
            tripName: string; block: string; direction: string;
            terminalDepartureTime: string; otp: number[]; boardings: number;
            maxLoad: number; daysObserved: number;
        }>();
        for (const day of filteredDays) {
            for (const t of day.byTrip) {
                if (t.routeId !== activeRoute) continue;
                const existing = tripMap.get(t.tripName) || {
                    tripName: t.tripName, block: t.block, direction: t.direction,
                    terminalDepartureTime: t.terminalDepartureTime,
                    otp: [], boardings: 0, maxLoad: 0, daysObserved: 0,
                };
                existing.otp.push(t.otp.onTimePercent);
                existing.boardings += t.boardings;
                existing.maxLoad = Math.max(existing.maxLoad, t.maxLoad);
                existing.daysObserved++;
                tripMap.set(t.tripName, existing);
            }
        }
        const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        return Array.from(tripMap.values()).map(t => ({
            ...t,
            avgOtp: Math.round(avg(t.otp) * 10) / 10,
            avgBoardings: Math.round(t.boardings / t.daysObserved),
        }));
    }, [filteredDays, activeRoute]);

    const filteredTrips = useMemo(() => {
        let trips = showWorstOnly ? tripData.filter(t => t.avgOtp <= 75) : tripData;
        return [...trips].sort((a, b) => {
            let aVal: string | number, bVal: string | number;
            switch (tripSortField) {
                case 'terminalDepartureTime': aVal = a.terminalDepartureTime; bVal = b.terminalDepartureTime; break;
                case 'block': aVal = a.block; bVal = b.block; break;
                case 'otp': aVal = a.avgOtp; bVal = b.avgOtp; break;
                case 'boardings': aVal = a.avgBoardings; bVal = b.avgBoardings; break;
                case 'maxLoad': aVal = a.maxLoad; bVal = b.maxLoad; break;
            }
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                return tripSortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return tripSortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
        });
    }, [tripData, showWorstOnly, tripSortField, tripSortAsc]);

    const handleTripSort = (field: TripSortField) => {
        if (field === tripSortField) {
            setTripSortAsc(!tripSortAsc);
        } else {
            setTripSortField(field);
            setTripSortAsc(field === 'terminalDepartureTime');
        }
    };

    if (routes.length === 0) {
        return <div className="text-center text-gray-400 py-16">No route data in selected range.</div>;
    }

    const worstCount = tripData.filter(t => t.avgOtp <= 75).length;

    const TripSortHeader: React.FC<{ field: TripSortField; label: string; align?: string }> = ({ field, label, align = 'text-right' }) => (
        <th
            className={`py-2 px-2 font-bold text-gray-500 text-xs uppercase cursor-pointer hover:text-gray-700 ${align}`}
            onClick={() => handleTripSort(field)}
        >
            <span className="inline-flex items-center gap-0.5">
                {label}
                {tripSortField === field && <ArrowUpDown size={10} className="text-cyan-500" />}
            </span>
        </th>
    );

    return (
        <div className="space-y-5">
            {/* Route Selector + Export */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <label className="text-sm font-bold text-gray-700">Route:</label>
                    <select
                        value={activeRoute}
                        onChange={e => setSelectedRoute(e.target.value)}
                        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-300"
                    >
                        {routes.map(r => (
                            <option key={r.id} value={r.id}>{r.id} — {r.name}</option>
                        ))}
                    </select>
                </div>
                <button
                    onClick={async () => {
                        setExporting(true);
                        try { await exportRoutePerformance(filteredDays, activeRoute, startDate, endDate); }
                        finally { setExporting(false); }
                    }}
                    disabled={exporting}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                    <Download size={14} />
                    {exporting ? 'Exporting...' : 'Export to Excel'}
                </button>
            </div>

            {/* 1. KPI Summary */}
            {routeKPI && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    <MetricCard
                        icon={<Clock size={18} />}
                        label="On-Time Performance"
                        value={`${routeKPI.otp}%`}
                        color={routeKPI.otp >= 85 ? 'emerald' : routeKPI.otp >= 75 ? 'amber' : 'red'}
                        subValue={`${routeKPI.earlyPct}% early · ${routeKPI.latePct}% late`}
                    />
                    <MetricCard
                        icon={<Users size={18} />}
                        label="Ridership"
                        value={routeKPI.ridership.toLocaleString()}
                        color="cyan"
                        subValue={`${routeKPI.alightings.toLocaleString()} alightings · BPH ${routeKPI.bph}`}
                    />
                    <MetricCard
                        icon={<Bus size={18} />}
                        label="Trips"
                        value={routeKPI.tripCount.toLocaleString()}
                        color="indigo"
                        subValue={`${routeKPI.serviceHours} svc hrs`}
                    />
                    <MetricCard
                        icon={<AlertTriangle size={18} />}
                        label="Max Load"
                        value={`${routeKPI.maxLoad}`}
                        color="amber"
                        subValue={`Avg load: ${routeKPI.avgLoad}`}
                    />
                    <MetricCard
                        icon={<Clock size={18} />}
                        label="Avg Deviation"
                        value={`${routeKPI.avgDeviation > 0 ? '+' : ''}${Math.round(routeKPI.avgDeviation / 60)} min`}
                        color={Math.abs(routeKPI.avgDeviation) < 180 ? 'emerald' : 'amber'}
                        subValue={`${routeKPI.wheelchairTrips} wheelchair trips`}
                    />
                </div>
            )}

            {/* 2. OTP by Timepoint */}
            {timepointOTP.length > 0 && (
                <ChartCard title="OTP by Timepoint" subtitle="Timepoints ranked by OTP% (worst first)">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Stop</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">OTP%</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Early%</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Late%</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Avg Dev</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Boards</th>
                                </tr>
                            </thead>
                            <tbody>
                                {timepointOTP.map(s => (
                                    <tr key={s.stopName} className={`border-b border-gray-50 hover:bg-gray-50 ${s.otp < 75 ? 'bg-red-50/50' : ''}`}>
                                        <td className="py-2 px-2 font-medium text-gray-700 truncate max-w-[200px]">{s.stopName}</td>
                                        <td className="py-2 px-2 text-right">
                                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                                                s.otp >= 85 ? 'bg-emerald-100 text-emerald-700'
                                                : s.otp >= 75 ? 'bg-amber-100 text-amber-700'
                                                : 'bg-red-100 text-red-700'
                                            }`}>
                                                {s.otp}%
                                            </span>
                                        </td>
                                        <td className="py-2 px-2 text-right text-amber-600 font-medium">{s.early}%</td>
                                        <td className="py-2 px-2 text-right text-red-600 font-medium">{s.late}%</td>
                                        <td className="py-2 px-2 text-right text-gray-600">
                                            {s.avgDeviation > 0 ? '+' : ''}{Math.round(s.avgDeviation / 60)} min
                                        </td>
                                        <td className="py-2 px-2 text-right text-gray-700">{s.boardings.toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </ChartCard>
            )}

            {/* 3. Ridership by Stop */}
            {stopRidership.length > 0 && (
                <ChartCard title="Ridership by Stop" subtitle="Top 20 stops by boardings">
                    <ResponsiveContainer width="100%" height={Math.max(300, stopRidership.length * 28)}>
                        <BarChart data={stopRidership} layout="vertical" margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                            <XAxis type="number" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <YAxis type="category" dataKey="stopName" width={180} tick={{ fontSize: 10, fill: '#6B7280' }} interval={0} />
                            <Tooltip
                                formatter={(v: number, name: string) => [v.toLocaleString(), name === 'boardings' ? 'Boardings' : 'Alightings']}
                                labelFormatter={(label: string) => {
                                    const stop = stopRidership.find(s => s.stopName === label);
                                    return stop?.fullName ?? label;
                                }}
                            />
                            <Bar dataKey="boardings" fill="#06b6d4" radius={[0, 4, 4, 0]} />
                            <Bar dataKey="alightings" fill="#8b5cf6" radius={[0, 4, 4, 0]} opacity={0.6} />
                        </BarChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-4 mt-1">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <span className="inline-block w-3 h-2.5 rounded-sm bg-cyan-500" />
                            Boardings
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <span className="inline-block w-3 h-2.5 rounded-sm bg-purple-500 opacity-60" />
                            Alightings
                        </div>
                    </div>
                </ChartCard>
            )}

            {/* 4. Daily Trend */}
            {dailyTrend.length > 1 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <ChartCard title="OTP Trend" subtitle={`Route ${activeRoute} — ${dailyTrend.length} days`}>
                        <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={dailyTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `${v}%`} />
                                <Tooltip formatter={(v: number) => [`${v}%`, 'OTP']} />
                                <ReferenceLine y={85} stroke="#10b981" strokeDasharray="6 4" />
                                <ReferenceLine y={75} stroke="#f59e0b" strokeDasharray="6 4" />
                                <Line type="monotone" dataKey="otp" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3, fill: '#06b6d4' }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </ChartCard>

                    <ChartCard title="Daily Ridership" subtitle={`Route ${activeRoute} — boardings per day`}>
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={dailyTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                                <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Boardings']} />
                                <Bar dataKey="ridership" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartCard>
                </div>
            )}

            {/* 5. Trip Table */}
            <ChartCard
                title="Trip Performance"
                subtitle={`${filteredTrips.length} trips${showWorstOnly ? ' (worst performers only)' : ''}`}
                headerExtra={
                    worstCount > 0 ? (
                        <button
                            onClick={() => setShowWorstOnly(!showWorstOnly)}
                            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-full transition-colors ${
                                showWorstOnly ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                        >
                            <Filter size={12} />
                            {showWorstOnly ? `Showing ${worstCount} worst` : `${worstCount} below 75%`}
                        </button>
                    ) : undefined
                }
            >
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-white">
                            <tr className="border-b border-gray-100">
                                <TripSortHeader field="terminalDepartureTime" label="Departure" align="text-left" />
                                <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Trip</th>
                                <TripSortHeader field="block" label="Block" align="text-left" />
                                <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Dir</th>
                                <TripSortHeader field="otp" label="OTP%" />
                                <TripSortHeader field="boardings" label="Avg Boards" />
                                <TripSortHeader field="maxLoad" label="Max Load" />
                                <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Days</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredTrips.map(t => (
                                <tr key={t.tripName} className={`border-b border-gray-50 hover:bg-gray-50 ${t.avgOtp <= 75 ? 'bg-red-50/50' : ''}`}>
                                    <td className="py-1.5 px-2 font-medium text-gray-900">{t.terminalDepartureTime}</td>
                                    <td className="py-1.5 px-2 text-gray-500 truncate max-w-[180px]" title={t.tripName}>{t.tripName}</td>
                                    <td className="py-1.5 px-2 text-gray-600">{t.block}</td>
                                    <td className="py-1.5 px-2 text-gray-500">{t.direction}</td>
                                    <td className="py-1.5 px-2 text-right">
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                                            t.avgOtp >= 85 ? 'bg-emerald-100 text-emerald-700'
                                            : t.avgOtp >= 75 ? 'bg-amber-100 text-amber-700'
                                            : 'bg-red-100 text-red-700'
                                        }`}>
                                            {t.avgOtp}%
                                        </span>
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-medium text-gray-700">{t.avgBoardings}</td>
                                    <td className="py-1.5 px-2 text-right font-medium text-gray-700">{t.maxLoad}</td>
                                    <td className="py-1.5 px-2 text-right text-gray-400">{t.daysObserved}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredTrips.length === 0 && (
                        <div className="text-center text-gray-400 py-8 text-sm">
                            {showWorstOnly ? 'No trips below 75% OTP — nice!' : 'No trip data available.'}
                        </div>
                    )}
                </div>
            </ChartCard>
        </div>
    );
};
