import React, { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, PieChart, Pie, Cell, ReferenceLine, ComposedChart,
} from 'recharts';
import {
    Clock, Users, Bus, AlertTriangle, ArrowRight,
    CheckCircle, Calendar, Database, ClipboardList,
} from 'lucide-react';
import { MetricCard, ChartCard } from '../Analytics/AnalyticsShared';
import type { PerformanceDataSummary, DayType, DailySummary, DataQuality } from '../../utils/performanceDataTypes';
import { getScheduledTrips, hasGtfsCoverage, bestFitScheduledTrips, type ScheduledTrip } from '../../utils/gtfs/gtfsScheduleIndex';

interface SystemOverviewModuleProps {
    data: PerformanceDataSummary;
    onNavigate: (tabId: string) => void;
}

const DAY_TYPE_LABELS: Record<DayType, string> = {
    weekday: 'Weekday',
    saturday: 'Saturday',
    sunday: 'Sunday',
};

const DONUT_COLORS = { early: '#f59e0b', onTime: '#10b981', late: '#ef4444' };

/** BPH color: ≥30 emerald, ≤10 red, linear interpolation in between. */
function bphColor(value: number): string {
    if (value >= 30) return '#10b981'; // emerald-500
    if (value <= 10) return '#ef4444'; // red-500
    // 10–30 range: red → amber → emerald
    const t = (value - 10) / 20; // 0..1
    if (t < 0.5) {
        // red → amber (0..0.5)
        const r = 239, g = Math.round(68 + (158 - 68) * (t * 2)), b = Math.round(68 + (11 - 68) * (t * 2));
        return `rgb(${r},${g},${b})`;
    }
    // amber → emerald (0.5..1)
    const s = (t - 0.5) * 2;
    const r = Math.round(245 + (16 - 245) * s), g = Math.round(158 + (185 - 158) * s), b = Math.round(11 + (129 - 11) * s);
    return `rgb(${r},${g},${b})`;
}

function formatDateShort(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateRange(start: string, end: string): string {
    const s = new Date(start + 'T12:00:00');
    const e = new Date(end + 'T12:00:00');
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`;
}

function freshness(importedAt: string): string {
    const diff = Date.now() - new Date(importedAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `Updated ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `Updated ${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `Updated ${days}d ago`;
}

function countMatches(scheduled: ScheduledTrip[], observedIds: Set<string>): number {
    let n = 0;
    for (const s of scheduled) {
        if (observedIds.has(s.tripId)) n++;
    }
    return n;
}

export const SystemOverviewModule: React.FC<SystemOverviewModuleProps> = ({ data, onNavigate }) => {
    const [selectedDate, setSelectedDate] = useState<string>('all');
    const [dayTypeFilter, setDayTypeFilter] = useState<DayType | 'all'>('all');

    const sortedDates = useMemo(() =>
        [...new Set(data.dailySummaries.map(d => d.date))].sort(),
        [data]
    );

    const availableDayTypes = useMemo(() => {
        const types = new Set(data.dailySummaries.map(d => d.dayType));
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [data]);

    // ── Filtered data ──────────────────────────────────────────────
    const filtered = useMemo(() => {
        let result = data.dailySummaries;
        if (selectedDate !== 'all') {
            result = result.filter(d => d.date === selectedDate);
        }
        if (dayTypeFilter !== 'all') {
            result = result.filter(d => d.dayType === dayTypeFilter);
        }
        return result;
    }, [data, selectedDate, dayTypeFilter]);

    // ── System averages (expanded) ─────────────────────────────────
    const systemAvg = useMemo(() => {
        if (filtered.length === 0) return null;
        const n = filtered.length;
        const totalOTP = filtered.reduce((s, d) => s + d.system.otp.onTimePercent, 0);
        const totalEarly = filtered.reduce((s, d) => s + d.system.otp.earlyPercent, 0);
        const totalLate = filtered.reduce((s, d) => s + d.system.otp.latePercent, 0);
        const totalRidership = filtered.reduce((s, d) => s + d.system.totalRidership, 0);
        const totalAlightings = filtered.reduce((s, d) => s + d.system.totalAlightings, 0);
        const totalTrips = filtered.reduce((s, d) => s + d.system.tripCount, 0);
        const avgLoad = filtered.reduce((s, d) => s + d.system.avgSystemLoad, 0) / n;
        const peakLoad = Math.max(...filtered.map(d => d.system.peakLoad));
        const vehicles = Math.round(filtered.reduce((s, d) => s + d.system.vehicleCount, 0) / n);
        return {
            otp: Math.round(totalOTP / n),
            earlyPct: Math.round(totalEarly / n),
            latePct: Math.round(totalLate / n),
            ridership: totalRidership,
            alightings: totalAlightings,
            avgRidershipPerDay: Math.round(totalRidership / n),
            tripCount: totalTrips,
            avgLoad: Math.round(avgLoad),
            peakLoad,
            vehicles,
        };
    }, [filtered]);

    // ── OTP donut data ─────────────────────────────────────────────
    const otpDonutData = useMemo(() => {
        if (filtered.length === 0) return [];
        const early = filtered.reduce((s, d) => s + d.system.otp.early, 0);
        const onTime = filtered.reduce((s, d) => s + d.system.otp.onTime, 0);
        const late = filtered.reduce((s, d) => s + d.system.otp.late, 0);
        return [
            { name: 'Early', value: early, color: DONUT_COLORS.early },
            { name: 'On Time', value: onTime, color: DONUT_COLORS.onTime },
            { name: 'Late', value: late, color: DONUT_COLORS.late },
        ];
    }, [filtered]);

    // ── Attention items (trending, not one-offs) ──────────────────
    const attentionItems = useMemo(() => {
        const totalDays = filtered.length;
        const routeMap = new Map<string, { routeId: string; routeName: string; otp: number[]; late: number[]; daysBelowTarget: number }>();
        for (const day of filtered) {
            for (const r of day.byRoute) {
                const existing = routeMap.get(r.routeId) || { routeId: r.routeId, routeName: r.routeName, otp: [], late: [], daysBelowTarget: 0 };
                existing.otp.push(r.otp.onTimePercent);
                existing.late.push(r.otp.latePercent);
                if (r.otp.onTimePercent < 80) existing.daysBelowTarget++;
                routeMap.set(r.routeId, existing);
            }
        }
        const worstRoutes = Array.from(routeMap.values())
            .map(r => ({
                routeId: r.routeId,
                routeName: r.routeName,
                avgOtp: Math.round(r.otp.reduce((a, b) => a + b, 0) / r.otp.length),
                avgLate: Math.round(r.late.reduce((a, b) => a + b, 0) / r.late.length),
                daysBelowTarget: r.daysBelowTarget,
                totalDays: r.otp.length,
            }))
            .filter(r => r.avgOtp < 80 && (totalDays === 1 || r.daysBelowTarget >= 2))
            .sort((a, b) => a.avgOtp - b.avgOtp)
            .slice(0, 3);

        // Late-running trips: only flag if late on 2+ days (skip one-offs)
        const tripMap = new Map<string, { tripName: string; routeId: string; deviations: number[]; daysLate: number }>();
        for (const day of filtered) {
            for (const t of day.byTrip) {
                if (t.otp.avgDeviationSeconds > 0) {
                    const existing = tripMap.get(t.tripName) || { tripName: t.tripName, routeId: t.routeId, deviations: [], daysLate: 0 };
                    existing.deviations.push(t.otp.avgDeviationSeconds);
                    if (t.otp.avgDeviationSeconds > 300) existing.daysLate++;
                    tripMap.set(t.tripName, existing);
                }
            }
        }
        const lateTrips = Array.from(tripMap.values())
            .map(t => ({
                tripName: t.tripName,
                routeId: t.routeId,
                avgDelay: Math.round(t.deviations.reduce((a, b) => a + b, 0) / t.deviations.length / 60),
                daysLate: t.daysLate,
                totalDays: t.deviations.length,
            }))
            .filter(t => t.avgDelay > 5 && (totalDays === 1 || t.daysLate >= 2))
            .sort((a, b) => b.avgDelay - a.avgDelay)
            .slice(0, 2);

        return { worstRoutes, lateTrips };
    }, [filtered]);

    // ── Missed trips (GTFS vs STREETS cross-reference) ────────────
    // 1. Only count routes that have ≥1 observed trip in STREETS (route-scoping).
    //    Routes absent from STREETS weren't extracted — not "missed."
    // Holiday handling (Option D):
    //  1. ONTARIO_HOLIDAYS in gtfsScheduleIndex overrides dayType for known holidays
    //  2. If primary match rate < 25%, best-fit tries all 3 service types
    //  3. Only routes present in STREETS extract are counted (route-scoping)
    const missedTrips = useMemo(() => {
        let totalScheduled = 0;
        let totalMatched = 0;
        const missedByRoute = new Map<string, { routeId: string; count: number; earliestDep: string }>();
        let hasCoverage = false;
        let skippedDays = 0;

        for (const day of filtered) {
            if (!hasGtfsCoverage(day.date)) continue;
            hasCoverage = true;

            const observedRoutes = new Set(day.byTrip.map(t => t.routeId));
            const observedIds = new Set(day.byTrip.map(t => t.tripId));

            // Primary attempt: uses holiday calendar + STREETS dayType
            let scheduled = getScheduledTrips(day.date, day.dayType);
            let relevantScheduled = scheduled.filter(s => observedRoutes.has(s.routeId));
            let dayMatched = countMatches(relevantScheduled, observedIds);

            // Best-fit fallback: if < 25% matched, try all service types
            if (relevantScheduled.length > 0 && dayMatched / relevantScheduled.length < 0.25) {
                const bestFit = bestFitScheduledTrips(day.date, observedIds);
                if (bestFit && bestFit.matchCount > dayMatched) {
                    scheduled = bestFit.trips;
                    relevantScheduled = scheduled.filter(s => observedRoutes.has(s.routeId));
                    dayMatched = countMatches(relevantScheduled, observedIds);
                }
            }

            // If still < 25% after best-fit, skip (no reliable GTFS match at all)
            if (relevantScheduled.length === 0 ||
                dayMatched / relevantScheduled.length < 0.25) {
                skippedDays++;
                continue;
            }

            totalScheduled += relevantScheduled.length;
            totalMatched += dayMatched;

            for (const s of relevantScheduled) {
                if (observedIds.has(s.tripId)) continue;
                const existing = missedByRoute.get(s.routeId);
                if (existing) {
                    existing.count++;
                    if (s.departure < existing.earliestDep) existing.earliestDep = s.departure;
                } else {
                    missedByRoute.set(s.routeId, { routeId: s.routeId, count: 1, earliestDep: s.departure });
                }
            }
        }

        const totalMissed = totalScheduled - totalMatched;
        const missedPct = totalScheduled > 0 ? (totalMissed / totalScheduled) * 100 : 0;
        const routesMissed = Array.from(missedByRoute.values()).sort((a, b) => b.count - a.count);

        return { hasCoverage, totalScheduled, totalObserved: totalMatched, totalMissed, missedPct, routesMissed, skippedDays };
    }, [filtered]);

    // ── OTP trend ──────────────────────────────────────────────────
    const otpTrend = useMemo(() =>
        filtered.map(d => ({
            date: d.date.slice(5),
            otp: d.system.otp.onTimePercent,
            ridership: d.system.totalRidership,
        })).sort((a, b) => a.date.localeCompare(b.date)),
        [filtered]
    );

    // ── Hourly boardings + BPH line (aggregated across filtered days) ─
    const hourlyData = useMemo(() => {
        const n = filtered.length || 1;
        const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, boardings: 0, otp: 0, otpCount: 0 }));
        let totalServiceHours = 0;
        for (const day of filtered) {
            for (const h of day.byHour) {
                const idx = h.hour % 24;
                if (idx < 0 || idx >= 24) continue;
                hours[idx].boardings += h.boardings;
                if (h.otp.total > 0) {
                    hours[idx].otp += h.otp.onTimePercent;
                    hours[idx].otpCount++;
                }
            }
            for (const r of day.byRoute) {
                totalServiceHours += r.serviceHours;
            }
        }
        const activeHours = hours.filter(h => h.boardings > 0);
        const serviceHoursPerHour = activeHours.length > 0 ? totalServiceHours / activeHours.length : 1;

        return activeHours.map(h => ({
            label: `${h.hour.toString().padStart(2, '0')}:00`,
            boardings: h.boardings,
            bph: serviceHoursPerHour > 0 ? Math.round(h.boardings / serviceHoursPerHour * 10) / 10 : 0,
            avgOtp: h.otpCount > 0 ? Math.round(h.otp / h.otpCount) : null,
        }));
    }, [filtered]);

    const peakHourSummary = useMemo(() => {
        if (hourlyData.length === 0) return null;
        const busiest = hourlyData.reduce((a, b) => b.boardings > a.boardings ? b : a);
        const withOtp = hourlyData.filter(h => h.avgOtp !== null);
        const worstOtp = withOtp.length > 0 ? withOtp.reduce((a, b) => (b.avgOtp ?? 100) < (a.avgOtp ?? 100) ? b : a) : null;
        return { busiest, worstOtp };
    }, [hourlyData]);

    // ── Route ranking (expanded) ───────────────────────────────────
    const routeRanking = useMemo(() => {
        const routeMap = new Map<string, {
            otp: number[]; earlyPct: number[]; latePct: number[];
            ridership: number; alightings: number; serviceHours: number;
            routeId: string; routeName: string;
        }>();
        for (const day of filtered) {
            for (const r of day.byRoute) {
                const existing = routeMap.get(r.routeId) || {
                    otp: [], earlyPct: [], latePct: [],
                    ridership: 0, alightings: 0, serviceHours: 0,
                    routeId: r.routeId, routeName: r.routeName,
                };
                existing.otp.push(r.otp.onTimePercent);
                existing.earlyPct.push(r.otp.earlyPercent);
                existing.latePct.push(r.otp.latePercent);
                existing.ridership += r.ridership;
                existing.alightings += r.alightings;
                existing.serviceHours += r.serviceHours;
                routeMap.set(r.routeId, existing);
            }
        }
        return Array.from(routeMap.values())
            .map(r => {
                const avgOtp = Math.round(r.otp.reduce((a, b) => a + b, 0) / r.otp.length);
                const avgEarly = Math.round(r.earlyPct.reduce((a, b) => a + b, 0) / r.earlyPct.length);
                const avgLate = Math.round(r.latePct.reduce((a, b) => a + b, 0) / r.latePct.length);
                const bph = r.serviceHours > 0 ? Math.round(r.ridership / r.serviceHours * 10) / 10 : 0;
                let trend: '↑' | '↓' | '–' = '–';
                if (r.otp.length >= 2) {
                    const mid = Math.floor(r.otp.length / 2);
                    const firstHalf = r.otp.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
                    const secondHalf = r.otp.slice(mid).reduce((a, b) => a + b, 0) / (r.otp.length - mid);
                    if (secondHalf - firstHalf >= 2) trend = '↑';
                    else if (firstHalf - secondHalf >= 2) trend = '↓';
                }
                return {
                    routeId: r.routeId, routeName: r.routeName,
                    avgOtp, avgEarly, avgLate, ridership: r.ridership,
                    alightings: r.alightings, bph, trend,
                };
            })
            .sort((a, b) => b.avgOtp - a.avgOtp);
    }, [filtered]);

    // ── Data quality aggregate ─────────────────────────────────────
    const dataQuality = useMemo((): DataQuality | null => {
        if (filtered.length === 0) return null;
        return filtered.reduce<DataQuality>((acc, d) => ({
            totalRecords: acc.totalRecords + d.dataQuality.totalRecords,
            inBetweenFiltered: acc.inBetweenFiltered + d.dataQuality.inBetweenFiltered,
            missingAVL: acc.missingAVL + d.dataQuality.missingAVL,
            missingAPC: acc.missingAPC + d.dataQuality.missingAPC,
            detourRecords: acc.detourRecords + d.dataQuality.detourRecords,
            tripperRecords: acc.tripperRecords + d.dataQuality.tripperRecords,
            loadCapped: acc.loadCapped + d.dataQuality.loadCapped,
            apcExcludedFromLoad: acc.apcExcludedFromLoad + d.dataQuality.apcExcludedFromLoad,
        }), {
            totalRecords: 0, inBetweenFiltered: 0, missingAVL: 0, missingAPC: 0,
            detourRecords: 0, tripperRecords: 0, loadCapped: 0, apcExcludedFromLoad: 0,
        });
    }, [filtered]);

    if (!systemAvg) {
        return <div className="text-center text-gray-400 py-16">No data for selected filters.</div>;
    }

    const isSingleDate = selectedDate !== 'all';
    const hasMissedTrips = missedTrips.hasCoverage && missedTrips.totalMissed > 0;
    const hasAttention = attentionItems.worstRoutes.length > 0 || attentionItems.lateTrips.length > 0 || hasMissedTrips;
    const avlPct = dataQuality ? Math.round((dataQuality.missingAVL / dataQuality.totalRecords) * 100) : 0;
    const apcPct = dataQuality ? Math.round((dataQuality.missingAPC / dataQuality.totalRecords) * 100) : 0;

    return (
        <div className="space-y-6">
            {/* ── 1. Date Context Banner + Controls ────────────────── */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-cyan-50 text-cyan-600">
                            <Calendar size={18} />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-gray-900">
                                {data.metadata.dateRange
                                    ? formatDateRange(data.metadata.dateRange.start, data.metadata.dateRange.end)
                                    : `${filtered.length} days`}
                            </p>
                            <p className="text-xs text-gray-400">
                                {data.metadata.importedAt ? freshness(data.metadata.importedAt) : ''} · {data.dailySummaries.length} days loaded
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {/* Date selector */}
                        <select
                            value={selectedDate}
                            onChange={e => { setSelectedDate(e.target.value); if (e.target.value !== 'all') setDayTypeFilter('all'); }}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-300"
                        >
                            <option value="all">All dates ({data.dailySummaries.length})</option>
                            {sortedDates.map(d => (
                                <option key={d} value={d}>{formatDateShort(d)}</option>
                            ))}
                        </select>
                        {/* Day type pills */}
                        <div className="flex gap-1">
                            <button
                                onClick={() => setDayTypeFilter('all')}
                                disabled={isSingleDate}
                                className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
                                    dayTypeFilter === 'all' ? 'bg-cyan-100 text-cyan-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                } ${isSingleDate ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                All
                            </button>
                            {availableDayTypes.map(dt => (
                                <button
                                    key={dt}
                                    onClick={() => setDayTypeFilter(dt)}
                                    disabled={isSingleDate}
                                    className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${
                                        dayTypeFilter === dt ? 'bg-cyan-100 text-cyan-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                    } ${isSingleDate ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    {DAY_TYPE_LABELS[dt]}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── 2. KPI Cards (6) ─────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <MetricCard
                    icon={<Clock size={18} />}
                    label="On-Time Performance"
                    value={`${systemAvg.otp}%`}
                    color={systemAvg.otp >= 80 ? 'emerald' : systemAvg.otp >= 70 ? 'amber' : 'red'}
                    subValue={`${systemAvg.earlyPct}% early · ${systemAvg.latePct}% late`}
                />
                <MetricCard
                    icon={<Users size={18} />}
                    label="Total Ridership"
                    value={systemAvg.ridership.toLocaleString()}
                    color="cyan"
                    subValue={`${systemAvg.ridership.toLocaleString()} on · ${systemAvg.alightings.toLocaleString()} off`}
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
                <MetricCard
                    icon={<ClipboardList size={18} />}
                    label="Trips Operated"
                    value={missedTrips.totalScheduled > 0
                        ? `${missedTrips.totalObserved} / ${missedTrips.totalScheduled}`
                        : 'N/A'}
                    color={missedTrips.totalScheduled === 0 ? 'cyan'
                        : missedTrips.missedPct < 2 ? 'emerald'
                        : missedTrips.missedPct < 5 ? 'amber'
                        : 'red'}
                    subValue={missedTrips.totalScheduled === 0
                        ? (missedTrips.skippedDays > 0
                            ? `${missedTrips.skippedDays} day(s) skipped (holiday?)`
                            : 'GTFS data not available')
                        : missedTrips.totalMissed === 0
                            ? 'All scheduled trips operated'
                            : `${missedTrips.totalMissed} missed (${missedTrips.missedPct.toFixed(1)}%)`}
                />
            </div>

            {/* ── 2b. Peak Hour Callout ─────────────────────────────── */}
            {peakHourSummary && (
                <div className="flex flex-wrap gap-3">
                    <div className="flex-1 min-w-[200px] bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-cyan-50 text-cyan-600">
                            <Users size={16} />
                        </div>
                        <div>
                            <p className="text-xs text-gray-400">Busiest Hour</p>
                            <p className="text-sm font-bold text-gray-900">{peakHourSummary.busiest.label}</p>
                            <p className="text-xs text-gray-500">{peakHourSummary.busiest.boardings.toLocaleString()} boardings</p>
                        </div>
                    </div>
                    {peakHourSummary.worstOtp && peakHourSummary.worstOtp.avgOtp !== null && peakHourSummary.worstOtp.avgOtp < 80 && (
                        <div className="flex-1 min-w-[200px] bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
                                <Clock size={16} />
                            </div>
                            <div>
                                <p className="text-xs text-gray-400">Worst OTP Hour</p>
                                <p className="text-sm font-bold text-gray-900">{peakHourSummary.worstOtp.label}</p>
                                <p className="text-xs text-amber-600 font-medium">{peakHourSummary.worstOtp.avgOtp}% on-time</p>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── 3. Attention Items ───────────────────────────────── */}
            <div className={`border rounded-xl p-4 ${hasAttention ? 'border-amber-300 bg-amber-50/50' : 'border-emerald-300 bg-emerald-50/50'}`}>
                <h3 className={`text-sm font-bold mb-2 flex items-center gap-2 ${hasAttention ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {hasAttention ? (
                        <><AlertTriangle size={14} /> Worth Watching</>
                    ) : (
                        <><CheckCircle size={14} /> All routes within OTP targets</>
                    )}
                </h3>
                {hasAttention && (
                    <div className="space-y-2">
                        {attentionItems.worstRoutes.length > 0 && (
                            <div className="space-y-1">
                                {attentionItems.worstRoutes.map(r => (
                                    <div key={r.routeId} className="flex items-center gap-2 text-xs text-gray-700">
                                        <span className={`inline-block w-2 h-2 rounded-full ${r.avgOtp < 70 ? 'bg-red-500' : 'bg-amber-500'}`} />
                                        <span className="font-bold">{r.routeId} {r.routeName}</span>
                                        <span className="text-gray-400">—</span>
                                        <span className={`font-bold ${r.avgOtp < 70 ? 'text-red-600' : 'text-amber-600'}`}>{r.avgOtp}% OTP</span>
                                        <span className="text-gray-400">({r.daysBelowTarget}/{r.totalDays} days below 80%)</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {attentionItems.lateTrips.length > 0 && (
                            <div className="space-y-1 pt-1 border-t border-amber-200">
                                <p className="text-xs font-bold text-amber-600">Late-Running Trips</p>
                                {attentionItems.lateTrips.map(t => (
                                    <div key={t.tripName} className="flex items-center gap-2 text-xs text-gray-700">
                                        <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                                        <span className="font-bold">{t.tripName}</span>
                                        <span className="text-gray-400">Route {t.routeId}</span>
                                        <span className="text-gray-400">—</span>
                                        <span className="font-bold text-amber-600">avg +{t.avgDelay} min</span>
                                        <span className="text-gray-400">({t.daysLate}/{t.totalDays} days)</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {hasMissedTrips && (
                            <div className="space-y-1 pt-1 border-t border-amber-200">
                                <p className="text-xs font-bold text-amber-600">Missed Trips (GTFS vs Observed)</p>
                                {missedTrips.routesMissed.filter(r => r.count >= 2).slice(0, 4).map(r => (
                                    <div key={r.routeId} className="flex items-center gap-2 text-xs text-gray-700">
                                        <span className={`inline-block w-2 h-2 rounded-full ${r.count >= 3 ? 'bg-red-500' : 'bg-amber-500'}`} />
                                        <span className="font-bold">Route {r.routeId}</span>
                                        <span className="text-gray-400">—</span>
                                        <span className={`font-bold ${r.count >= 3 ? 'text-red-600' : 'text-amber-600'}`}>
                                            {r.count} missed
                                        </span>
                                        <span className="text-gray-400">(earliest {r.earliestDep})</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <button
                            onClick={() => onNavigate('otp')}
                            className="text-xs font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1 mt-1"
                        >
                            View OTP Details <ArrowRight size={12} />
                        </button>
                    </div>
                )}
            </div>

            {/* ── 4. Charts Row: OTP Donut + OTP Trend ─────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="OTP Breakdown" subtitle="Early / On Time / Late distribution">
                    <div className="relative">
                        <ResponsiveContainer width="100%" height={250}>
                            <PieChart>
                                <Pie
                                    data={otpDonutData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={70}
                                    outerRadius={100}
                                    paddingAngle={2}
                                    dataKey="value"
                                >
                                    {otpDonutData.map((entry, i) => (
                                        <Cell key={i} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(v: number, name: string) => [v.toLocaleString(), name]} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="text-center">
                                <p className="text-2xl font-bold text-gray-900">{systemAvg.otp}%</p>
                                <p className="text-xs text-gray-400">On Time</p>
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-center gap-4 mt-2">
                        {otpDonutData.map(d => (
                            <div key={d.name} className="flex items-center gap-1 text-xs text-gray-500">
                                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                                {d.name}
                            </div>
                        ))}
                    </div>
                </ChartCard>

                <ChartCard title="OTP Trend" subtitle={`${filtered.length}-day trend`}>
                    {otpTrend.length > 1 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={otpTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `${v}%`} />
                                <Tooltip formatter={(v: number) => [`${v}%`, 'OTP']} />
                                <ReferenceLine y={80} stroke="#9CA3AF" strokeDasharray="6 4" label={{ value: '80% target', position: 'right', fontSize: 10, fill: '#9CA3AF' }} />
                                <Line type="monotone" dataKey="otp" stroke="#06b6d4" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">
                            Need 2+ days for trend chart
                        </div>
                    )}
                </ChartCard>
            </div>

            {/* ── 5. Charts Row: Ridership Trend + Ridership by Route ─ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Daily Ridership" subtitle="Boardings per day">
                    {otpTrend.length > 1 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={otpTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => v.toLocaleString()} />
                                <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Boardings']} />
                                <Bar dataKey="ridership" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">
                            Need 2+ days for ridership trend
                        </div>
                    )}
                </ChartCard>

                <ChartCard title="Boardings per Hour" subtitle="All routes ranked by BPH efficiency">
                    <ResponsiveContainer width="100%" height={Math.max(250, routeRanking.length * 28)}>
                        <BarChart data={[...routeRanking].sort((a, b) => b.bph - a.bph)} layout="vertical" margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                            <XAxis type="number" domain={[0, (max: number) => Math.max(max, 30)]} tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <YAxis type="category" dataKey="routeId" width={40} tick={{ fontSize: 11, fontWeight: 600, fill: '#6B7280' }} interval={0} />
                            <Tooltip formatter={(v: number) => [v.toFixed(1), 'BPH']} />
                            <ReferenceLine x={10} stroke="#ef4444" strokeDasharray="6 4" label={{ value: 'Service review', position: 'top', fontSize: 10, fill: '#ef4444' }} />
                            <ReferenceLine x={30} stroke="#10b981" strokeDasharray="6 4" label={{ value: 'Frequency review', position: 'top', fontSize: 10, fill: '#10b981' }} />
                            <Bar dataKey="bph" radius={[0, 4, 4, 0]}>
                                {[...routeRanking].sort((a, b) => b.bph - a.bph).map((r) => (
                                    <Cell key={r.routeId} fill={bphColor(r.bph)} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </ChartCard>
            </div>

            {/* ── 6. Boardings by Hour of Day ────────────────────────── */}
            {hourlyData.length > 0 && (
                <ChartCard title="Boardings by Hour" subtitle="Total boardings (bars) and boardings per service hour (line)">
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={hourlyData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <YAxis yAxisId="total" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => v.toLocaleString()} />
                            <YAxis yAxisId="bph" orientation="right" tick={{ fontSize: 10, fill: '#8b5cf6' }} />
                            <Tooltip
                                formatter={(v: number, name: string) => [
                                    name === 'boardings' ? v.toLocaleString() : v.toFixed(1),
                                    name === 'boardings' ? 'Total Boardings' : 'BPH',
                                ]}
                            />
                            <Bar yAxisId="total" dataKey="boardings" fill="#06b6d4" radius={[4, 4, 0, 0]} opacity={0.8} />
                            <Line yAxisId="bph" type="monotone" dataKey="bph" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3, fill: '#8b5cf6' }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-4 mt-1">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <span className="inline-block w-3 h-2.5 rounded-sm bg-cyan-500 opacity-80" />
                            Total Boardings
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <span className="inline-block w-3 h-0.5 bg-purple-500 rounded" />
                            Boardings per Service Hour
                        </div>
                    </div>
                </ChartCard>
            )}

            {/* ── 7. Enhanced Route Scorecard Table ─────────────────── */}
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
                                <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Early%</th>
                                <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Late%</th>
                                {filtered.length >= 2 && (
                                    <th className="text-center py-2 px-2 font-bold text-gray-500 text-xs uppercase">Trend</th>
                                )}
                                <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Boards</th>
                                <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Alights</th>
                                <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">BPH</th>
                                {missedTrips.hasCoverage && (
                                    <th className="text-right py-2 px-2 font-bold text-gray-500 text-xs uppercase">Missed</th>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {routeRanking.map(r => (
                                <tr key={r.routeId} className={`border-b border-gray-50 hover:bg-gray-50 ${r.avgOtp < 70 ? 'bg-red-50' : ''}`}>
                                    <td className="py-2 px-2 font-bold text-gray-900">{r.routeId}</td>
                                    <td className="py-2 px-2 text-gray-500">{r.routeName}</td>
                                    <td className="py-2 px-2 text-right">
                                        <span className={`font-bold ${r.avgOtp >= 80 ? 'text-emerald-600' : r.avgOtp >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
                                            {r.avgOtp}%
                                        </span>
                                    </td>
                                    <td className="py-2 px-2 text-right text-amber-600 font-medium">{r.avgEarly}%</td>
                                    <td className="py-2 px-2 text-right text-red-600 font-medium">{r.avgLate}%</td>
                                    {filtered.length >= 2 && (
                                        <td className="py-2 px-2 text-center">
                                            <span className={`font-bold ${r.trend === '↑' ? 'text-emerald-600' : r.trend === '↓' ? 'text-red-600' : 'text-gray-400'}`}>
                                                {r.trend}
                                            </span>
                                        </td>
                                    )}
                                    <td className="py-2 px-2 text-right font-medium text-gray-700">{r.ridership.toLocaleString()}</td>
                                    <td className="py-2 px-2 text-right font-medium text-gray-700">{r.alightings.toLocaleString()}</td>
                                    <td className="py-2 px-2 text-right font-bold text-cyan-600">{r.bph.toFixed(1)}</td>
                                    {missedTrips.hasCoverage && (() => {
                                        const missed = missedTrips.routesMissed.find(m => m.routeId === r.routeId);
                                        const count = missed?.count ?? 0;
                                        return (
                                            <td className={`py-2 px-2 text-right font-bold ${count > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                                                {count}
                                            </td>
                                        );
                                    })()}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </ChartCard>

            {/* ── 7. Data Quality Footer ───────────────────────────── */}
            {dataQuality && (
                <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-4 py-2.5 text-xs ${
                    avlPct > 10 ? 'bg-red-50 text-red-700 border border-red-200'
                    : avlPct > 5 ? 'bg-amber-50 text-amber-700 border border-amber-200'
                    : 'bg-gray-50 text-gray-500 border border-gray-200'
                }`}>
                    <div className="flex items-center gap-1.5 font-bold">
                        <Database size={12} />
                        Data Quality
                    </div>
                    <span>{dataQuality.totalRecords.toLocaleString()} records</span>
                    <span>Missing AVL: {dataQuality.missingAVL.toLocaleString()} ({avlPct}%)</span>
                    <span>Missing APC: {dataQuality.missingAPC.toLocaleString()} ({apcPct}%)</span>
                    {dataQuality.loadCapped > 0 && <span>Load capped: {dataQuality.loadCapped.toLocaleString()}</span>}
                    {dataQuality.inBetweenFiltered > 0 && <span>In-between filtered: {dataQuality.inBetweenFiltered.toLocaleString()}</span>}
                </div>
            )}
        </div>
    );
};
