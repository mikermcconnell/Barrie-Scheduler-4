import React, { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, Legend,
} from 'recharts';
import { ChartCard } from '../Analytics/AnalyticsShared';
import { RidershipHeatmapSection } from './RidershipHeatmapSection';
import type { PerformanceDataSummary, DayType } from '../../utils/performanceDataTypes';

interface RidershipModuleProps {
    data: PerformanceDataSummary;
}

const DAY_TYPE_LABELS: Record<DayType, string> = { weekday: 'Weekday', saturday: 'Saturday', sunday: 'Sunday' };
const ROUTE_COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e', '#ec4899', '#3b82f6', '#14b8a6', '#f97316', '#6366f1', '#a855f7', '#84cc16'];

export const RidershipModule: React.FC<RidershipModuleProps> = ({ data }) => {
    const availableDayTypes = useMemo(() => {
        const types = new Set(data.dailySummaries.map(d => d.dayType));
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [data]);

    const [dayTypeFilter, setDayTypeFilter] = useState<DayType | 'all'>('all');

    const filtered = useMemo(() => {
        if (dayTypeFilter === 'all') return data.dailySummaries;
        return data.dailySummaries.filter(d => d.dayType === dayTypeFilter);
    }, [data, dayTypeFilter]);

    // Daily ridership trend
    const dailyTrend = useMemo(() =>
        filtered.map(d => ({
            date: d.date.slice(5),
            ridership: d.system.totalRidership,
            boardings: d.system.totalBoardings,
        })).sort((a, b) => a.date.localeCompare(b.date)),
        [filtered]
    );

    // Route ridership ranking
    const routeRanking = useMemo(() => {
        const routeMap = new Map<string, { routeId: string; routeName: string; ridership: number; days: number }>();
        for (const day of filtered) {
            for (const r of day.byRoute) {
                const ex = routeMap.get(r.routeId) || { routeId: r.routeId, routeName: r.routeName, ridership: 0, days: 0 };
                ex.ridership += r.ridership;
                ex.days++;
                routeMap.set(r.routeId, ex);
            }
        }
        return Array.from(routeMap.values())
            .map(r => ({ ...r, avgPerDay: Math.round(r.ridership / r.days) }))
            .sort((a, b) => b.ridership - a.ridership);
    }, [filtered]);

    // Hourly distribution
    const hourlyDist = useMemo(() => {
        const hourMap = new Map<number, { boardings: number; alightings: number; days: number }>();
        for (const day of filtered) {
            for (const h of day.byHour) {
                const ex = hourMap.get(h.hour) || { boardings: 0, alightings: 0, days: 0 };
                ex.boardings += h.boardings;
                ex.alightings += h.alightings;
                ex.days++;
                hourMap.set(h.hour, ex);
            }
        }
        return Array.from(hourMap.entries())
            .map(([hour, c]) => ({
                hour: `${hour.toString().padStart(2, '0')}:00`,
                avgBoardings: Math.round(c.boardings / (c.days || 1)),
                avgAlightings: Math.round(c.alightings / (c.days || 1)),
            }))
            .sort((a, b) => a.hour.localeCompare(b.hour));
    }, [filtered]);

    // Route daily trend (multi-line)
    const routeDailyTrend = useMemo(() => {
        const dateMap = new Map<string, Record<string, number>>();
        const routeIds = new Set<string>();
        for (const day of filtered) {
            const entry: Record<string, number> = { date: 0 };
            for (const r of day.byRoute) {
                entry[r.routeId] = r.ridership;
                routeIds.add(r.routeId);
            }
            dateMap.set(day.date, entry);
        }
        const dates = Array.from(dateMap.keys()).sort();
        return {
            data: dates.map(date => ({ date: date.slice(5), ...dateMap.get(date) })),
            routeIds: Array.from(routeIds).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        };
    }, [filtered]);

    return (
        <div className="space-y-6">
            {/* Day Type Filter */}
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Day Type:</span>
                <div className="flex gap-1">
                    <FilterPill active={dayTypeFilter === 'all'} onClick={() => setDayTypeFilter('all')}>All</FilterPill>
                    {availableDayTypes.map(dt => (
                        <FilterPill key={dt} active={dayTypeFilter === dt} onClick={() => setDayTypeFilter(dt)}>
                            {DAY_TYPE_LABELS[dt]}
                        </FilterPill>
                    ))}
                </div>
            </div>

            {/* Daily Ridership Trend */}
            <ChartCard title="Daily Ridership" subtitle="Total boardings per day">
                {dailyTrend.length > 1 ? (
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={dailyTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Boardings']} />
                            <Bar dataKey="ridership" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={dailyTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Boardings']} />
                            <Bar dataKey="ridership" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </ChartCard>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Route Ranking */}
                <ChartCard title="Ridership by Route" subtitle="Total and daily average">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Route</th>
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Name</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Total</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Avg/Day</th>
                                </tr>
                            </thead>
                            <tbody>
                                {routeRanking.map((r, i) => (
                                    <tr key={r.routeId} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-1.5 px-2 font-bold text-gray-900">{r.routeId}</td>
                                        <td className="py-1.5 px-2 text-gray-500 truncate max-w-[120px]">{r.routeName}</td>
                                        <td className="py-1.5 px-2 text-right font-medium text-gray-700">{r.ridership.toLocaleString()}</td>
                                        <td className="py-1.5 px-2 text-right text-gray-500">{r.avgPerDay.toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </ChartCard>

                {/* Hourly Distribution */}
                <ChartCard title="Hourly Boarding Pattern" subtitle="Average boardings by hour of day">
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={hourlyDist} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval={1} />
                            <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <Tooltip />
                            <Bar dataKey="avgBoardings" name="Boardings" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="avgAlightings" name="Alightings" fill="#a78bfa" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            </div>

            {/* Multi-route trend */}
            {routeDailyTrend.data.length > 1 && (
                <ChartCard title="Route Ridership Trends" subtitle="Daily boardings per route">
                    <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={routeDailyTrend.data} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <Tooltip />
                            <Legend wrapperStyle={{ fontSize: 11 }} />
                            {routeDailyTrend.routeIds.map((id, i) => (
                                <Line key={id} type="monotone" dataKey={id} stroke={ROUTE_COLORS[i % ROUTE_COLORS.length]} strokeWidth={1.5} dot={false} />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </ChartCard>
            )}

            {/* Stop × Trip Heatmap */}
            <RidershipHeatmapSection data={data} />
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
