import React, { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, PieChart, Pie, Cell, ReferenceLine, ComposedChart,
} from 'recharts';
import {
    Clock, Users, AlertTriangle, ArrowRight,
    Calendar, Database, ClipboardList,
} from 'lucide-react';
import { MetricCard, ChartCard } from '../Analytics/AnalyticsShared';
import type { PerformanceDataSummary, DayType, DataQuality } from '../../utils/performanceDataTypes';
import {
    computeMissedTripsForDay, hasGtfsCoverage,
} from '../../utils/gtfs/gtfsScheduleIndex';
import { compareDateStrings, normalizeToISODate, shortDateLabel } from '../../utils/performanceDateUtils';

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
const MIN_ACTION_QUEUE_DAYS = 3;

type ActionQueueItemType = 'route' | 'trip';
type ActionQueueBand = 'Act now' | 'Watch' | 'Monitor';

interface ActionQueueItem {
    id: string;
    itemType: ActionQueueItemType;
    routeId: string;
    title: string;
    detail: string;
    priorityScore: number;
    band: ActionQueueBand;
    daysObserved: number;
    daysBreaching: number;
}

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
    const iso = normalizeToISODate(dateStr);
    if (!iso) return dateStr;
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateRange(start: string, end: string): string {
    const startIso = normalizeToISODate(start);
    const endIso = normalizeToISODate(end);
    if (!startIso || !endIso) return `${start} – ${end}`;
    const s = new Date(startIso + 'T12:00:00');
    const e = new Date(endIso + 'T12:00:00');
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

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function actionBand(score: number): ActionQueueBand {
    if (score >= 65) return 'Act now';
    if (score >= 45) return 'Watch';
    return 'Monitor';
}


export const SystemOverviewModule: React.FC<SystemOverviewModuleProps> = ({ data, onNavigate }) => {
    const sortedDates = useMemo(() =>
        [...new Set(data.dailySummaries.map(d => d.date))].sort(compareDateStrings),
        [data]
    );

    // Default to latest date (yesterday's snapshot)
    const [selectedDate, setSelectedDate] = useState<string>(() =>
        sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : 'all'
    );
    const [dayTypeFilter, setDayTypeFilter] = useState<DayType | 'all'>('all');

    const availableDayTypes = useMemo(() => {
        const types = new Set(data.dailySummaries.map(d => d.dayType));
        return (['weekday', 'saturday', 'sunday'] as DayType[]).filter(t => types.has(t));
    }, [data]);

    // ── Filtered data (snapshot — usually single day) ──────────────
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

    // ── Peer days (same day type for trend context in Action Queue) ───
    const peerDays = useMemo(() => {
        if (filtered.length === 0) return data.dailySummaries;
        const dayType = filtered[0].dayType;
        return data.dailySummaries.filter(d => d.dayType === dayType);
    }, [data, filtered]);

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

    // ── Action Queue (severity x persistence x impact, min 3 days) ───
    const actionQueue = useMemo(() => {
        const peerCount = peerDays.length;
        const peerDayType = peerDays[0]?.dayType ?? 'weekday';
        if (peerCount < MIN_ACTION_QUEUE_DAYS) {
            return { items: [] as ActionQueueItem[], peerDayType, peerCount };
        }

        const routeRollups = new Map<string, {
            routeId: string;
            routeName: string;
            daysObserved: number;
            daysBelowTarget: number;
            otpTotal: number;
            latePctTotal: number;
            ridershipTotal: number;
        }>();
        const tripRollups = new Map<string, {
            routeId: string;
            tripName: string;
            daysObserved: number;
            daysLate: number;
            daysWithDelay: number;
            delayMinutesTotal: number;
            boardingsTotal: number;
        }>();

        for (const day of peerDays) {
            for (const r of day.byRoute) {
                const existing = routeRollups.get(r.routeId) || {
                    routeId: r.routeId,
                    routeName: r.routeName,
                    daysObserved: 0,
                    daysBelowTarget: 0,
                    otpTotal: 0,
                    latePctTotal: 0,
                    ridershipTotal: 0,
                };
                existing.daysObserved++;
                existing.otpTotal += r.otp.onTimePercent;
                existing.latePctTotal += r.otp.latePercent;
                existing.ridershipTotal += r.ridership;
                if (r.otp.onTimePercent < 80) existing.daysBelowTarget++;
                routeRollups.set(r.routeId, existing);
            }

            for (const t of day.byTrip) {
                const key = `${t.routeId}__${t.tripName}`;
                const existing = tripRollups.get(key) || {
                    routeId: t.routeId,
                    tripName: t.tripName,
                    daysObserved: 0,
                    daysLate: 0,
                    daysWithDelay: 0,
                    delayMinutesTotal: 0,
                    boardingsTotal: 0,
                };
                const delayMinutes = t.otp.avgDeviationSeconds / 60;
                existing.daysObserved++;
                existing.boardingsTotal += t.boardings;
                if (delayMinutes > 0) {
                    existing.delayMinutesTotal += delayMinutes;
                    existing.daysWithDelay++;
                }
                if (delayMinutes > 5) existing.daysLate++;
                tripRollups.set(key, existing);
            }
        }

        const routeCandidates = Array.from(routeRollups.values())
            .map(row => {
                const avgOtp = row.otpTotal / row.daysObserved;
                const avgLatePct = row.latePctTotal / row.daysObserved;
                const avgRidershipPerDay = row.ridershipTotal / row.daysObserved;
                const persistence = row.daysBelowTarget / row.daysObserved;
                const severity = clamp01((((80 - avgOtp) / 25) * 0.75) + ((avgLatePct / 35) * 0.25));
                return { ...row, avgOtp, avgLatePct, avgRidershipPerDay, persistence, severity };
            })
            .filter(row =>
                row.daysObserved >= MIN_ACTION_QUEUE_DAYS &&
                row.avgOtp < 80 &&
                row.persistence >= 0.5
            );
        const maxRouteImpact = Math.max(1, ...routeCandidates.map(row => row.avgRidershipPerDay));
        const routeItems: ActionQueueItem[] = routeCandidates.map(row => {
            const impact = clamp01(row.avgRidershipPerDay / maxRouteImpact);
            const priorityScore = Math.round((((row.severity * row.persistence) * 70) + (impact * 30)) * 10) / 10;
            return {
                id: `route-${row.routeId}`,
                itemType: 'route',
                routeId: row.routeId,
                title: `${row.routeId} ${row.routeName}`,
                detail: `OTP avg ${Math.round(row.avgOtp)}% (${row.daysBelowTarget}/${row.daysObserved} days below 80%) · Avg riders/day ${Math.round(row.avgRidershipPerDay).toLocaleString()}`,
                priorityScore,
                band: actionBand(priorityScore),
                daysObserved: row.daysObserved,
                daysBreaching: row.daysBelowTarget,
            };
        });

        const tripCandidates = Array.from(tripRollups.values())
            .map(row => {
                const avgDelayMinutes = row.daysWithDelay > 0 ? (row.delayMinutesTotal / row.daysWithDelay) : 0;
                const avgBoardingsPerDay = row.boardingsTotal / row.daysObserved;
                const persistence = row.daysLate / row.daysObserved;
                const severity = clamp01((avgDelayMinutes - 5) / 10);
                return { ...row, avgDelayMinutes, avgBoardingsPerDay, persistence, severity };
            })
            .filter(row =>
                row.daysObserved >= MIN_ACTION_QUEUE_DAYS &&
                row.avgDelayMinutes > 5 &&
                row.persistence >= 0.5
            );
        const maxTripImpact = Math.max(1, ...tripCandidates.map(row => row.avgBoardingsPerDay));
        const tripItems: ActionQueueItem[] = tripCandidates.map(row => {
            const impact = clamp01(row.avgBoardingsPerDay / maxTripImpact);
            const priorityScore = Math.round((((row.severity * row.persistence) * 70) + (impact * 30)) * 10) / 10;
            return {
                id: `trip-${row.routeId}-${row.tripName}`,
                itemType: 'trip',
                routeId: row.routeId,
                title: row.tripName,
                detail: `Route ${row.routeId} · Avg +${Math.round(row.avgDelayMinutes)} min (${row.daysLate}/${row.daysObserved} days > 5 min late) · Avg boardings/day ${Math.round(row.avgBoardingsPerDay)}`,
                priorityScore,
                band: actionBand(priorityScore),
                daysObserved: row.daysObserved,
                daysBreaching: row.daysLate,
            };
        });

        const items = [...routeItems, ...tripItems]
            .filter(item => item.priorityScore >= 35)
            .sort((a, b) => b.priorityScore - a.priorityScore)
            .slice(0, 5);

        return { items, peerDayType, peerCount };
    }, [peerDays]);

    // ── Missed trips (GTFS vs STREETS cross-reference) ────────────
    // 1. Only count routes that have ≥1 observed trip in STREETS (route-scoping).
    //    Routes absent from STREETS weren't extracted — not "missed."
    // Core logic is centralized in computeMissedTripsForDay.
    const missedTrips = useMemo(() => {
        let totalScheduled = 0;
        let totalMatched = 0;
        const missedByRoute = new Map<string, {
            routeId: string;
            count: number;
            earliestDep: string;
            trips: {
                tripId: string;
                routeId: string;
                departure: string;
                headsign: string;
                blockId: string;
                serviceId: string;
                missType: 'not_performed' | 'late_over_15';
                lateByMinutes?: number;
            }[];
        }>();
        let hasCoverage = false;
        let skippedDays = 0;

        for (const day of filtered) {
            if (!hasGtfsCoverage(day.date)) continue;
            hasCoverage = true;

            const dayMissed = computeMissedTripsForDay(day.date, day.dayType, day.byTrip);
            if (!dayMissed) {
                skippedDays++;
                continue;
            }

            totalScheduled += dayMissed.totalScheduled;
            totalMatched += dayMissed.totalMatched;

            for (const t of dayMissed.trips) {
                const existing = missedByRoute.get(t.routeId);
                if (existing) {
                    existing.count++;
                    existing.trips.push(t);
                    if (t.departure < existing.earliestDep) existing.earliestDep = t.departure;
                } else {
                    missedByRoute.set(t.routeId, { routeId: t.routeId, count: 1, earliestDep: t.departure, trips: [t] });
                }
            }
        }

        const totalMissed = totalScheduled - totalMatched;
        const missedPct = totalScheduled > 0 ? (totalMissed / totalScheduled) * 100 : 0;
        const routesMissed = Array.from(missedByRoute.values())
            .map(r => ({ ...r, trips: r.trips.sort((a, b) => a.departure.localeCompare(b.departure)) }))
            .sort((a, b) => b.count - a.count);

        return { hasCoverage, totalScheduled, totalObserved: totalMatched, totalMissed, missedPct, routesMissed, skippedDays };
    }, [filtered]);

    // ── OTP trend (always all days, independent of date selector) ──
    const otpTrend = useMemo(() =>
        data.dailySummaries.map(d => ({
            date: shortDateLabel(d.date),
            fullDate: d.date,
            otp: d.system.otp.onTimePercent,
            ridership: d.system.totalRidership,
        })).sort((a, b) => compareDateStrings(a.fullDate, b.fullDate)),
        [data]
    );

    // ── Hourly boardings + BPH line (aggregated across filtered days) ─
    const hourlyData = useMemo(() => {
        const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, boardings: 0, otp: 0, otpCount: 0, otpObservations: 0 }));
        let totalServiceHours = 0;
        for (const day of filtered) {
            for (const h of day.byHour) {
                const idx = h.hour % 24;
                if (idx < 0 || idx >= 24) continue;
                hours[idx].boardings += h.boardings;
                if (h.otp.total > 0) {
                    hours[idx].otp += h.otp.onTimePercent;
                    hours[idx].otpCount++;
                    hours[idx].otpObservations += h.otp.total;
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
            otpObservations: h.otpObservations,
        }));
    }, [filtered]);

    const peakHourSummary = useMemo(() => {
        if (hourlyData.length === 0) return null;
        const busiest = hourlyData.reduce((a, b) => b.boardings > a.boardings ? b : a);
        const MIN_OTP_OBSERVATIONS = 10;
        const withOtp = hourlyData.filter(h => h.avgOtp !== null && h.otpObservations >= MIN_OTP_OBSERVATIONS);
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
    const canShowActionQueue = actionQueue.peerCount >= MIN_ACTION_QUEUE_DAYS;
    const hasActionQueue = actionQueue.items.length > 0;
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
                                {isSingleDate
                                    ? formatDateShort(selectedDate)
                                    : data.metadata.dateRange
                                        ? formatDateRange(data.metadata.dateRange.start, data.metadata.dateRange.end)
                                        : `${filtered.length} days`}
                            </p>
                            <p className="text-xs text-gray-400">
                                {isSingleDate ? 'Daily snapshot' : ''} · {data.metadata.importedAt ? freshness(data.metadata.importedAt) : ''} · {data.dailySummaries.length} days loaded
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                            : `${missedTrips.totalMissed} suspected missed trips (${missedTrips.missedPct.toFixed(1)}%)`}
                    onClick={missedTrips.totalMissed > 0 ? () => onNavigate('otp') : undefined}
                />
            </div>
            {missedTrips.totalMissed > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {missedTrips.totalMissed} suspected missed trips identified for further investigation.
                </div>
            )}

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

            {/* ── 3. Action Queue (only shown when there are items) ── */}
            {canShowActionQueue && hasActionQueue && (
            <div className="border rounded-xl p-4 border-amber-300 bg-amber-50/50">
                <h3 className="text-sm font-bold mb-2 flex items-center gap-2 text-amber-700">
                    <AlertTriangle size={14} /> Action Queue
                </h3>
                <p className="text-xs text-amber-700 mb-3">
                    Ranked by severity, persistence, and rider impact using {DAY_TYPE_LABELS[actionQueue.peerDayType]} peer days ({actionQueue.peerCount} loaded). Minimum {MIN_ACTION_QUEUE_DAYS} days per route/trip.
                </p>
                <div className="space-y-2">
                    {actionQueue.items.map(item => (
                        <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-white/80 px-3 py-2">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                    <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-bold uppercase tracking-wide">
                                        {item.itemType}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full font-bold ${
                                        item.band === 'Act now'
                                            ? 'bg-red-100 text-red-700'
                                            : item.band === 'Watch'
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-cyan-100 text-cyan-700'
                                    }`}>
                                        {item.band}
                                    </span>
                                    <span className="text-gray-400">{item.daysBreaching}/{item.daysObserved} breach days</span>
                                </div>
                                <p className="text-sm font-bold text-gray-900 truncate">{item.title}</p>
                                <p className="text-xs text-gray-600">{item.detail}</p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-[10px] uppercase tracking-wide text-gray-400">Priority</p>
                                <p className="text-base font-bold text-amber-700">{item.priorityScore.toFixed(1)}</p>
                            </div>
                        </div>
                    ))}
                    <button
                        onClick={() => onNavigate('otp')}
                        className="text-xs font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1 mt-1"
                    >
                        View OTP Details <ArrowRight size={12} />
                    </button>
                </div>
            </div>
            )}

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

                <ChartCard title="OTP Trend" subtitle={`${data.dailySummaries.length}-day trend`}>
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

            {/* ── 5. Route Scorecard Table ────────────────────────── */}
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

            {/* ── 6. Charts Row: Ridership Trend + Ridership by Route ─ */}
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

                <ChartCard title="Boardings per Hour" subtitle="All routes ranked by BPH efficiency (dashed lines = 10 and 30 BPH thresholds)">
                    <ResponsiveContainer width="100%" height={Math.max(250, routeRanking.length * 28)}>
                        <BarChart data={[...routeRanking].sort((a, b) => b.bph - a.bph)} layout="vertical" margin={{ top: 20, right: 10, bottom: 5, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                            <XAxis type="number" domain={[0, (max: number) => Math.max(max, 30)]} tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <YAxis type="category" dataKey="routeId" width={40} tick={{ fontSize: 11, fontWeight: 600, fill: '#6B7280' }} interval={0} />
                            <Tooltip formatter={(v: number) => [v.toFixed(1), 'BPH']} />
                            <ReferenceLine x={10} stroke="#ef4444" strokeDasharray="6 4" label={{ value: '10 BPH: Service review', position: 'top', fontSize: 10, fill: '#ef4444' }} />
                            <ReferenceLine x={30} stroke="#10b981" strokeDasharray="6 4" label={{ value: '30 BPH: Frequency review', position: 'top', fontSize: 10, fill: '#10b981' }} />
                            <Bar dataKey="bph" radius={[0, 4, 4, 0]}>
                                {[...routeRanking].sort((a, b) => b.bph - a.bph).map((r) => (
                                    <Cell key={r.routeId} fill={bphColor(r.bph)} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-4 mt-1">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <span className="inline-block w-3 border-t border-dashed border-red-500" />
                            10 BPH: Service review threshold
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <span className="inline-block w-3 border-t border-dashed border-emerald-500" />
                            30 BPH: Frequency review threshold
                        </div>
                    </div>
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

            {/* ── 8. Data Quality Footer ───────────────────────────── */}
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
