import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, PieChart, Pie, Cell, ReferenceLine, ComposedChart,
} from 'recharts';
import { ChartCard } from '../Analytics/AnalyticsShared';
import { longWeekdayDateLabel } from '../../utils/performanceDateUtils';

export interface OverviewOtpDatum {
    [key: string]: string | number;
    name: string;
    value: number;
    color: string;
}

export interface OverviewTrendDatum {
    date: string;
    weekdayDate: string;
    fullDate: string;
    otp: number;
    ridership: number;
}

export interface OverviewRouteDatum {
    routeId: string;
    routeName: string;
    avgOtp: number;
    avgEarly: number;
    avgLate: number;
    ridership: number;
    alightings: number;
    bph: number;
    trend: '↑' | '↓' | '–';
}

export interface OverviewHourlyDatum {
    label: string;
    boardings: number;
    bph: number;
    avgOtp: number | null;
    otpObservations: number;
}

function bphColor(value: number): string {
    if (value >= 30) return '#10b981';
    if (value <= 10) return '#ef4444';
    const t = (value - 10) / 20;
    if (t < 0.5) {
        const r = 239;
        const g = Math.round(68 + (158 - 68) * (t * 2));
        const b = Math.round(68 + (11 - 68) * (t * 2));
        return `rgb(${r},${g},${b})`;
    }
    const s = (t - 0.5) * 2;
    const r = Math.round(245 + (16 - 245) * s);
    const g = Math.round(158 + (185 - 158) * s);
    const b = Math.round(11 + (129 - 11) * s);
    return `rgb(${r},${g},${b})`;
}

export const SystemOverviewOtpCharts: React.FC<{
    otpDonutData: OverviewOtpDatum[];
    otpTrend: OverviewTrendDatum[];
    otpPercent: number;
}> = ({ otpDonutData, otpTrend, otpPercent }) => (
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
                            {otpDonutData.map((entry, index) => (
                                <Cell key={entry.name || index} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip formatter={(value: number, name: string) => [value.toLocaleString(), name]} />
                    </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="text-center">
                        <p className="text-2xl font-bold text-gray-900">{otpPercent}%</p>
                        <p className="text-xs text-gray-400">On Time</p>
                    </div>
                </div>
            </div>
            <div className="flex justify-center gap-4 mt-2">
                {otpDonutData.map(datum => (
                    <div key={datum.name} className="flex items-center gap-1 text-xs text-gray-500">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: datum.color }} />
                        {datum.name}
                    </div>
                ))}
            </div>
        </ChartCard>

        <ChartCard title="OTP Trend" subtitle={`${otpTrend.length}-day trend`}>
            {otpTrend.length > 1 ? (
                <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={otpTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={value => `${value}%`} />
                        <Tooltip formatter={(value: number) => [`${value}%`, 'OTP']} />
                        <ReferenceLine y={85} stroke="#9CA3AF" strokeDasharray="6 4" label={{ value: '85% target', position: 'right', fontSize: 10, fill: '#9CA3AF' }} />
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
);

export const SystemOverviewRidershipCharts: React.FC<{
    otpTrend: OverviewTrendDatum[];
    routeRanking: OverviewRouteDatum[];
    hourlyData: OverviewHourlyDatum[];
}> = ({ otpTrend, routeRanking, hourlyData }) => {
    const routesByBph = [...routeRanking].sort((a, b) => b.bph - a.bph);

    return (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Daily Ridership" subtitle="Boardings per day">
                    {otpTrend.length > 1 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={otpTrend} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                                <XAxis dataKey="weekdayDate" tick={{ fontSize: 10, fill: '#9CA3AF' }} interval="preserveStartEnd" />
                                <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={value => value.toLocaleString()} />
                                <Tooltip
                                    labelFormatter={(_, payload) => {
                                        const row = payload?.[0]?.payload as { fullDate?: string; weekdayDate?: string } | undefined;
                                        return row?.fullDate ? longWeekdayDateLabel(row.fullDate) : (row?.weekdayDate || '');
                                    }}
                                    formatter={(value: number) => [value.toLocaleString(), 'Boardings']}
                                />
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
                        <BarChart data={routesByBph} layout="vertical" margin={{ top: 20, right: 10, bottom: 5, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                            <XAxis type="number" domain={[0, (max: number) => Math.max(max, 30)]} tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <YAxis type="category" dataKey="routeId" width={40} tick={{ fontSize: 11, fontWeight: 600, fill: '#6B7280' }} interval={0} />
                            <Tooltip formatter={(value: number) => [value.toFixed(1), 'BPH']} />
                            <ReferenceLine x={10} stroke="#ef4444" strokeDasharray="6 4" label={{ value: '10 BPH: Service review', position: 'top', fontSize: 10, fill: '#ef4444' }} />
                            <ReferenceLine x={30} stroke="#10b981" strokeDasharray="6 4" label={{ value: '30 BPH: Frequency review', position: 'top', fontSize: 10, fill: '#10b981' }} />
                            <Bar dataKey="bph" radius={[0, 4, 4, 0]}>
                                {routesByBph.map(route => <Cell key={route.routeId} fill={bphColor(route.bph)} />)}
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

            {hourlyData.length > 0 && (
                <ChartCard title="Boardings by Hour" subtitle="Total boardings (bars) and estimated boardings per service-hour proxy (line)">
                    <ResponsiveContainer width="100%" height={280}>
                        <ComposedChart data={hourlyData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                            <YAxis yAxisId="total" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={value => value.toLocaleString()} />
                            <YAxis yAxisId="bph" orientation="right" tick={{ fontSize: 10, fill: '#8b5cf6' }} />
                            <Tooltip
                                formatter={(value: number, name: string) => [
                                    name === 'boardings' ? value.toLocaleString() : value.toFixed(1),
                                    name === 'boardings' ? 'Total Boardings' : 'Estimated BPH',
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
                            Estimated BPH proxy
                        </div>
                    </div>
                </ChartCard>
            )}
        </>
    );
};
