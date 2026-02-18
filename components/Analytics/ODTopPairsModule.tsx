/**
 * OD Top Pairs Module
 *
 * Table of highest-volume OD pairs with filter controls
 * and horizontal bar chart. Matches DemandModule table design.
 */

import React, { useMemo, useState } from 'react';
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

interface ODTopPairsModuleProps {
    data: ODMatrixDataSummary;
}

type LimitOption = 25 | 50 | 100;
const LIMIT_OPTIONS: LimitOption[] = [25, 50, 100];

export const ODTopPairsModule: React.FC<ODTopPairsModuleProps> = ({ data }) => {
    const [limit, setLimit] = useState<LimitOption>(25);
    const [search, setSearch] = useState('');

    const filteredPairs = useMemo(() => {
        let pairs = data.topPairs;
        if (search.trim()) {
            const q = search.toLowerCase();
            pairs = pairs.filter(
                p => p.origin.toLowerCase().includes(q) || p.destination.toLowerCase().includes(q)
            );
        }
        return pairs.slice(0, limit);
    }, [data.topPairs, limit, search]);

    const chartData = useMemo(() => {
        return filteredPairs.slice(0, 20).map((p, i) => ({
            label: `${p.origin.slice(0, 15)}→${p.destination.slice(0, 15)}`,
            fullLabel: `${p.origin} → ${p.destination}`,
            journeys: p.journeys,
            rank: i + 1,
        }));
    }, [filteredPairs]);

    return (
        <div className="space-y-6">
            {/* Filter Bar */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 font-medium">Show:</span>
                    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                        {LIMIT_OPTIONS.map(opt => (
                            <button
                                key={opt}
                                onClick={() => setLimit(opt)}
                                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                    limit === opt
                                        ? 'bg-gray-900 text-white'
                                        : 'bg-white text-gray-500 hover:bg-gray-50'
                                }`}
                            >
                                {opt}
                            </button>
                        ))}
                    </div>
                </div>
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search stations..."
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent w-48"
                />
            </div>

            {/* Table */}
            <ChartCard
                title="Top Origin-Destination Pairs"
                subtitle={`Showing ${filteredPairs.length} of ${data.topPairs.length} pairs`}
            >
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200">
                                <th className="text-left py-2 px-3 text-gray-500 font-medium w-12">#</th>
                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Origin Station</th>
                                <th className="text-left py-2 px-3 text-gray-500 font-medium">Destination Station</th>
                                <th className="text-right py-2 px-3 text-gray-500 font-medium">Journeys</th>
                                <th className="text-right py-2 px-3 text-gray-500 font-medium w-20">% Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredPairs.map((pair, i) => (
                                <tr
                                    key={`${pair.origin}-${pair.destination}`}
                                    className="border-b border-gray-50 hover:bg-gray-50"
                                >
                                    <td className="py-2 px-3 text-gray-400 text-xs">{i + 1}</td>
                                    <td className="py-2 px-3 text-xs text-gray-700">{pair.origin}</td>
                                    <td className="py-2 px-3 text-xs text-gray-700">{pair.destination}</td>
                                    <td className="py-2 px-3 text-right font-bold text-gray-900">{fmt(pair.journeys)}</td>
                                    <td className="py-2 px-3 text-right text-xs text-gray-400">
                                        {((pair.journeys / data.totalJourneys) * 100).toFixed(2)}%
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </ChartCard>

            {/* Chart */}
            <ChartCard
                title="Top 20 Pairs"
                subtitle="Highest volume origin-destination movements"
            >
                <div className="h-[500px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={chartData}
                            layout="vertical"
                            margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis type="number" tickFormatter={(v) => v.toLocaleString()} />
                            <YAxis
                                type="category"
                                dataKey="label"
                                width={220}
                                tick={{ fontSize: 11 }}
                            />
                            <Tooltip
                                formatter={(value: number) => [fmt(value), 'Journeys']}
                                labelFormatter={(_: string, payload) => {
                                    const item = payload?.[0]?.payload;
                                    return item?.fullLabel || '';
                                }}
                            />
                            <Bar dataKey="journeys" fill="#7c3aed" radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </ChartCard>
        </div>
    );
};
