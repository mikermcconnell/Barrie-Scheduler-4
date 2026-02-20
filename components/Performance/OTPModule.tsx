import React, { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    ScatterChart, Scatter, Cell, ReferenceLine, LabelList,
} from 'recharts';
import { ChartCard } from '../Analytics/AnalyticsShared';
import type { PerformanceDataSummary, DayType } from '../../utils/performanceDataTypes';
import {
    computeMissedTripsForDay, hasGtfsCoverage,
} from '../../utils/gtfs/gtfsScheduleIndex';

interface OTPModuleProps {
    data: PerformanceDataSummary;
}

const DAY_TYPE_LABELS: Record<DayType, string> = { weekday: 'Weekday', saturday: 'Saturday', sunday: 'Sunday' };
const OTP_COLORS = { early: '#f59e0b', 'on-time': '#22c55e', late: '#ef4444' };

export const OTPModule: React.FC<OTPModuleProps> = ({ data }) => {
    const availableDayTypes = useMemo(() => {
        const types = new Set(data.dailySummaries.map(d => d.dayType));
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [data]);

    const [dayTypeFilter, setDayTypeFilter] = useState<DayType | 'all'>('all');

    const filtered = useMemo(() => {
        if (dayTypeFilter === 'all') return data.dailySummaries;
        return data.dailySummaries.filter(d => d.dayType === dayTypeFilter);
    }, [data, dayTypeFilter]);

    // Route × Hour heatmap data
    const heatmapData = useMemo(() => {
        const routeHours = new Map<string, Map<number, { total: number; onTime: number }>>();
        for (const day of filtered) {
            for (const r of day.byRoute) {
                if (!routeHours.has(r.routeId)) routeHours.set(r.routeId, new Map());
            }
            for (const trip of day.byTrip) {
                const hour = parseInt(trip.terminalDepartureTime.split(':')[0]);
                if (isNaN(hour)) continue;
                const rMap = routeHours.get(trip.routeId);
                if (!rMap) continue;
                const existing = rMap.get(hour) || { total: 0, onTime: 0 };
                existing.total += trip.otp.total;
                existing.onTime += trip.otp.onTime;
                rMap.set(hour, existing);
            }
        }
        const result: { routeId: string; hour: number; otp: number; total: number }[] = [];
        for (const [routeId, hours] of routeHours) {
            for (const [hour, counts] of hours) {
                if (counts.total > 0) {
                    result.push({ routeId, hour, otp: Math.round((counts.onTime / counts.total) * 100), total: counts.total });
                }
            }
        }
        return result;
    }, [filtered]);

    // Route OTP breakdown
    const routeOTP = useMemo(() => {
        const routeMap = new Map<string, { routeId: string; routeName: string; early: number; onTime: number; late: number; total: number; deviations: number[] }>();
        for (const day of filtered) {
            for (const r of day.byRoute) {
                const ex = routeMap.get(r.routeId) || { routeId: r.routeId, routeName: r.routeName, early: 0, onTime: 0, late: 0, total: 0, deviations: [] };
                ex.early += r.otp.early;
                ex.onTime += r.otp.onTime;
                ex.late += r.otp.late;
                ex.total += r.otp.total;
                ex.deviations.push(r.otp.avgDeviationSeconds);
                routeMap.set(r.routeId, ex);
            }
        }
        return Array.from(routeMap.values())
            .map(r => ({
                ...r,
                earlyPct: r.total > 0 ? Math.round((r.early / r.total) * 100) : 0,
                onTimePct: r.total > 0 ? Math.round((r.onTime / r.total) * 100) : 0,
                latePct: r.total > 0 ? Math.round((r.late / r.total) * 100) : 0,
                avgDeviation: r.deviations.length > 0 ? Math.round(r.deviations.reduce((a, b) => a + b, 0) / r.deviations.length) : 0,
            }))
            .sort((a, b) => a.onTimePct - b.onTimePct);
    }, [filtered]);

    // Late trips table
    const lateTrips = useMemo(() => {
        const trips: { date: string; dayType: DayType; tripName: string; routeId: string; block: string; deviation: number }[] = [];
        for (const day of filtered) {
            for (const t of day.byTrip) {
                if (t.otp.late > 0 && t.otp.avgDeviationSeconds > 300) {
                    trips.push({
                        date: day.date,
                        dayType: day.dayType,
                        tripName: t.tripName,
                        routeId: t.routeId,
                        block: t.block,
                        deviation: Math.round(t.otp.avgDeviationSeconds / 60),
                    });
                }
            }
        }
        return trips.sort((a, b) => b.deviation - a.deviation).slice(0, 50);
    }, [filtered]);

    // Hourly OTP pattern
    const hourlyOTP = useMemo(() => {
        const hourMap = new Map<number, { total: number; onTime: number; early: number; late: number }>();
        for (const day of filtered) {
            for (const h of day.byHour) {
                const ex = hourMap.get(h.hour) || { total: 0, onTime: 0, early: 0, late: 0 };
                ex.total += h.otp.total;
                ex.onTime += h.otp.onTime;
                ex.early += h.otp.early;
                ex.late += h.otp.late;
                hourMap.set(h.hour, ex);
            }
        }
        return Array.from(hourMap.entries())
            .map(([hour, c]) => ({
                hour: `${hour.toString().padStart(2, '0')}:00`,
                otp: c.total > 0 ? Math.round((c.onTime / c.total) * 100) : 0,
                earlyPct: c.total > 0 ? Math.round((c.early / c.total) * 100) : 0,
                latePct: c.total > 0 ? Math.round((c.late / c.total) * 100) : 0,
                total: c.total,
            }))
            .sort((a, b) => a.hour.localeCompare(b.hour));
    }, [filtered]);

    // ── Missed trips (GTFS vs STREETS route+time cross-reference) ────
    // Only show missed trips for the most recent day in the dataset (operations = current day focus)
    const missedTripsDay = useMemo(() => {
        if (filtered.length === 0) return null;
        return filtered.reduce((latest, d) => d.date > latest.date ? d : latest, filtered[0]);
    }, [filtered]);

    const missedTrips = useMemo(() => {
        if (!missedTripsDay || !hasGtfsCoverage(missedTripsDay.date)) return [];

        const dayMissed = computeMissedTripsForDay(missedTripsDay.date, missedTripsDay.dayType, missedTripsDay.byTrip);
        if (!dayMissed) return [];

        return dayMissed.trips
            .map(s => ({
                date: missedTripsDay.date,
                routeId: s.routeId,
                departure: s.departure,
                headsign: s.headsign,
                blockId: s.blockId,
                missType: s.missType as 'not_performed' | 'late_over_15',
                lateByMinutes: s.lateByMinutes,
            }))
            .sort((a, b) => {
                const r = a.routeId.localeCompare(b.routeId, undefined, { numeric: true });
                if (r !== 0) return r;
                return a.departure.localeCompare(b.departure);
            });
    }, [missedTripsDay]);

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
                <span className="text-xs font-medium text-gray-500">OTP is calculated from timepoints only (STREETS standard).</span>
            </div>

            {/* Missed Trips Table */}
            {missedTrips.length > 0 && (
                <ChartCard title="Missed Trips" subtitle={`${missedTripsDay?.date} — ${missedTrips.length} trips either not performed or over 15 min late`}>
                    <p className="text-xs text-gray-500 mb-3">
                        <span className="font-medium text-amber-700">These are suspected missed trips for further investigation.</span>
                        <br />
                        Missed-trip categories:
                        {' '}not performed at all (no observed route departure match),
                        {' '}or performed over 15 minutes late.
                        Matching uses route + scheduled departure time (±15 min tolerance).
                    </p>
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white">
                                <tr className="border-b border-gray-100">
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Route</th>
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Departure</th>
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Headsign</th>
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Block</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Late By</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className="bg-gray-50">
                                    <td colSpan={5} className="py-1.5 px-2 text-xs font-bold text-gray-700 uppercase tracking-wide">
                                        Not performed at all ({missedTrips.filter(t => t.missType === 'not_performed').length})
                                    </td>
                                </tr>
                                {missedTrips.filter(t => t.missType === 'not_performed').map((t, i) => (
                                    <tr key={`np-${i}`} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-1.5 px-2 font-bold text-gray-900">{t.routeId}</td>
                                        <td className="py-1.5 px-2 font-medium text-gray-900">{t.departure}</td>
                                        <td className="py-1.5 px-2 text-gray-600">{t.headsign || '—'}</td>
                                        <td className="py-1.5 px-2 text-gray-500 font-mono text-xs">{t.blockId || '—'}</td>
                                        <td className="py-1.5 px-2 text-right text-gray-400">—</td>
                                    </tr>
                                ))}
                                <tr className="bg-amber-50">
                                    <td colSpan={5} className="py-1.5 px-2 text-xs font-bold text-amber-700 uppercase tracking-wide">
                                        Over 15 min late ({missedTrips.filter(t => t.missType === 'late_over_15').length})
                                    </td>
                                </tr>
                                {missedTrips.filter(t => t.missType === 'late_over_15').map((t, i) => (
                                    <tr key={`late-${i}`} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-1.5 px-2 font-bold text-gray-900">{t.routeId}</td>
                                        <td className="py-1.5 px-2 font-medium text-gray-900">{t.departure}</td>
                                        <td className="py-1.5 px-2 text-gray-600">{t.headsign || '—'}</td>
                                        <td className="py-1.5 px-2 text-gray-500 font-mono text-xs">{t.blockId || '—'}</td>
                                        <td className="py-1.5 px-2 text-right font-bold text-amber-700">
                                            {typeof t.lateByMinutes === 'number' ? `+${t.lateByMinutes}m` : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </ChartCard>
            )}

            {/* Hourly OTP Pattern */}
            <ChartCard title="OTP by Hour of Day" subtitle="On-time percentage at each hour (dashed line = 85% target)">
                <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={hourlyOTP} margin={{ top: 16, right: 10, bottom: 5, left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval={1} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `${v}%`} />
                        <Tooltip formatter={(v: number, name: string) => [`${v}%`, name === 'otp' ? 'On-Time' : name]} />
                        <ReferenceLine y={85} stroke="#9CA3AF" strokeDasharray="3 3" label={{ value: '85% target', position: 'insideTopRight', fontSize: 10, fill: '#9CA3AF' }} />
                        <Bar dataKey="otp" fill="#06b6d4" radius={[4, 4, 0, 0]}>
                            <LabelList dataKey="otp" position="top" formatter={(v: number) => `${v}%`} style={{ fontSize: 9, fill: '#6B7280', fontWeight: 600 }} />
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </ChartCard>

            {/* Route OTP Ranking */}
            <ChartCard title="OTP by Route" subtitle="Sorted worst to best — early (amber), on-time (green), late (red)">
                <ResponsiveContainer width="100%" height={Math.max(200, routeOTP.length * 32)}>
                    <BarChart data={routeOTP} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `${v}%`} />
                        <YAxis type="category" dataKey="routeId" width={40} tick={{ fontSize: 11, fontWeight: 600, fill: '#6B7280' }} />
                        <Tooltip formatter={(v: number, name: string) => {
                            const labels: Record<string, string> = { earlyPct: 'Early', onTimePct: 'On-Time', latePct: 'Late' };
                            return [`${v}%`, labels[name] || name];
                        }} />
                        <Bar dataKey="earlyPct" stackId="a" fill={OTP_COLORS.early} />
                        <Bar dataKey="onTimePct" stackId="a" fill={OTP_COLORS['on-time']} />
                        <Bar dataKey="latePct" stackId="a" fill={OTP_COLORS.late} radius={[0, 4, 4, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </ChartCard>

            {/* Late Trips Table */}
            {lateTrips.length > 0 && (
                <ChartCard title="Late Trips" subtitle={`Top ${lateTrips.length} trips by average delay — ${filtered.length} day${filtered.length !== 1 ? 's' : ''} tracked`}>
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white">
                                <tr className="border-b border-gray-100">
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Date</th>
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Day</th>
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Route</th>
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Trip</th>
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Block</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Avg Delay</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lateTrips.map((t, i) => (
                                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-1.5 px-2 text-gray-500">{t.date}</td>
                                        <td className="py-1.5 px-2 text-gray-500">{DAY_TYPE_LABELS[t.dayType]}</td>
                                        <td className="py-1.5 px-2 font-bold text-gray-900">{t.routeId}</td>
                                        <td className="py-1.5 px-2 text-gray-700">{t.tripName}</td>
                                        <td className="py-1.5 px-2 text-gray-500">{t.block}</td>
                                        <td className="py-1.5 px-2 text-right font-bold text-red-600">+{t.deviation} min</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </ChartCard>
            )}

            {/* Data Quality */}
            {filtered.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 space-y-1">
                    <p className="font-medium text-gray-600">Data Quality</p>
                    {filtered.map(d => (
                        <p key={d.date}>
                            {d.date}: {d.dataQuality.totalRecords.toLocaleString()} records,
                            {' '}{d.dataQuality.inBetweenFiltered.toLocaleString()} in-between filtered,
                            {' '}{d.dataQuality.missingAVL.toLocaleString()} missing AVL,
                            {' '}OTP eligible: {d.system.otp.total.toLocaleString()} ({d.system.otp.onTime} on-time, {d.system.otp.early} early, {d.system.otp.late} late = {d.system.otp.onTimePercent.toFixed(1)}%)
                        </p>
                    ))}
                </div>
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
