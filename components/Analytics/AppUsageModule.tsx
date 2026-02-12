import React, { useMemo } from 'react';
import {
    LineChart,
    Line,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { Users, Activity, Download, UserCheck } from 'lucide-react';
import type { TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import { MetricCard, ChartCard, NoData, fmt } from './AnalyticsShared';

interface AppUsageModuleProps {
    data: TransitAppDataSummary;
}

export const AppUsageModule: React.FC<AppUsageModuleProps> = ({ data }) => {
    const { appUsage } = data;

    // Usage chart data
    const usageChartData = appUsage.map(d => ({
        date: d.date.slice(5), // MM-DD
        users: d.users,
        sessions: d.sessions,
        downloads: d.downloads,
    }));

    // Summary metrics
    const totalUsers = appUsage.reduce((sum, d) => sum + d.users, 0);
    const totalSessions = appUsage.reduce((sum, d) => sum + d.sessions, 0);
    const totalDownloads = appUsage.reduce((sum, d) => sum + d.downloads, 0);
    const sessionsPerUser = totalUsers > 0 ? (totalSessions / totalUsers).toFixed(1) : '0';

    // Day-of-week profile
    const dayOfWeekData = useMemo(() => {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const totals = Array(7).fill(0);
        const counts = Array(7).fill(0);
        for (const d of appUsage) {
            const dow = new Date(d.date).getDay();
            totals[dow] += d.users;
            counts[dow] += 1;
        }
        return days.map((name, i) => ({
            day: name,
            avgUsers: counts[i] > 0 ? Math.round(totals[i] / counts[i]) : 0,
        }));
    }, [appUsage]);

    // Seasonal comparison (monthly averages)
    const monthlyAverages = useMemo(() => {
        const months: Record<string, { users: number; count: number }> = {};
        for (const d of appUsage) {
            const monthKey = d.date.slice(0, 7); // YYYY-MM
            if (!months[monthKey]) months[monthKey] = { users: 0, count: 0 };
            months[monthKey].users += d.users;
            months[monthKey].count += 1;
        }
        return Object.entries(months)
            .map(([month, { users, count }]) => ({
                month,
                label: new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
                avgDailyUsers: Math.round(users / count),
                totalUsers: users,
                days: count,
            }))
            .sort((a, b) => a.month.localeCompare(b.month));
    }, [appUsage]);

    return (
        <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard icon={<Users size={20} />} label="Total Users" value={fmt(totalUsers)} color="cyan" />
                <MetricCard icon={<Activity size={20} />} label="Total Sessions" value={fmt(totalSessions)} color="indigo" />
                <MetricCard icon={<Download size={20} />} label="Downloads" value={fmt(totalDownloads)} color="emerald" />
                <MetricCard icon={<UserCheck size={20} />} label="Sessions / User" value={sessionsPerUser} color="amber" />
            </div>

            {/* App Usage Trend */}
            <ChartCard title="App Usage Trend" subtitle="Daily users, sessions, and downloads over time">
                {usageChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={usageChartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis
                                dataKey="date"
                                tick={{ fontSize: 10 }}
                                interval={Math.max(0, Math.floor(usageChartData.length / 12) - 1)}
                            />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
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
                                <Tooltip />
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
                                <Tooltip />
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
