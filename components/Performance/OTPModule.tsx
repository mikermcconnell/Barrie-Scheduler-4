import React, { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    ScatterChart, Scatter, Cell, ReferenceLine, LabelList,
    ComposedChart, Line, Area,
} from 'recharts';
import { ChartCard } from '../Analytics/AnalyticsShared';
import type { PerformanceDataSummary, RouteStopDeviationProfile } from '../../utils/performanceDataTypes';
import {
    computeMissedTripsForDay, hasGtfsCoverage,
} from '../../utils/gtfs/gtfsScheduleIndex';

interface OTPModuleProps {
    data: PerformanceDataSummary;
}

const OTP_COLORS = { early: '#f59e0b', 'on-time': '#22c55e', late: '#ef4444' };
const MIN_LATE_TRIP_DAYS = 3;
const MIN_ADHERENCE_DAYS = 3;
const OTP_TARGET_PERCENT = 85;
const DAY_TYPE_LABELS = { weekday: 'Weekday', saturday: 'Saturday', sunday: 'Sunday' } as const;

function parseHourOfDay(raw: string): number | null {
    const value = raw.trim();
    if (!value) return null;
    if (value.includes(':')) {
        const m = value.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
        if (!m) return null;
        const hour = Number.parseInt(m[1], 10);
        return Number.isFinite(hour) && hour >= 0 ? (hour % 24) : null;
    }
    const dec = Number.parseFloat(value);
    if (!Number.isFinite(dec) || dec < 0) return null;
    return Math.floor((((Math.round(dec * 86400) % 86400) + 86400) % 86400) / 3600);
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export const OTPModule: React.FC<OTPModuleProps> = ({ data }) => {
    const filtered = data.dailySummaries;

    // Route × Hour heatmap data
    const heatmapData = useMemo(() => {
        const routeHours = new Map<string, Map<number, { total: number; onTime: number }>>();
        for (const day of filtered) {
            for (const r of day.byRoute) {
                if (!routeHours.has(r.routeId)) routeHours.set(r.routeId, new Map());
            }
            for (const trip of day.byTrip) {
                const hour = parseHourOfDay(trip.terminalDepartureTime);
                if (hour === null) continue;
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
        type LateTripAgg = {
            routeId: string;
            tripName: string;
            dayType: 'weekday' | 'saturday' | 'sunday';
            blockCounts: Map<string, number>;
            observedDayDelaySamples: Map<string, number[]>;
            lateDaySet: Set<string>;
            maxDelayMinutes: number;
            lastLateDate: string;
        };

        const tripMap = new Map<string, LateTripAgg>();

        for (const day of filtered) {
            for (const t of day.byTrip) {
                // Group by route + trip + day type to keep weekday/sat/sun separate.
                const key = `${t.routeId}__${t.tripName}__${day.dayType}`;
                const delay = Math.round(Math.max(0, t.otp.avgDeviationSeconds / 60));
                const isLateDay = t.otp.late > 0 && t.otp.avgDeviationSeconds > 300;
                const existing = tripMap.get(key);

                if (!existing) {
                    const lateDays = new Set<string>();
                    if (isLateDay) lateDays.add(day.date);
                    tripMap.set(key, {
                        routeId: t.routeId,
                        tripName: t.tripName,
                        dayType: day.dayType,
                        blockCounts: new Map([[t.block || '—', 1]]),
                        observedDayDelaySamples: new Map([[day.date, [delay]]]),
                        lateDaySet: lateDays,
                        maxDelayMinutes: isLateDay ? delay : 0,
                        lastLateDate: isLateDay ? day.date : '',
                    });
                } else {
                    const blockKey = t.block || '—';
                    existing.blockCounts.set(blockKey, (existing.blockCounts.get(blockKey) || 0) + 1);
                    const daySamples = existing.observedDayDelaySamples.get(day.date) || [];
                    daySamples.push(delay);
                    existing.observedDayDelaySamples.set(day.date, daySamples);
                    if (isLateDay) {
                        existing.lateDaySet.add(day.date);
                        if (delay > existing.maxDelayMinutes) existing.maxDelayMinutes = delay;
                        if (!existing.lastLateDate || day.date > existing.lastLateDate) existing.lastLateDate = day.date;
                    }
                }

            }
        }

        return Array.from(tripMap.values())
            .filter(t => t.lateDaySet.size >= MIN_LATE_TRIP_DAYS)
            .map(t => {
                const dailyAverages = Array.from(t.observedDayDelaySamples.values())
                    .map(samples => samples.reduce((sum, v) => sum + v, 0) / samples.length);
                const observedDays = t.observedDayDelaySamples.size;
                const lateDays = t.lateDaySet.size;
                const avgDelay = Math.round(dailyAverages.reduce((sum, v) => sum + v, 0) / dailyAverages.length);
                const blocks = Array.from(t.blockCounts.entries()).sort((a, b) => b[1] - a[1]);
                const topBlock = blocks[0]?.[0] || '—';
                const blockLabel = blocks.length <= 1 ? topBlock : `${topBlock} +${blocks.length - 1}`;
                return {
                    routeId: t.routeId,
                    tripName: t.tripName,
                    dayType: t.dayType,
                    block: blockLabel,
                    observedDays,
                    lateDays,
                    avgDelay,
                    maxDelay: t.maxDelayMinutes,
                    lastLateDate: t.lastLateDate || '—',
                };
            })
            .sort((a, b) => {
                const avgCmp = b.avgDelay - a.avgDelay;
                if (avgCmp !== 0) return avgCmp;
                const dayCmp = b.lateDays - a.lateDays;
                if (dayCmp !== 0) return dayCmp;
                const observedCmp = b.observedDays - a.observedDays;
                if (observedCmp !== 0) return observedCmp;
                return b.maxDelay - a.maxDelay;
            })
            .slice(0, 50);
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
            .filter(([, c]) => c.total > 0)
            .map(([hour, c]) => ({
                hour: `${hour.toString().padStart(2, '0')}:00`,
                otp: Math.round((c.onTime / c.total) * 100),
                earlyPct: Math.round((c.early / c.total) * 100),
                latePct: Math.round((c.late / c.total) * 100),
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

    // ── Schedule Adherence Profile ──────────────────────────────────────
    const hasAnyRouteStopDeviationPayload = useMemo(
        () => filtered.some(day => Array.isArray(day.routeStopDeviations)),
        [filtered]
    );

    const routeDirectionCoverage = useMemo(() => {
        const counts = new Map<string, number>();
        for (const day of filtered) {
            if (!day.routeStopDeviations || day.routeStopDeviations.length === 0) continue;
            const seen = new Set<string>();
            for (const profile of day.routeStopDeviations) {
                const key = `${profile.routeId}||${profile.direction}`;
                if (seen.has(key)) continue;
                seen.add(key);
                counts.set(key, (counts.get(key) || 0) + 1);
            }
        }
        return counts;
    }, [filtered]);

    const availableRouteDirections = useMemo(() => {
        const set = new Map<string, { routeId: string; directions: Set<string> }>();
        for (const key of routeDirectionCoverage.keys()) {
            const [routeId, direction] = key.split('||');
            const existing = set.get(routeId);
            if (existing) {
                existing.directions.add(direction);
            } else {
                set.set(routeId, { routeId, directions: new Set([direction]) });
            }
        }
        return Array.from(set.values())
            .sort((a, b) => a.routeId.localeCompare(b.routeId, undefined, { numeric: true }))
            .map(r => ({ routeId: r.routeId, directions: Array.from(r.directions).sort() }));
    }, [routeDirectionCoverage]);

    const routeCoverageByRoute = useMemo(() => {
        const routeDays = new Map<string, number>();
        for (const [key, days] of routeDirectionCoverage) {
            const [routeId] = key.split('||');
            const existing = routeDays.get(routeId) ?? 0;
            if (days > existing) routeDays.set(routeId, days);
        }
        return routeDays;
    }, [routeDirectionCoverage]);

    const defaultRouteDirection = useMemo(() => {
        const ranked = Array.from(routeDirectionCoverage.entries()).sort((a, b) => {
            const dayCmp = b[1] - a[1];
            if (dayCmp !== 0) return dayCmp;
            const [aRoute, aDir] = a[0].split('||');
            const [bRoute, bDir] = b[0].split('||');
            const routeCmp = aRoute.localeCompare(bRoute, undefined, { numeric: true });
            if (routeCmp !== 0) return routeCmp;
            return aDir.localeCompare(bDir);
        });
        if (ranked.length === 0) return { routeId: '', direction: '' };
        const preferred = ranked.find(([, days]) => days >= MIN_ADHERENCE_DAYS) ?? ranked[0];
        const [routeId, direction] = preferred[0].split('||');
        return { routeId, direction };
    }, [routeDirectionCoverage]);

    const [selectedRoute, setSelectedRoute] = useState<string>('');
    const [selectedDirection, setSelectedDirection] = useState<string>('');

    // Keep selection valid when filters change and previously selected routes disappear.
    const activeRoute = useMemo(() => {
        if (selectedRoute && availableRouteDirections.some(r => r.routeId === selectedRoute)) {
            return selectedRoute;
        }
        if (defaultRouteDirection.routeId) return defaultRouteDirection.routeId;
        return availableRouteDirections[0]?.routeId ?? '';
    }, [selectedRoute, availableRouteDirections, defaultRouteDirection.routeId]);
    const directionsForRoute = useMemo(
        () => availableRouteDirections.find(r => r.routeId === activeRoute)?.directions ?? [],
        [availableRouteDirections, activeRoute]
    );
    const activeDirection = useMemo(() => {
        if (selectedDirection && directionsForRoute.includes(selectedDirection)) return selectedDirection;
        if (
            activeRoute === defaultRouteDirection.routeId &&
            defaultRouteDirection.direction &&
            directionsForRoute.includes(defaultRouteDirection.direction)
        ) {
            return defaultRouteDirection.direction;
        }
        return directionsForRoute[0] ?? '';
    }, [selectedDirection, directionsForRoute, activeRoute, defaultRouteDirection.routeId, defaultRouteDirection.direction]);

    const adherenceProfile = useMemo(() => {
        if (!activeRoute || !activeDirection) return null;

        // Pool deviations across all filtered days for this route+direction
        const stopMap = new Map<string, { stopName: string; stopId: string; routeStopIndex: number; deviations: number[] }>();
        let daysWithData = 0;

        for (const day of filtered) {
            if (!day.routeStopDeviations) continue;
            const profile = day.routeStopDeviations.find(
                (p: RouteStopDeviationProfile) => p.routeId === activeRoute && p.direction === activeDirection
            );
            if (!profile) continue;
            daysWithData++;
            for (const stop of profile.stops) {
                const existing = stopMap.get(stop.stopId);
                if (existing) {
                    existing.deviations.push(...stop.deviations);
                } else {
                    stopMap.set(stop.stopId, {
                        stopName: stop.stopName,
                        stopId: stop.stopId,
                        routeStopIndex: stop.routeStopIndex,
                        deviations: [...stop.deviations],
                    });
                }
            }
        }

        if (daysWithData < MIN_ADHERENCE_DAYS) return { insufficientData: true as const, daysWithData };

        const stops = Array.from(stopMap.values())
            .sort((a, b) => a.routeStopIndex - b.routeStopIndex)
            .map(s => {
                const sorted = [...s.deviations].sort((a, b) => a - b);
                return {
                    stopName: s.stopName,
                    medianMinutes: Math.round(percentile(sorted, 50) / 60 * 10) / 10,
                    p25Minutes: Math.round(percentile(sorted, 25) / 60 * 10) / 10,
                    p75Minutes: Math.round(percentile(sorted, 75) / 60 * 10) / 10,
                    observations: sorted.length,
                };
            });

        const totalObs = stops.reduce((sum, s) => sum + s.observations, 0);
        const avgObsPerStop = stops.length > 0 ? Math.round(totalObs / stops.length) : 0;

        return { insufficientData: false as const, daysWithData, stops, avgObsPerStop };
    }, [filtered, activeRoute, activeDirection]);

    return (
        <div className="space-y-6">
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
            <ChartCard title="OTP by Route" subtitle="On-time % by route (ranked worst to best), dashed line = 85% target">
                {routeOTP.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-sm text-gray-400">
                        No route OTP data available for this filter selection
                    </div>
                ) : (
                    <>
                        <ResponsiveContainer width="100%" height={Math.max(220, routeOTP.length * 30)}>
                            <BarChart data={routeOTP} layout="vertical" margin={{ top: 6, right: 46, bottom: 6, left: 6 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `${v}%`} />
                                <YAxis type="category" dataKey="routeId" width={44} tick={{ fontSize: 11, fontWeight: 700, fill: '#6B7280' }} />
                                <Tooltip
                                    formatter={(v: number, name: string) => {
                                        const labels: Record<string, string> = { onTimePct: 'On-Time', latePct: 'Late', earlyPct: 'Early' };
                                        return [`${v}%`, labels[name] || name];
                                    }}
                                    labelFormatter={(routeId: string, payload: any[]) => {
                                        const row = payload?.[0]?.payload;
                                        if (!row) return `Route ${routeId}`;
                                        return row.routeName ? `Route ${routeId} — ${row.routeName}` : `Route ${routeId}`;
                                    }}
                                />
                                <ReferenceLine
                                    x={OTP_TARGET_PERCENT}
                                    stroke="#9CA3AF"
                                    strokeDasharray="4 4"
                                    label={{ value: `${OTP_TARGET_PERCENT}% target`, position: 'insideTopRight', fontSize: 10, fill: '#9CA3AF' }}
                                />
                                <Bar dataKey="onTimePct" radius={[0, 4, 4, 0]}>
                                    {routeOTP.map(r => (
                                        <Cell
                                            key={`route-otp-${r.routeId}`}
                                            fill={r.onTimePct >= OTP_TARGET_PERCENT ? '#16a34a' : r.onTimePct >= 75 ? '#f59e0b' : '#ef4444'}
                                        />
                                    ))}
                                    <LabelList
                                        dataKey="onTimePct"
                                        position="right"
                                        formatter={(v: number) => `${v}%`}
                                        style={{ fontSize: 10, fill: '#6B7280', fontWeight: 700 }}
                                    />
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                            <span className="inline-flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-green-600" />
                                Meets target (≥ {OTP_TARGET_PERCENT}%)
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                                Watchlist (75-84%)
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                                Below 75%
                            </span>
                        </div>
                    </>
                )}
            </ChartCard>

            {/* Schedule Adherence Profile */}
            <ChartCard
                title="Schedule Adherence Profile"
                subtitle={
                    availableRouteDirections.length === 0
                        ? (hasAnyRouteStopDeviationPayload
                            ? 'No route/timepoint deviation data available in the current filter selection'
                            : 'This import does not include route timepoint deviations for schedule-adherence charting')
                        : adherenceProfile && !adherenceProfile.insufficientData
                            ? `Median of ${adherenceProfile.avgObsPerStop} observations per stop across ${adherenceProfile.daysWithData} days`
                            : 'Median deviation at each timepoint stop along a route'
                }
            >
                {availableRouteDirections.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-sm text-gray-400 text-center">
                        {hasAnyRouteStopDeviationPayload ? (
                            <>
                                No schedule-adherence data for this time range/day type.
                                <br />
                                Try a broader time range or set Day Type to All.
                            </>
                        ) : (
                            <>
                                This dataset was imported before route timepoint deviations were stored.
                                <br />
                                Re-import STREETS data to populate Schedule Adherence.
                            </>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-3 mb-4">
                            <label className="text-xs font-medium text-gray-500 uppercase">Route</label>
                            <select
                                className="border border-gray-200 rounded px-2 py-1 text-sm bg-white"
                                value={activeRoute}
                                onChange={e => { setSelectedRoute(e.target.value); setSelectedDirection(''); }}
                            >
                                {availableRouteDirections.map(r => (
                                    <option key={r.routeId} value={r.routeId}>
                                        {r.routeId} ({routeCoverageByRoute.get(r.routeId) ?? 0}d)
                                    </option>
                                ))}
                            </select>
                            <label className="text-xs font-medium text-gray-500 uppercase">Direction</label>
                            <select
                                className="border border-gray-200 rounded px-2 py-1 text-sm bg-white"
                                value={activeDirection}
                                onChange={e => setSelectedDirection(e.target.value)}
                            >
                                {directionsForRoute.map(d => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                        </div>
                        {adherenceProfile?.insufficientData ? (
                            <div className="flex items-center justify-center h-48 text-sm text-gray-400">
                                Insufficient data — need at least {MIN_ADHERENCE_DAYS} days ({adherenceProfile.daysWithData} available for this route/direction)
                            </div>
                        ) : adherenceProfile && adherenceProfile.stops.length > 0 ? (
                            <ResponsiveContainer width="100%" height={320}>
                                <ComposedChart data={adherenceProfile.stops} margin={{ top: 16, right: 20, bottom: 60, left: 10 }}>
                                    <defs>
                                        <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.15} />
                                            <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.05} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                                    <XAxis
                                        dataKey="stopName"
                                        tick={{ fontSize: 9, fill: '#9CA3AF' }}
                                        angle={-35}
                                        textAnchor="end"
                                        interval={0}
                                        height={80}
                                    />
                                    <YAxis
                                        tick={{ fontSize: 10, fill: '#9CA3AF' }}
                                        tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v}`}
                                        label={{ value: 'Minutes', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#9CA3AF' }}
                                    />
                                    <Tooltip
                                        formatter={(v: number, name: string) => {
                                            const labels: Record<string, string> = { medianMinutes: 'Median', p25Minutes: 'P25', p75Minutes: 'P75' };
                                            return [`${v > 0 ? '+' : ''}${v} min`, labels[name] || name];
                                        }}
                                        labelFormatter={(label: string) => label}
                                    />
                                    <ReferenceLine y={0} stroke="#6B7280" strokeDasharray="4 4" label={{ value: 'On Schedule', position: 'insideTopRight', fontSize: 9, fill: '#6B7280' }} />
                                    <Area
                                        type="monotone"
                                        dataKey="p75Minutes"
                                        stroke="none"
                                        fill="url(#bandFill)"
                                        isAnimationActive={false}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="p25Minutes"
                                        stroke="none"
                                        fill="white"
                                        isAnimationActive={false}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="medianMinutes"
                                        stroke="#06b6d4"
                                        strokeWidth={2}
                                        dot={{ r: 3, fill: '#06b6d4' }}
                                        activeDot={{ r: 5 }}
                                    />
                                </ComposedChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-48 text-sm text-gray-400">
                                No deviation data available for this route/direction
                            </div>
                        )}
                    </>
                )}
            </ChartCard>

            {/* Late Trips Table */}
            {lateTrips.length > 0 && (
                <ChartCard title="Late Trips" subtitle={`Top ${lateTrips.length} recurring trips by multi-day average delay — ${filtered.length} day${filtered.length !== 1 ? 's' : ''} tracked · min ${MIN_LATE_TRIP_DAYS} late days`}>
                    <p className="text-xs text-gray-500 mb-3">
                        Avg Delay is calculated from all observed days for each trip/day-type. Late Days are days with more than 5 minutes average delay.
                    </p>
                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-white">
                                <tr className="border-b border-gray-100">
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Route</th>
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Day Type</th>
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Trip</th>
                                    <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Block</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Observed Days</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Late Days</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Avg Delay</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Max Delay</th>
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Last Late</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lateTrips.map((t, i) => (
                                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-1.5 px-2 font-bold text-gray-900">{t.routeId}</td>
                                        <td className="py-1.5 px-2 text-gray-500">{DAY_TYPE_LABELS[t.dayType]}</td>
                                        <td className="py-1.5 px-2 text-gray-700">{t.tripName}</td>
                                        <td className="py-1.5 px-2 text-gray-500">{t.block}</td>
                                        <td className="py-1.5 px-2 text-right font-semibold text-gray-700">{t.observedDays}</td>
                                        <td className="py-1.5 px-2 text-right font-semibold text-gray-700">{t.lateDays}</td>
                                        <td className="py-1.5 px-2 text-right font-bold text-red-600">+{t.avgDelay} min</td>
                                        <td className="py-1.5 px-2 text-right font-semibold text-red-500">+{t.maxDelay} min</td>
                                        <td className="py-1.5 px-2 text-right text-gray-500">{t.lastLateDate}</td>
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
