import React, { useMemo } from 'react';
import {
    LineChart,
    Line,
    BarChart,
    Bar,
    Legend,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { Users, Activity, Download, UserCheck } from 'lucide-react';
import type { TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import { MetricCard, ChartCard, NoData, fmt } from './AnalyticsShared';
import {
    buildAppUsageTimeline,
    buildDayOfWeekProfile,
    buildMonthlyAverages,
    formatFullDateUtc,
    formatMonthShortUtc,
} from './appUsageChartUtils';

interface AppUsageModuleProps {
    data: TransitAppDataSummary;
}

export const AppUsageModule: React.FC<AppUsageModuleProps> = ({ data }) => {
    const { appUsage } = data;

    const usageChartData = useMemo(() => buildAppUsageTimeline(appUsage), [appUsage]);
    const usageMonthTicks = useMemo(() => {
        const seenMonths = new Set<string>();
        const ticks: string[] = [];

        for (const point of usageChartData) {
            const monthKey = point.date.slice(0, 7);
            if (seenMonths.has(monthKey)) continue;
            seenMonths.add(monthKey);
            ticks.push(point.date);
        }

        return ticks;
    }, [usageChartData]);

    // Summary metrics
    const userDays = appUsage.reduce((sum, d) => sum + d.users, 0);
    const totalSessions = appUsage.reduce((sum, d) => sum + d.sessions, 0);
    const totalDownloads = appUsage.reduce((sum, d) => sum + d.downloads, 0);
    const sessionsPerDailyUser = userDays > 0 ? (totalSessions / userDays).toFixed(1) : '0';

    const dayOfWeekData = useMemo(() => buildDayOfWeekProfile(appUsage), [appUsage]);
    const monthlyAverages = useMemo(() => buildMonthlyAverages(appUsage), [appUsage]);

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    icon={<Users size={20} />}
                    label="User-Days"
                    value={fmt(userDays)}
                    color="cyan"
                    subValue="Sum of daily user counts"
                />
                <MetricCard icon={<Activity size={20} />} label="Total Sessions" value={fmt(totalSessions)} color="indigo" />
                <MetricCard icon={<Download size={20} />} label="Downloads" value={fmt(totalDownloads)} color="emerald" />
                <MetricCard icon={<UserCheck size={20} />} label="Sessions / Daily User" value={sessionsPerDailyUser} color="amber" />
            </div>

            {/* App Usage Trend */}
            <ChartCard title="App Usage Trend" subtitle="Daily users, sessions, and downloads over time">
                {usageChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={340}>
                        <LineChart data={usageChartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis
                                dataKey="date"
                                tick={{ fontSize: 10 }}
                                ticks={usageMonthTicks}
                                interval={0}
                                tickFormatter={(value: string) => formatMonthShortUtc(value)}
                            />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip
                                labelFormatter={(value: string) => formatFullDateUtc(value)}
                                formatter={(value: number, name: string) => [fmt(value), name]}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Line type="monotone" dataKey="users" stroke="#06b6d4" strokeWidth={2} dot={false} name="Users" />
                            <Line type="monotone" dataKey="sessions" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Sessions" />
                            <Line type="monotone" dataKey="downloads" stroke="#10b981" strokeWidth={1.5} dot={false} name="Downloads" />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <NoData />
                )}
            </ChartCard>

            {/* Day of Week Profile */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartCard title="Day-of-Week Profile" subtitle="Average daily users by day of week">
                    {dayOfWeekData.some(d => d.avgUsers > 0) ? (
                        <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={dayOfWeekData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} />
                                <Tooltip formatter={(value: number) => [fmt(value), 'Avg Users']} />
                                <Bar dataKey="avgUsers" fill="#06b6d4" name="Avg Users" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <NoData />
                    )}
                </ChartCard>

                {/* Monthly Comparison */}
                <ChartCard title="Monthly Comparison" subtitle="Average daily users by month">
                    {monthlyAverages.length > 0 ? (
                        <ResponsiveContainer width="100%" height={240}>
                            <BarChart data={monthlyAverages} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 11 }} />
                                <Tooltip
                                    labelFormatter={(value: string) => value}
                                    formatter={(value: number) => [fmt(value), 'Avg Daily Users']}
                                />
                                <Bar dataKey="avgDailyUsers" fill="#8b5cf6" name="Avg Daily Users" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <NoData />
                    )}
                </ChartCard>
            </div>
        </div>
    );
};
