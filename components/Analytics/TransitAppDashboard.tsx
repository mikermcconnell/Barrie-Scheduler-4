/**
 * Transit App Dashboard
 *
 * Displays aggregated Transit App data with recharts visualizations.
 */

import React, { useState } from 'react';
import {
    BarChart,
    Bar,
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import {
    ArrowLeft,
    RefreshCw,
    Users,
    MapPin,
    Route,
    Calendar,
    ArrowUpDown,
} from 'lucide-react';
import type { TransitAppDataSummary } from '../../utils/transit-app/transitAppTypes';
import { TransitAppMap } from './TransitAppMap';
import { buildAppUsageTimeline, formatFullDateUtc } from './appUsageChartUtils';

interface TransitAppDashboardProps {
    data: TransitAppDataSummary;
    onReimport: () => void;
    onBack: () => void;
}

export const TransitAppDashboard: React.FC<TransitAppDashboardProps> = ({
    data,
    onReimport,
    onBack,
}) => {
    const [legSort, setLegSort] = useState<'totalLegs' | 'uniqueTrips'>('totalLegs');

    const { routeMetrics, tripDistribution, transferPatterns, routeLegs, appUsage, locationDensity, metadata } = data;

    // Format numbers
    const fmt = (n: number) => n.toLocaleString();

    // Metric cards
    const userDays = appUsage.reduce((sum, d) => sum + d.users, 0);
    const totalTrips = tripDistribution.daily.reduce((sum, d) => sum + d.count, 0);
    const routesTracked = routeMetrics.summary.length;
    const daysCovered = appUsage.length || tripDistribution.daily.length;

    // Route chart data (top 15 by views)
    const routeChartData = routeMetrics.summary
        .slice(0, 15)
        .map(r => ({
            route: r.route,
            views: r.totalViews,
            taps: r.totalTaps,
            suggestions: r.totalSuggestions,
        }));

    // App usage chart data
    const usageChartData = buildAppUsageTimeline(appUsage);

    // Hourly distribution chart
    const hourlyData = tripDistribution.hourly.map(h => ({
        hour: `${h.hour.toString().padStart(2, '0')}:00`,
        count: h.count,
    }));

    // Sorted route legs
    const sortedLegs = [...routeLegs].sort((a, b) => b[legSort] - a[legSort]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={onBack}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Transit App Data</h2>
                        <p className="text-sm text-gray-500">
                            {metadata.dateRange.start} to {metadata.dateRange.end}
                        </p>
                    </div>
                </div>
                <button
                    onClick={onReimport}
                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2"
                >
                    <RefreshCw size={16} />
                    Re-import Data
                </button>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard icon={<Users size={20} />} label="User-Days" value={fmt(userDays)} color="cyan" />
                <MetricCard icon={<MapPin size={20} />} label="Trip Requests" value={fmt(totalTrips)} color="indigo" />
                <MetricCard icon={<Route size={20} />} label="Routes Tracked" value={fmt(routesTracked)} color="emerald" />
                <MetricCard icon={<Calendar size={20} />} label="Days Covered" value={fmt(daysCovered)} color="amber" />
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Route Popularity */}
                <ChartCard title="Route Popularity" subtitle="Top routes by nearby views">
                    {routeChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={routeChartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="route" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} />
                                <Tooltip />
                                <Bar dataKey="views" fill="#06b6d4" name="Views" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="taps" fill="#8b5cf6" name="Taps" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <NoData />
                    )}
                </ChartCard>

                {/* App Usage Trend */}
                <ChartCard title="App Usage Trend" subtitle="Daily users and sessions">
                    {usageChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                            <LineChart data={usageChartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} scale="time" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 11 }} />
                                <Tooltip
                                    labelFormatter={(value: number) => {
                                        const point = usageChartData.find(d => d.timestamp === value);
                                        return formatFullDateUtc(point?.date ?? '');
                                    }}
                                    formatter={(value: number, name: string) => [fmt(value), name]}
                                />
                                <Line type="monotone" dataKey="users" stroke="#06b6d4" strokeWidth={2} dot={false} name="Users" />
                                <Line type="monotone" dataKey="sessions" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Sessions" />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <NoData />
                    )}
                </ChartCard>
            </div>

            {/* Hourly Trip Distribution */}
            <ChartCard title="Hourly Trip Distribution" subtitle="When riders plan trips">
                {hourlyData.some(h => h.count > 0) ? (
                    <ResponsiveContainer width="100%" height={280}>
                        <BarChart data={hourlyData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip />
                            <Bar dataKey="count" fill="#10b981" name="Trips" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : (
                    <NoData />
                )}
            </ChartCard>

            {/* Rider Activity Map */}
            <ChartCard
                title="Rider Activity Map"
                subtitle={`${fmt(locationDensity.totalPoints)} location points, ${fmt(locationDensity.cells.length)} grid cells${data.odPairs ? `, ${fmt(data.odPairs.pairs.length)} OD pairs` : ''}`}
            >
                <TransitAppMap
                    locationDensity={locationDensity}
                    odPairs={data.odPairs}
                    height={480}
                />
            </ChartCard>

            {/* Top Transfers Table */}
            <ChartCard title="Top Transfer Patterns" subtitle="Most common route-to-route transfers">
                {transferPatterns.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200">
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">From Route</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">To Route</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Transfer Stop</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Count</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Avg Wait</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Min/Max</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transferPatterns.slice(0, 15).map((tp, i) => (
                                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-2 px-3 font-medium">{tp.fromRoute}</td>
                                        <td className="py-2 px-3 font-medium">{tp.toRoute}</td>
                                        <td className="py-2 px-3 text-gray-500 truncate max-w-[200px]">{tp.fromStop} → {tp.toStop}</td>
                                        <td className="py-2 px-3 text-right font-bold">{tp.count}</td>
                                        <td className="py-2 px-3 text-right">{tp.avgWaitMinutes} min</td>
                                        <td className="py-2 px-3 text-right text-gray-400">{tp.minWaitMinutes}–{tp.maxWaitMinutes}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <NoData />
                )}
            </ChartCard>

            {/* Route Legs Table */}
            <ChartCard
                title="Route Leg Summary"
                subtitle="Transit legs by route with top boarding/alighting stops"
                headerExtra={
                    <button
                        onClick={() => setLegSort(prev => prev === 'totalLegs' ? 'uniqueTrips' : 'totalLegs')}
                        className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                    >
                        <ArrowUpDown size={12} />
                        Sort: {legSort === 'totalLegs' ? 'Legs' : 'Trips'}
                    </button>
                }
            >
                {sortedLegs.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200">
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Route</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Service</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Legs</th>
                                    <th className="text-right py-2 px-3 text-gray-500 font-medium">Trips</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Top Boarding</th>
                                    <th className="text-left py-2 px-3 text-gray-500 font-medium">Top Alighting</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedLegs.slice(0, 20).map((rl, i) => (
                                    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                        <td className="py-2 px-3 font-bold">{rl.route}</td>
                                        <td className="py-2 px-3 text-gray-500">{rl.serviceName}</td>
                                        <td className="py-2 px-3 text-right font-medium">{fmt(rl.totalLegs)}</td>
                                        <td className="py-2 px-3 text-right">{fmt(rl.uniqueTrips)}</td>
                                        <td className="py-2 px-3 text-gray-500 text-xs">
                                            {rl.topBoardingStops.slice(0, 2).map(s => `${s.stop} (${s.count})`).join(', ')}
                                        </td>
                                        <td className="py-2 px-3 text-gray-500 text-xs">
                                            {rl.topAlightingStops.slice(0, 2).map(s => `${s.stop} (${s.count})`).join(', ')}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <NoData />
                )}
            </ChartCard>
        </div>
    );
};

// ============ HELPER COMPONENTS ============

const MetricCard: React.FC<{
    icon: React.ReactNode;
    label: string;
    value: string;
    color: 'cyan' | 'indigo' | 'emerald' | 'amber';
}> = ({ icon, label, value, color }) => {
    const colors = {
        cyan: 'bg-cyan-50 text-cyan-600',
        indigo: 'bg-indigo-50 text-indigo-600',
        emerald: 'bg-emerald-50 text-emerald-600',
        amber: 'bg-amber-50 text-amber-600',
    };

    return (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
                <div className={`p-2 rounded-lg ${colors[color]}`}>{icon}</div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            <p className="text-sm text-gray-500">{label}</p>
        </div>
    );
};

const ChartCard: React.FC<{
    title: string;
    subtitle: string;
    headerExtra?: React.ReactNode;
    children: React.ReactNode;
}> = ({ title, subtitle, headerExtra, children }) => (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
            <div>
                <h3 className="font-bold text-gray-900">{title}</h3>
                <p className="text-xs text-gray-400">{subtitle}</p>
            </div>
            {headerExtra}
        </div>
        {children}
    </div>
);

const NoData: React.FC = () => (
    <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">
        No data available
    </div>
);
