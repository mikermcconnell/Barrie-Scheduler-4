import React, { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line,
} from 'recharts';
import { Clock, Users, Bus, AlertTriangle, ArrowRight } from 'lucide-react';
import { MetricCard, ChartCard } from '../Analytics/AnalyticsShared';
import type { PerformanceDataSummary, DayType, DailySummary } from '../../utils/performanceDataTypes';

interface SystemOverviewModuleProps {
    data: PerformanceDataSummary;
    onNavigate: (tabId: string) => void;
}

const DAY_TYPE_LABELS: Record<DayType, string> = {
    weekday: 'Weekday',
    saturday: 'Saturday',
    sunday: 'Sunday',
};

export const SystemOverviewModule: React.FC<SystemOverviewModuleProps> = ({ data, onNavigate }) => {
    const availableDayTypes = useMemo(() => {
        const types = new Set(data.dailySummaries.map(d => d.dayType));
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [data]);

    const [dayTypeFilter, setDayTypeFilter] = useState<DayType | 'all'>('all');

    const filtered = useMemo(() => {
        if (dayTypeFilter === 'all') return data.dailySummaries;
        return data.dailySummaries.filter(d => d.dayType === dayTypeFilter);
    }, [data, dayTypeFilter]);

    const systemAvg = useMemo(() => {
        if (filtered.length === 0) return null;
        const totalOTP = filtered.reduce((s, d) => s + d.system.otp.onTimePercent, 0);
        const totalRidership = filtered.reduce((s, d) => s + d.system.totalRidership, 0);
        const totalTrips = filtered.reduce((s, d) => s + d.system.tripCount, 0);
        const avgLoad = filtered.reduce((s, d) => s + d.system.avgSystemLoad, 0) / filtered.length;
        const peakLoad = Math.max(...filtered.map(d => d.system.peakLoad));
        const vehicles = Math.round(filtered.reduce((s, d) => s + d.system.vehicleCount, 0) / filtered.length);
        return {
            otp: Math.round(totalOTP / filtered.length),
            ridership: totalRidership,
            avgRidershipPerDay: Math.round(totalRidership / filtered.length),
            tripCount: totalTrips,
            avgLoad: Math.round(avgLoad),
            peakLoad,
            vehicles,
        };
    }, [filtered]);

    const otpTrend = useMemo(() =>
        filtered.map(d => ({ date: d.date.slice(5), otp: d.system.otp.onTimePercent, ridership: d.system.totalRidership }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        [filtered]
    );

    const routeRanking = useMemo(() => {
        const routeMap = new Map<string, { otp: number[]; ridership: number; routeId: string; routeName: string }>();
        for (const day of filtered) {
            for (const r of day.byRoute) {
                const existing = routeMap.get(r.routeId) || { otp: [], ridership: 0, routeId: r.routeId, routeName: r.routeName };
                existing.otp.push(r.otp.onTimePercent);
                existing.ridership += r.ridership;
                routeMap.set(r.routeId, existing);
            }
        }
        return Array.from(routeMap.values())
            .map(r => ({ ...r, avgOtp: Math.round(r.otp.reduce((a, b) => a + b, 0) / r.otp.length) }))
            .sort((a, b) => b.ridership - a.ridership);
    }, [filtered]);

    if (!systemAvg) {
        return <div className="text-center text-gray-400 py-16">No data for selected filters.</div>;
    }

    return (
        <div className="space-y-6">
            {/* Day Type Filter */}
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Day Type:</span>
                <div className="flex gap-1">
                    <button
                        onClick={() => setDayTypeFilter('all')}
                        className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
                            dayTypeFilter === 'all' ? 'bg-cyan-100 text-cyan-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                    >
                        All ({data.dailySummaries.length})
                    </button>
                    {availableDayTypes.map(dt => (
                        <button
                            key={dt}
                            onClick={() => setDayTypeFilter(dt)}
                            className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
                                dayTypeFilter === dt ? 'bg-cyan-100 text-cyan-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                        >
                            {DAY_TYPE_LABELS[dt]} ({data.dailySummaries.filter(d => d.dayType === dt).length})
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                    icon={<Clock size={18} />}
                    label="On-Time Performance"
                    value={`${systemAvg.otp}%`}
                    color={systemAvg.otp >= 80 ? 'emerald' : systemAvg.otp >= 70 ? 'amber' : 'amber'}
                    subValue={`${filtered.length}-day average`}
                />
                <MetricCard
                    icon={<Users size={18} />}
                    label="Total Ridership"
                    value={systemAvg.ridership.toLocaleString()}
                    color="cyan"
                    subValue={`~${systemAvg.avgRidershipPerDay.toLocaleString()}/day`}
                />
                <MetricCard
                    icon={<Bus size={18} />}
                    label="Vehicles in Service"
                    value={`${systemAvg.vehicles}`}
                    color="indigo"
                    subValue={`${systemAvg.tripCount.toLocaleString()} total trips`}
                />
                <MetricCard
                    icon={<AlertTriangle size={18} />}
                    label="Peak Load"
                    value={`${systemAvg.peakLoad}`}
                    color="amber"
                    subValue={`Avg load: ${systemAvg.avgLoad}`}
                />
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="OTP Trend" subtitle={`${filtered.length}-day trend`}>
                    {otpTrend.length > 1 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={otpTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `${v}%`} />
                                <Tooltip formatter={(v: number) => [`${v}%`, 'OTP']} />
                                <Line type="monotone" dataKey="otp" stroke="#06b6d4" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">
                            Need 2+ days for trend chart
                        </div>
                    )}
                </ChartCard>

                <ChartCard title="Ridership by Route" subtitle="Total boardings across period">
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={routeRanking.slice(0, 12)} layout="vertical" margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                            <XAxis type="number" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <YAxis type="category" dataKey="routeId" width={40} tick={{ fontSize: 11, fontWeight: 600, fill: '#6B7280' }} />
                            <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Boardings']} />
                            <Bar dataKey="ridership" fill="#06b6d4" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            </div>

            {/* Route Table */}
            <ChartCard title="Route Scorecard" subtitle="OTP and ridership by route" headerExtra={
                <button onClick={() => onNavigate('otp')} className="text-xs font-bold text-cyan-600 hover:text-cyan-700 flex items-center gap-1">
                    Detailed OTP <ArrowRight size={12} />
                </button>
            }>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Route</th>
                                <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Name</th>
                                <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">OTP%</th>
                                <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Ridership</th>
                            </tr>
                        </thead>
                        <tbody>
                            {routeRanking.map(r => (
                                <tr key={r.routeId} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="py-2 px-2 font-bold text-gray-900">{r.routeId}</td>
                                    <td className="py-2 px-2 text-gray-500">{r.routeName}</td>
                                    <td className="py-2 px-2 text-right">
                                        <span className={`font-bold ${r.avgOtp >= 80 ? 'text-emerald-600' : r.avgOtp >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                                            {r.avgOtp}%
                                        </span>
                                    </td>
                                    <td className="py-2 px-2 text-right font-medium text-gray-700">{r.ridership.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </ChartCard>
        </div>
    );
};
