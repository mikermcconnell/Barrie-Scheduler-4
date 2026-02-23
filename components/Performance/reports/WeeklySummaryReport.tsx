import React, { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, ReferenceLine, ComposedChart,
} from 'recharts';
import { Clock, Users, Bus, AlertTriangle, ArrowUpDown, Download } from 'lucide-react';
import { MetricCard, ChartCard } from '../../Analytics/AnalyticsShared';
import type { DailySummary } from '../../../utils/performanceDataTypes';
import { exportWeeklySummary } from './reportExporter';
import { compareDateStrings, shortDateLabel, toDateSortKey } from '../../../utils/performanceDateUtils';
import { StopActivityMap } from '../StopActivityMap';
import { RidershipHeatmapSection } from '../RidershipHeatmapSection';
import { aggregateStopActivity } from '../../../utils/performanceStopActivity';

interface WeeklySummaryReportProps {
    filteredDays: DailySummary[];
    allDays: DailySummary[];
    startDate: string;
    endDate: string;
}

interface SystemKPI {
    otp: number;
    earlyPct: number;
    latePct: number;
    ridership: number;
    alightings: number;
    tripCount: number;
    avgLoad: number;
    peakLoad: number;
    vehicles: number;
    serviceHours: number;
}

function computeSystemKPI(days: DailySummary[]): SystemKPI | null {
    if (days.length === 0) return null;
    const n = days.length;
    const totalOTP = days.reduce((s, d) => s + d.system.otp.onTimePercent, 0);
    const totalEarly = days.reduce((s, d) => s + d.system.otp.earlyPercent, 0);
    const totalLate = days.reduce((s, d) => s + d.system.otp.latePercent, 0);
    const totalRidership = days.reduce((s, d) => s + d.system.totalRidership, 0);
    const totalAlightings = days.reduce((s, d) => s + d.system.totalAlightings, 0);
    const totalTrips = days.reduce((s, d) => s + d.system.tripCount, 0);
    const avgLoad = days.reduce((s, d) => s + d.system.avgSystemLoad, 0) / n;
    const peakLoad = Math.max(...days.map(d => d.system.peakLoad));
    const vehicles = Math.round(days.reduce((s, d) => s + d.system.vehicleCount, 0) / n);
    const serviceHours = days.reduce((s, d) => s + d.byRoute.reduce((rs, r) => rs + r.serviceHours, 0), 0);

    return {
        otp: Math.round(totalOTP / n * 10) / 10,
        earlyPct: Math.round(totalEarly / n * 10) / 10,
        latePct: Math.round(totalLate / n * 10) / 10,
        ridership: totalRidership,
        alightings: totalAlightings,
        tripCount: totalTrips,
        avgLoad: Math.round(avgLoad * 10) / 10,
        peakLoad,
        vehicles,
        serviceHours: Math.round(serviceHours * 10) / 10,
    };
}

function getPriorPeriodDays(allDays: DailySummary[], startDate: string, endDate: string): DailySummary[] {
    const start = new Date(startDate + 'T12:00:00');
    const end = new Date(endDate + 'T12:00:00');
    const durationMs = end.getTime() - start.getTime();
    const priorEnd = new Date(start.getTime() - 86400000); // day before start
    const priorStart = new Date(priorEnd.getTime() - durationMs);
    const priorStartStr = priorStart.toISOString().slice(0, 10);
    const priorEndStr = priorEnd.toISOString().slice(0, 10);
    const priorStartKey = toDateSortKey(priorStartStr);
    const priorEndKey = toDateSortKey(priorEndStr);
    return allDays.filter(d => {
        const dayKey = toDateSortKey(d.date);
        if (!Number.isFinite(dayKey)) return false;
        return dayKey >= priorStartKey && dayKey <= priorEndKey;
    });
}

function formatDelta(current: number, prior: number | null, suffix: string = '', invert: boolean = false): string {
    if (prior === null) return '';
    const diff = current - prior;
    if (Math.abs(diff) < 0.1) return `— vs prior${suffix}`;
    const sign = diff > 0 ? '+' : '';
    return `${sign}${diff.toFixed(1)}${suffix} vs prior`;
}

function deltaColor(current: number, prior: number | null, higherIsBetter: boolean = true): string {
    if (prior === null) return 'text-gray-400';
    const diff = current - prior;
    if (Math.abs(diff) < 0.5) return 'text-gray-400';
    const isImproving = higherIsBetter ? diff > 0 : diff < 0;
    return isImproving ? 'text-emerald-600' : 'text-red-600';
}

type SortField = 'routeId' | 'avgOtp' | 'ridership' | 'bph' | 'avgEarly' | 'avgLate' | 'alightings' | 'tripCount';

export const WeeklySummaryReport: React.FC<WeeklySummaryReportProps> = ({
    filteredDays, allDays, startDate, endDate,
}) => {
    const [sortField, setSortField] = useState<SortField>('bph');
    const [sortAsc, setSortAsc] = useState(false);

    const currentKPI = useMemo(() => computeSystemKPI(filteredDays), [filteredDays]);

    const priorDays = useMemo(
        () => getPriorPeriodDays(allDays, startDate, endDate),
        [allDays, startDate, endDate]
    );
    const priorKPI = useMemo(() => computeSystemKPI(priorDays), [priorDays]);

    // Route ranking
    const routeRanking = useMemo(() => {
        const routeMap = new Map<string, {
            otp: number[]; earlyPct: number[]; latePct: number[];
            ridership: number; alightings: number; serviceHours: number;
            tripCount: number; routeId: string; routeName: string;
        }>();
        for (const day of filteredDays) {
            for (const r of day.byRoute) {
                const existing = routeMap.get(r.routeId) || {
                    otp: [], earlyPct: [], latePct: [],
                    ridership: 0, alightings: 0, serviceHours: 0,
                    tripCount: 0, routeId: r.routeId, routeName: r.routeName,
                };
                existing.otp.push(r.otp.onTimePercent);
                existing.earlyPct.push(r.otp.earlyPercent);
                existing.latePct.push(r.otp.latePercent);
                existing.ridership += r.ridership;
                existing.alightings += r.alightings;
                existing.serviceHours += r.serviceHours;
                existing.tripCount += r.tripCount;
                routeMap.set(r.routeId, existing);
            }
        }
        return Array.from(routeMap.values()).map(r => {
            const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
            return {
                routeId: r.routeId,
                routeName: r.routeName,
                avgOtp: Math.round(avg(r.otp) * 10) / 10,
                avgEarly: Math.round(avg(r.earlyPct) * 10) / 10,
                avgLate: Math.round(avg(r.latePct) * 10) / 10,
                ridership: r.ridership,
                alightings: r.alightings,
                tripCount: r.tripCount,
                bph: r.serviceHours > 0 ? Math.round(r.ridership / r.serviceHours * 10) / 10 : 0,
            };
        });
    }, [filteredDays]);

    const sortedRoutes = useMemo(() => {
        const sorted = [...routeRanking].sort((a, b) => {
            const aVal = a[sortField];
            const bVal = b[sortField];
            if (typeof aVal === 'string' && typeof bVal === 'string') return aVal.localeCompare(bVal);
            return (aVal as number) - (bVal as number);
        });
        return sortAsc ? sorted : sorted.reverse();
    }, [routeRanking, sortField, sortAsc]);

    const handleSort = (field: SortField) => {
        if (field === sortField) {
            setSortAsc(!sortAsc);
        } else {
            setSortField(field);
            setSortAsc(false);
        }
    };

    // OTP trend (day-by-day)
    const otpTrend = useMemo(() =>
        filteredDays
            .map(d => ({
                date: shortDateLabel(d.date),
                fullDate: d.date,
                otp: d.system.otp.onTimePercent,
                ridership: d.system.totalRidership,
            }))
            .sort((a, b) => compareDateStrings(a.fullDate, b.fullDate)),
        [filteredDays]
    );

    // Hourly distribution (averaged across filtered days)
    const hourlyData = useMemo(() => {
        const n = filteredDays.length || 1;
        const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, boardings: 0 }));
        let totalServiceHours = 0;
        for (const day of filteredDays) {
            for (const h of day.byHour) {
                const idx = h.hour % 24;
                if (idx >= 0 && idx < 24) hours[idx].boardings += h.boardings;
            }
            for (const r of day.byRoute) totalServiceHours += r.serviceHours;
        }
        const activeHours = hours.filter(h => h.boardings > 0);
        const svcPerHour = activeHours.length > 0 ? totalServiceHours / activeHours.length : 1;

        return activeHours.map(h => ({
            label: `${h.hour.toString().padStart(2, '0')}:00`,
            boardings: Math.round(h.boardings / n),
            bph: svcPerHour > 0 ? Math.round(h.boardings / svcPerHour * 10) / 10 : 0,
        }));
    }, [filteredDays]);

    // Stop activity aggregation for map (same pattern as RidershipModule)
    const stopActivity = useMemo(() => aggregateStopActivity(filteredDays), [filteredDays]);

    // Wrap filteredDays as PerformanceDataSummary for RidershipHeatmapSection
    const heatmapData = useMemo(() => ({
        dailySummaries: filteredDays,
        metadata: { importedAt: '', importedBy: '', dateRange: { start: startDate, end: endDate }, dayCount: filteredDays.length, totalRecords: 0 },
        schemaVersion: 1,
    }), [filteredDays, startDate, endDate]);

    if (!currentKPI) {
        return <div className="text-center text-gray-400 py-16">No data for selected range.</div>;
    }

    const hasPrior = priorKPI !== null && priorDays.length > 0;

    const SortHeader: React.FC<{ field: SortField; label: string; align?: string }> = ({ field, label, align = 'text-right' }) => (
        <th
            className={`py-2 px-2 font-bold text-gray-500 text-xs uppercase cursor-pointer hover:text-gray-700 ${align}`}
            onClick={() => handleSort(field)}
        >
            <span className="inline-flex items-center gap-0.5">
                {label}
                {sortField === field && <ArrowUpDown size={10} className="text-cyan-500" />}
            </span>
        </th>
    );

    const [exporting, setExporting] = useState(false);
    const handleExport = async () => {
        setExporting(true);
        try { await exportWeeklySummary(filteredDays, startDate, endDate); }
        finally { setExporting(false); }
    };

    return (
        <div className="space-y-5">
            {/* Header row */}
            <div className="flex items-center justify-between">
                {hasPrior ? (
                    <p className="text-xs text-gray-400">
                        Comparing to prior period ({priorDays.length} days)
                    </p>
                ) : <span />}
                <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
                >
                    <Download size={14} />
                    {exporting ? 'Exporting...' : 'Export to Excel'}
                </button>
            </div>

            {/* System Scorecard */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <MetricCard
                    icon={<Clock size={18} />}
                    label="On-Time Performance"
                    value={`${currentKPI.otp}%`}
                    color={currentKPI.otp >= 85 ? 'emerald' : currentKPI.otp >= 75 ? 'amber' : 'red'}
                    subValue={hasPrior ? formatDelta(currentKPI.otp, priorKPI!.otp, '%') : `${currentKPI.earlyPct}% early · ${currentKPI.latePct}% late`}
                />
                <MetricCard
                    icon={<Users size={18} />}
                    label="Total Ridership"
                    value={currentKPI.ridership.toLocaleString()}
                    color="cyan"
                    subValue={hasPrior
                        ? formatDelta(currentKPI.ridership, priorKPI!.ridership)
                        : `${currentKPI.alightings.toLocaleString()} alightings`}
                />
                <MetricCard
                    icon={<Bus size={18} />}
                    label="Trips Operated"
                    value={currentKPI.tripCount.toLocaleString()}
                    color="indigo"
                    subValue={hasPrior
                        ? formatDelta(currentKPI.tripCount, priorKPI!.tripCount)
                        : `${currentKPI.vehicles} vehicles avg`}
                />
                <MetricCard
                    icon={<AlertTriangle size={18} />}
                    label="Peak Load"
                    value={`${currentKPI.peakLoad}`}
                    color="amber"
                    subValue={`Avg load: ${currentKPI.avgLoad}`}
                />
                <MetricCard
                    icon={<Clock size={18} />}
                    label="Service Hours"
                    value={currentKPI.serviceHours.toLocaleString()}
                    color="cyan"
                    subValue={hasPrior
                        ? formatDelta(currentKPI.serviceHours, priorKPI!.serviceHours)
                        : `${filteredDays.length} days`}
                />
            </div>

            {/* Route Scorecard Table */}
            <ChartCard title="Route Scorecard" subtitle={`${sortedRoutes.length} routes · sorted by ${sortField}`}>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <SortHeader field="routeId" label="Route" align="text-left" />
                                <th className="text-left py-2 px-2 font-bold text-gray-500 text-xs uppercase">Name</th>
                                <SortHeader field="avgOtp" label="OTP%" />
                                <SortHeader field="avgEarly" label="Early%" />
                                <SortHeader field="avgLate" label="Late%" />
                                <SortHeader field="ridership" label="Boards" />
                                <SortHeader field="alightings" label="Alights" />
                                <SortHeader field="tripCount" label="Trips" />
                                <SortHeader field="bph" label="BPH" />
                            </tr>
                        </thead>
                        <tbody>
                            {sortedRoutes.map(r => (
                                <tr key={r.routeId} className={`border-b border-gray-50 hover:bg-gray-50 ${r.avgOtp < 75 ? 'bg-red-50/50' : ''}`}>
                                    <td className="py-2 px-2 font-bold text-gray-900">{r.routeId}</td>
                                    <td className="py-2 px-2 text-gray-500 truncate max-w-[150px]">{r.routeName}</td>
                                    <td className="py-2 px-2 text-right">
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${
                                            r.avgOtp >= 85 ? 'bg-emerald-100 text-emerald-700'
                                            : r.avgOtp >= 75 ? 'bg-amber-100 text-amber-700'
                                            : 'bg-red-100 text-red-700'
                                        }`}>
                                            {r.avgOtp}%
                                        </span>
                                    </td>
                                    <td className="py-2 px-2 text-right text-amber-600 font-medium">{r.avgEarly}%</td>
                                    <td className="py-2 px-2 text-right text-red-600 font-medium">{r.avgLate}%</td>
                                    <td className="py-2 px-2 text-right font-medium text-gray-700">{r.ridership.toLocaleString()}</td>
                                    <td className="py-2 px-2 text-right font-medium text-gray-700">{r.alightings.toLocaleString()}</td>
                                    <td className="py-2 px-2 text-right font-medium text-gray-700">{r.tripCount.toLocaleString()}</td>
                                    <td className="py-2 px-2 text-right font-bold text-cyan-600">{r.bph.toFixed(1)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </ChartCard>

            {/* Trend Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="OTP Trend" subtitle={`${otpTrend.length}-day trend`}>
                    {otpTrend.length > 1 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={otpTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={v => `${v}%`} />
                                <Tooltip formatter={(v: number) => [`${v}%`, 'OTP']} />
                                <ReferenceLine y={85} stroke="#10b981" strokeDasharray="6 4" label={{ value: '85%', position: 'right', fontSize: 10, fill: '#10b981' }} />
                                <ReferenceLine y={75} stroke="#f59e0b" strokeDasharray="6 4" label={{ value: '75%', position: 'right', fontSize: 10, fill: '#f59e0b' }} />
                                <Line type="monotone" dataKey="otp" stroke="#06b6d4" strokeWidth={2} dot={{ r: 3, fill: '#06b6d4' }} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">
                            Need 2+ days for trend chart
                        </div>
                    )}
                </ChartCard>

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
            </div>

            {/* Hourly Distribution */}
            {hourlyData.length > 0 && (
                <ChartCard title="Hourly Distribution" subtitle="Average boardings (bars) and BPH (line) per hour">
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={hourlyData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <YAxis yAxisId="total" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <YAxis yAxisId="bph" orientation="right" tick={{ fontSize: 10, fill: '#8b5cf6' }} />
                            <Tooltip
                                formatter={(v: number, name: string) => [
                                    name === 'boardings' ? v.toLocaleString() : v.toFixed(1),
                                    name === 'boardings' ? 'Avg Boardings' : 'BPH',
                                ]}
                            />
                            <Bar yAxisId="total" dataKey="boardings" fill="#06b6d4" radius={[4, 4, 0, 0]} opacity={0.8} />
                            <Line yAxisId="bph" type="monotone" dataKey="bph" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3, fill: '#8b5cf6' }} />
                        </ComposedChart>
                    </ResponsiveContainer>
                    <div className="flex justify-center gap-4 mt-1">
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <span className="inline-block w-3 h-2.5 rounded-sm bg-cyan-500 opacity-80" />
                            Avg Boardings
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <span className="inline-block w-3 h-0.5 bg-purple-500 rounded" />
                            BPH
                        </div>
                    </div>
                </ChartCard>
            )}

            {/* Stop Activity Map */}
            {stopActivity.length > 0 && (
                <ChartCard title="Stop Activity Map" subtitle="Circle size and color reflect total boardings + alightings">
                    <StopActivityMap stops={stopActivity} />
                </ChartCard>
            )}

            {/* Stop × Trip Heatmap */}
            <RidershipHeatmapSection data={heatmapData} />
        </div>
    );
};
