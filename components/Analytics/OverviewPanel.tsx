import React from 'react';
import {
    LineChart,
    Line,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { Users, MapPin, Route, Calendar, ArrowRight } from 'lucide-react';
import type { TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import { MetricCard, ChartCard, NoData, fmt } from './AnalyticsShared';
import { buildAppUsageTimeline, formatFullDateUtc } from './appUsageChartUtils';

interface OverviewPanelProps {
    data: TransitAppDataSummary;
    onNavigate: (tabId: string) => void;
}

export const OverviewPanel: React.FC<OverviewPanelProps> = ({ data, onNavigate }) => {
    const { routeMetrics, tripDistribution, transferPatterns, appUsage } = data;

    // KPI values
    const userDays = appUsage.reduce((sum, d) => sum + d.users, 0);
    const totalTrips = tripDistribution.daily.reduce((sum, d) => sum + d.count, 0);
    const routesTracked = routeMetrics.summary.length;
    const daysCovered = appUsage.length || tripDistribution.daily.length;

    // Mini sparkline data — top 5 routes
    const routeSparkData = routeMetrics.summary
        .slice(0, 5)
        .map(r => ({ route: r.route, views: r.totalViews }));

    // Mini sparkline data — daily trip volume (last 30 days)
    const tripSparkData = tripDistribution.daily
        .slice(-30)
        .map(d => ({ date: d.date.slice(5), count: d.count }));

    // Mini sparkline data — app usage (last 30 days)
    const usageSparkData = buildAppUsageTimeline(appUsage).slice(-30);

    // Top 5 routes table
    const top5Routes = routeMetrics.summary.slice(0, 5);

    // Top 5 transfers table
    const top5Transfers = transferPatterns.slice(0, 5);

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
                <MetricCard icon={<MapPin size={20} />} label="Trip Requests" value={fmt(totalTrips)} color="indigo" />
                <MetricCard icon={<Route size={20} />} label="Routes Tracked" value={fmt(routesTracked)} color="emerald" />
                <MetricCard icon={<Calendar size={20} />} label="Days Covered" value={fmt(daysCovered)} color="amber" />
            </div>

            {/* Sparkline Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Route Performance Sparkline */}
                <ChartCard title="Top Routes" subtitle="By nearby views">
                    {routeSparkData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={120}>
                            <BarChart data={routeSparkData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                                <XAxis dataKey="route" tick={{ fontSize: 10 }} />
                                <YAxis hide />
                                <Tooltip />
                                <Bar dataKey="views" fill="#06b6d4" radius={[3, 3, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <NoData />
                    )}
                </ChartCard>

                {/* Trip Volume Sparkline */}
                <ChartCard title="Trip Volume" subtitle="Daily requests (last 30 days)">
                    {tripSparkData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={120}>
                            <LineChart data={tripSparkData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                                <XAxis dataKey="date" hide />
                                <YAxis hide />
                                <Tooltip />
                                <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <NoData />
                    )}
                </ChartCard>

                {/* App Usage Sparkline */}
                <ChartCard title="App Usage" subtitle="Daily users (last 30 days)">
                    {usageSparkData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={120}>
                            <LineChart data={usageSparkData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                                <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} scale="time" hide />
                                <YAxis hide />
                                <Tooltip
                                    labelFormatter={(value: number) => {
                                        const point = usageSparkData.find(d => d.timestamp === value);
                                        return formatFullDateUtc(point?.date ?? '');
                                    }}
                                    formatter={(value: number) => [fmt(value), 'Users']}
                                />
                                <Line type="monotone" dataKey="users" stroke="#06b6d4" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <NoData />
                    )}
                </ChartCard>
            </div>

            {/* Quick-Glance Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top 5 Routes */}
                <ChartCard
                    title="Top Routes"
                    subtitle="By views and engagement"
                    headerExtra={
                        <button
                            onClick={() => onNavigate('route-performance')}
                            className="text-xs text-cyan-600 hover:text-cyan-700 font-medium flex items-center gap-1"
                        >
                            View all <ArrowRight size={12} />
                        </button>
                    }
                >
                    {top5Routes.length > 0 ? (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200">
                                    <th className="text-left py-2 px-2 text-gray-500 font-medium">Route</th>
                                    <th className="text-right py-2 px-2 text-gray-500 font-medium">Views</th>
                                    <th className="text-right py-2 px-2 text-gray-500 font-medium">Taps</th>
                                    <th className="text-right py-2 px-2 text-gray-500 font-medium">Avg/Day</th>
                                </tr>
                            </thead>
                            <tbody>
                                {top5Routes.map((r, i) => (
                                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-2 px-2 font-bold">{r.route}</td>
                                        <td className="py-2 px-2 text-right">{fmt(r.totalViews)}</td>
                                        <td className="py-2 px-2 text-right">{fmt(r.totalTaps)}</td>
                                        <td className="py-2 px-2 text-right text-gray-400">{r.avgDailyViews.toFixed(0)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <NoData />
                    )}
                </ChartCard>

                {/* Top 5 Transfers */}
                <ChartCard
                    title="Top Transfers"
                    subtitle="Most common route-to-route"
                    headerExtra={
                        <button
                            onClick={() => onNavigate('transfers')}
                            className="text-xs text-cyan-600 hover:text-cyan-700 font-medium flex items-center gap-1"
                        >
                            View all <ArrowRight size={12} />
                        </button>
                    }
                >
                    {top5Transfers.length > 0 ? (
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200">
                                    <th className="text-left py-2 px-2 text-gray-500 font-medium">From</th>
                                    <th className="text-left py-2 px-2 text-gray-500 font-medium">To</th>
                                    <th className="text-right py-2 px-2 text-gray-500 font-medium">Count</th>
                                    <th className="text-right py-2 px-2 text-gray-500 font-medium">Avg Wait</th>
                                </tr>
                            </thead>
                            <tbody>
                                {top5Transfers.map((tp, i) => (
                                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-2 px-2 font-medium">{tp.fromRoute}</td>
                                        <td className="py-2 px-2 font-medium">{tp.toRoute}</td>
                                        <td className="py-2 px-2 text-right font-bold">{tp.count}</td>
                                        <td className="py-2 px-2 text-right text-gray-400">{tp.avgWaitMinutes}m</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <NoData />
                    )}
                </ChartCard>
            </div>
        </div>
    );
};
