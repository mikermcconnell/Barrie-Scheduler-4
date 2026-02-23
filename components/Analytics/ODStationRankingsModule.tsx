/**
 * OD Station Rankings Module
 *
 * Side-by-side bar charts for top origins and destinations,
 * plus a combined volume table below.
 */

import React, { useMemo } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { ChartCard, fmt } from './AnalyticsShared';
import type { ODMatrixDataSummary } from '../../utils/od-matrix/odMatrixTypes';

interface ODStationRankingsModuleProps {
    data: ODMatrixDataSummary;
    chartContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export const ODStationRankingsModule: React.FC<ODStationRankingsModuleProps> = ({ data, chartContainerRef }) => {
    const topOrigins = useMemo(() => {
        return [...data.stations]
            .sort((a, b) => b.totalOrigin - a.totalOrigin)
            .slice(0, 20)
            .map(s => ({
                name: s.name.length > 20 ? s.name.slice(0, 18) + '...' : s.name,
                fullName: s.name,
                value: s.totalOrigin,
            }));
    }, [data.stations]);

    const topDestinations = useMemo(() => {
        return [...data.stations]
            .sort((a, b) => b.totalDestination - a.totalDestination)
            .slice(0, 20)
            .map(s => ({
                name: s.name.length > 20 ? s.name.slice(0, 18) + '...' : s.name,
                fullName: s.name,
                value: s.totalDestination,
            }));
    }, [data.stations]);

    const topByVolume = useMemo(() => {
        return [...data.stations]
            .sort((a, b) => b.totalVolume - a.totalVolume)
            .slice(0, 30);
    }, [data.stations]);

    return (
        <div className="space-y-6" ref={chartContainerRef}>
            {/* Side-by-side charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Busiest Origins" subtitle="Top 20 stations by departing journeys">
                    <div className="h-[500px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={topOrigins}
                                layout="vertical"
                                margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis type="number" tickFormatter={(v) => v.toLocaleString()} />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    width={150}
                                    tick={{ fontSize: 11 }}
                                />
                                <Tooltip
                                    formatter={(value: number) => [fmt(value), 'Departures']}
                                    labelFormatter={(_: string, payload) => payload?.[0]?.payload?.fullName || ''}
                                />
                                <Bar dataKey="value" fill="#7c3aed" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </ChartCard>

                <ChartCard title="Busiest Destinations" subtitle="Top 20 stations by arriving journeys">
                    <div className="h-[500px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={topDestinations}
                                layout="vertical"
                                margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                <XAxis type="number" tickFormatter={(v) => v.toLocaleString()} />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    width={150}
                                    tick={{ fontSize: 11 }}
                                />
                                <Tooltip
                                    formatter={(value: number) => [fmt(value), 'Arrivals']}
                                    labelFormatter={(_: string, payload) => payload?.[0]?.payload?.fullName || ''}
                                />
                                <Bar dataKey="value" fill="#a78bfa" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </ChartCard>
            </div>

            {/* Combined Volume Table */}
            <ChartCard
                title="Total Volume Rankings"
                subtitle="Combined origin + destination journeys per station"
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200">
                                <th className="text-left py-2 px-3 text-gray-500 font-medium w-12">#</th>
                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Station</th>
                                <th className="text-right py-2 px-3 text-gray-500 font-medium">Origin</th>
                                <th className="text-right py-2 px-3 text-gray-500 font-medium">Destination</th>
                                <th className="text-right py-2 px-3 text-gray-500 font-medium">Total Volume</th>
                                <th className="text-right py-2 px-3 text-gray-500 font-medium w-20">% Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {topByVolume.map((station, i) => (
                                <tr
                                    key={station.name}
                                    className="border-b border-gray-50 hover:bg-gray-50"
                                >
                                    <td className="py-2 px-3 text-gray-400 text-xs">{i + 1}</td>
                                    <td className="py-2 px-3 text-xs text-gray-700 font-medium">{station.name}</td>
                                    <td className="py-2 px-3 text-right text-xs text-gray-600">{fmt(station.totalOrigin)}</td>
                                    <td className="py-2 px-3 text-right text-xs text-gray-600">{fmt(station.totalDestination)}</td>
                                    <td className="py-2 px-3 text-right font-bold text-gray-900">{fmt(station.totalVolume)}</td>
                                    <td className="py-2 px-3 text-right text-xs text-gray-400">
                                        {((station.totalVolume / (data.totalJourneys * 2)) * 100).toFixed(2)}%
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </ChartCard>
        </div>
    );
};
