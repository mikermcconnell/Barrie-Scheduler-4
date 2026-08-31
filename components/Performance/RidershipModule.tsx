import React, { useCallback, useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, Legend,
} from 'recharts';
import { ChartCard } from '../Analytics/AnalyticsShared';
import { RidershipHeatmapSection } from './RidershipHeatmapSection';
import { StopActivityMap } from './StopActivityMap';
import { TodDailyKpiSection } from './TodDailyKpiSection';
import type { DailySummary, PerformanceDataSummary, PerformanceLoadCapacityConfig } from '../../utils/performanceDataTypes';
import { compareDateStrings, longWeekdayDateLabel, shortDateLabel, shortWeekdayDateLabel } from '../../utils/performanceDateUtils';
import { aggregateStopActivity } from '../../utils/performanceStopActivity';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { RidershipStopProfileChart } from './RidershipStopProfileChart';
import { buildRidershipStopProfiles, type RidershipStopProfileResult } from '../../utils/performanceRidershipStopProfile';
import { PerformanceLoadCapacityPanel } from './PerformanceLoadCapacityPanel';
import { useTeam } from '../contexts/TeamContext';
import { useAuth } from '../contexts/AuthContext';
import { useTodPickupDataQuery, useTodPickupMetadataQuery } from '../../hooks/useTodPickupData';
import { aggregateTodDailyLocations } from '../../utils/todPickupAggregation';
import { averagePerDayLabel, type PerformanceDayTypeFilter } from '../../utils/performanceMetricDisplay';

interface RidershipModuleProps {
    data: PerformanceDataSummary;
    dayTypeFilter?: PerformanceDayTypeFilter;
    comparisonDays?: DailySummary[];
    comparisonRange?: { start: string; end: string } | null;
    loadConfigTeamId?: string;
    loadConfigUserId?: string;
    canManageLoadConfig?: boolean;
}

const ROUTE_COLORS = ['#06b6d4', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e', '#ec4899', '#3b82f6', '#14b8a6', '#f97316', '#6366f1', '#a855f7', '#84cc16'];
const RIDERSHIP_ROUTE_GROUPS: Record<string, string> = {
    '2A': '2A/2B',
    '2B': '2A/2B',
    '7A': '7A/7B',
    '7B': '7A/7B',
};
type SortDir = 'asc' | 'desc';
type RouteSortKey = 'routeId' | 'routeName' | 'ridership' | 'avgPerDay' | 'boardsPerServiceHour';

function getRidershipRouteKey(routeId: string): string {
    const normalized = routeId.trim().toUpperCase();
    return RIDERSHIP_ROUTE_GROUPS[normalized] || routeId;
}

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
    sortKey: RouteSortKey;
    activeKey: RouteSortKey;
    direction: SortDir;
    onClick: (key: RouteSortKey) => void;
    align?: 'left' | 'right' | 'center';
}) {
    const active = activeKey === sortKey;
    const alignClass = align === 'right' ? 'justify-end text-right' : align === 'center' ? 'justify-center text-center' : 'justify-start text-left';
    return (
        <th className={`py-2 px-2 font-bold text-gray-500 text-xs uppercase`}>
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

export const RidershipModule: React.FC<RidershipModuleProps> = ({
    data,
    dayTypeFilter = 'all',
    comparisonDays = [],
    comparisonRange = null,
    loadConfigTeamId,
    loadConfigUserId,
    canManageLoadConfig = false,
}) => {
    const { team, accessLevel, canManageTeam } = useTeam();
    const { user } = useAuth();
    const canViewPassengerFlow = accessLevel === 'admin' || accessLevel === 'internal';
    const filtered = data.dailySummaries;
    const [routeSortKey, setRouteSortKey] = useState<RouteSortKey>('ridership');
    const [routeSortDir, setRouteSortDir] = useState<SortDir>('desc');
    const [loadCapacityConfig, setLoadCapacityConfig] = useState<PerformanceLoadCapacityConfig>();
    const handleLoadConfigChange = useCallback((config: PerformanceLoadCapacityConfig | undefined) => {
        setLoadCapacityConfig(config);
    }, []);

    // Daily ridership trend
    const dailyTrend = useMemo(() =>
        filtered.map(d => ({
            date: shortDateLabel(d.date),
            weekdayDate: shortWeekdayDateLabel(d.date),
            fullDate: d.date,
            ridership: d.system.totalRidership,
            boardings: d.system.totalBoardings,
        })).sort((a, b) => compareDateStrings(a.fullDate, b.fullDate)),
        [filtered]
    );

    // Route ridership ranking
    const routeRanking = useMemo(() => {
        const routeMap = new Map<string, {
            routeId: string;
            routeName: string;
            ridership: number;
            serviceHours: number;
            dates: Set<string>;
            sourceRouteIds: Set<string>;
        }>();
        for (const day of filtered) {
            for (const r of day.byRoute) {
                const routeKey = getRidershipRouteKey(r.routeId);
                const ex = routeMap.get(routeKey) || {
                    routeId: routeKey,
                    routeName: r.routeName,
                    ridership: 0,
                    serviceHours: 0,
                    dates: new Set<string>(),
                    sourceRouteIds: new Set<string>(),
                };
                ex.ridership += r.ridership;
                ex.serviceHours += r.serviceHours;
                ex.dates.add(day.date);
                ex.sourceRouteIds.add(r.routeId);
                routeMap.set(routeKey, ex);
            }
        }
        return Array.from(routeMap.values())
            .map(r => ({
                ...r,
                routeName: r.sourceRouteIds.size > 1
                    ? `Combined ${Array.from(r.sourceRouteIds).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(' + ')}`
                    : r.routeName,
                avgPerDay: Math.round(r.ridership / Math.max(1, r.dates.size)),
                boardsPerServiceHour: r.serviceHours > 0
                    ? Math.round((r.ridership / r.serviceHours) * 10) / 10
                    : 0,
            }))
            .sort((a, b) => b.ridership - a.ridership);
    }, [filtered]);

    const sortedRouteRanking = useMemo(() => {
        const rows = [...routeRanking];
        rows.sort((a, b) => {
            const mult = routeSortDir === 'asc' ? 1 : -1;
            let cmp = 0;
            switch (routeSortKey) {
                case 'routeId':
                    cmp = compareText(a.routeId, b.routeId);
                    break;
                case 'routeName':
                    cmp = compareText(a.routeName, b.routeName);
                    break;
                case 'ridership':
                    cmp = compareNumber(a.ridership, b.ridership);
                    break;
                case 'avgPerDay':
                    cmp = compareNumber(a.avgPerDay, b.avgPerDay);
                    break;
                case 'boardsPerServiceHour':
                    cmp = compareNumber(a.boardsPerServiceHour, b.boardsPerServiceHour);
                    break;
            }
            if (cmp !== 0) return mult * cmp;
            return compareText(a.routeId, b.routeId);
        });
        return rows;
    }, [routeRanking, routeSortDir, routeSortKey]);

    const toggleRouteSort = (key: RouteSortKey) => {
        setRouteSortKey(prev => {
            if (prev === key) {
                setRouteSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'));
                return prev;
            }
            setRouteSortDir(key === 'routeId' || key === 'routeName' ? 'asc' : 'desc');
            return key;
        });
    };

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

    // Aggregate stop activity across filtered days (merges routes + hourly arrays)
    const stopActivity = useMemo(() => aggregateStopActivity(filtered), [filtered]);
    const comparisonStopActivity = useMemo(() => aggregateStopActivity(comparisonDays), [comparisonDays]);
    const includedDates = useMemo(() => filtered.map(day => day.date), [filtered]);
    const includedDateSet = useMemo(() => new Set(includedDates), [includedDates]);
    const todMetadataQuery = useTodPickupMetadataQuery(team?.id);
    const todDataQuery = useTodPickupDataQuery(team?.id, !!todMetadataQuery.data, todMetadataQuery.data);
    const todReports = useMemo(
        () => (todDataQuery.data?.dailyReports || []).filter(report => includedDateSet.has(report.date)),
        [includedDateSet, todDataQuery.data?.dailyReports],
    );
    const todLocations = useMemo(
        () => aggregateTodDailyLocations(todDataQuery.data?.dailyReports || [], includedDates),
        [includedDates, todDataQuery.data?.dailyReports],
    );
    const todIsLoading = todMetadataQuery.isLoading || todDataQuery.isLoading;
    const todError = todMetadataQuery.error || todDataQuery.error;
    const hasStoredTodReports = (todDataQuery.data?.dailyReports?.length || 0) > 0;
    const stopProfiles = useMemo(
        (): RidershipStopProfileResult => canViewPassengerFlow
            ? buildRidershipStopProfiles(filtered, loadCapacityConfig)
            : { options: [], defaultOptionKey: null },
        [canViewPassengerFlow, filtered, loadCapacityConfig],
    );

    // Route daily trend (multi-line)
    const routeDailyTrend = useMemo(() => {
        const dateMap = new Map<string, Record<string, number>>();
        const routeIds = new Set<string>();
        for (const day of filtered) {
            const entry: Record<string, number> = {};
            for (const r of day.byRoute) {
                const routeKey = getRidershipRouteKey(r.routeId);
                entry[routeKey] = (entry[routeKey] || 0) + r.ridership;
                routeIds.add(routeKey);
            }
            dateMap.set(day.date, entry);
        }
        const dates = Array.from(dateMap.keys()).sort(compareDateStrings);
        return {
            data: dates.map(date => ({
                ...dateMap.get(date),
                date: shortDateLabel(date),
                weekdayDate: shortWeekdayDateLabel(date),
                fullDate: date,
            })),
            routeIds: Array.from(routeIds).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        };
    }, [filtered]);

    return (
        <div className="space-y-6">
            {/* Stop Activity Map */}
            <ChartCard title="Stop Activity Map" subtitle="Fixed-route and Transit On Demand activity for the selected Ridership period">
                <StopActivityMap
                    stops={stopActivity}
                    todLocations={todLocations}
                    comparisonStops={comparisonStopActivity}
                    currentDayCount={filtered.length}
                    comparisonDayCount={comparisonDays.length}
                    comparisonRange={comparisonRange}
                />
            </ChartCard>

            <TodDailyKpiSection
                reports={todReports}
                locations={todLocations}
                isLoading={todIsLoading}
                error={todError}
                hasStoredReports={hasStoredTodReports}
                teamId={team?.id}
                userId={user?.uid}
                canManageZones={canManageTeam}
            />

            {/* Daily Ridership Trend */}
            <ChartCard title="Daily Ridership" subtitle="Total boardings per day">
                {dailyTrend.length > 1 ? (
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={dailyTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis dataKey="weekdayDate" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <Tooltip
                                labelFormatter={(_, payload) => {
                                    const row = payload?.[0]?.payload as { fullDate?: string; weekdayDate?: string } | undefined;
                                    return row?.fullDate ? longWeekdayDateLabel(row.fullDate) : (row?.weekdayDate || '');
                                }}
                                formatter={(v: number) => [v.toLocaleString(), 'Boardings']}
                            />
                            <Bar dataKey="ridership" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <ResponsiveContainer width="100%" height={250}>
                        <BarChart data={dailyTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis dataKey="weekdayDate" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <Tooltip
                                labelFormatter={(_, payload) => {
                                    const row = payload?.[0]?.payload as { fullDate?: string; weekdayDate?: string } | undefined;
                                    return row?.fullDate ? longWeekdayDateLabel(row.fullDate) : (row?.weekdayDate || '');
                                }}
                                formatter={(v: number) => [v.toLocaleString(), 'Boardings']}
                            />
                            <Bar dataKey="ridership" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </ChartCard>

            <PerformanceLoadCapacityPanel
                teamId={loadConfigTeamId}
                userId={loadConfigUserId}
                canManage={canManageLoadConfig}
                onConfigChange={handleLoadConfigChange}
            />

            {canViewPassengerFlow && (
                <RidershipStopProfileChart
                    data={stopProfiles}
                    periodMode={filtered.length === 1 ? 'single-day' : 'multi-day'}
                />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Route Ranking */}
                <ChartCard title="Ridership by Route" subtitle={`Total, ${averagePerDayLabel(dayTypeFilter).toLowerCase()}, and boards per service hour`}>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <SortableHeader label="Route" sortKey="routeId" activeKey={routeSortKey} direction={routeSortDir} onClick={toggleRouteSort} />
                                    <SortableHeader label="Name" sortKey="routeName" activeKey={routeSortKey} direction={routeSortDir} onClick={toggleRouteSort} />
                                    <SortableHeader label="Total" sortKey="ridership" activeKey={routeSortKey} direction={routeSortDir} onClick={toggleRouteSort} align="right" />
                                    <SortableHeader label={averagePerDayLabel(dayTypeFilter, true)} sortKey="avgPerDay" activeKey={routeSortKey} direction={routeSortDir} onClick={toggleRouteSort} align="right" />
                                    <SortableHeader label="Boards / Service Hr" sortKey="boardsPerServiceHour" activeKey={routeSortKey} direction={routeSortDir} onClick={toggleRouteSort} align="right" />
                                </tr>
                            </thead>
                            <tbody>
                                {sortedRouteRanking.map((r) => (
                                    <tr key={r.routeId} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-1.5 px-2 font-bold text-gray-900">{r.routeId}</td>
                                        <td className="py-1.5 px-2 text-gray-500 truncate max-w-[120px]">{r.routeName}</td>
                                        <td className="py-1.5 px-2 text-right font-medium text-gray-700">{r.ridership.toLocaleString()}</td>
                                        <td className="py-1.5 px-2 text-right text-gray-500">{r.avgPerDay.toLocaleString()}</td>
                                        <td className="py-1.5 px-2 text-right text-gray-500 tabular-nums">{r.boardsPerServiceHour.toFixed(1)}</td>
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
                            <XAxis dataKey="weekdayDate" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <Tooltip
                                labelFormatter={(_, payload) => {
                                    const row = payload?.[0]?.payload as { fullDate?: string; date?: string; weekdayDate?: string } | undefined;
                                    return row?.fullDate ? longWeekdayDateLabel(row.fullDate) : (row?.weekdayDate || row?.date || '');
                                }}
                                formatter={(v: number, name: string) => [v.toLocaleString(), `Route ${name}`]}
                            />
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
