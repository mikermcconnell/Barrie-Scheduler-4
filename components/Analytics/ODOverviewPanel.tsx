/**
 * OD Overview Panel
 *
 * Summary dashboard with metric cards, OD map, and import metadata.
 */

import React, { useMemo } from 'react';
import {
    Network,
    MapPin,
    ArrowUpRight,
    ArrowDownLeft,
} from 'lucide-react';
import { MetricCard, ChartCard, fmt } from './AnalyticsShared';
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';
import { ODFlowMapModule } from './ODFlowMapModule';

interface ODOverviewPanelProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
    onNavigate: (tabId: string) => void;
}

export const ODOverviewPanel: React.FC<ODOverviewPanelProps> = ({ data, geocodeCache, onNavigate }) => {
    const topOrigin = useMemo(() => {
        const sorted = [...data.stations].sort((a, b) => b.totalOrigin - a.totalOrigin);
        return sorted[0];
    }, [data.stations]);

    const topDestination = useMemo(() => {
        const sorted = [...data.stations].sort((a, b) => b.totalDestination - a.totalDestination);
        return sorted[0];
    }, [data.stations]);

    return (
        <div className="space-y-6">
            {/* Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    icon={<Network size={18} />}
                    label="Total Journeys"
                    value={fmt(data.totalJourneys)}
                    color="indigo"
                />
                <MetricCard
                    icon={<MapPin size={18} />}
                    label="Stations"
                    value={fmt(data.stationCount)}
                    color="cyan"
                />
                <MetricCard
                    icon={<ArrowUpRight size={18} />}
                    label="Top Origin"
                    value={topOrigin?.name || '-'}
                    color="emerald"
                    subValue={topOrigin ? `${fmt(topOrigin.totalOrigin)} departures` : undefined}
                />
                <MetricCard
                    icon={<ArrowDownLeft size={18} />}
                    label="Top Destination"
                    value={topDestination?.name || '-'}
                    color="amber"
                    subValue={topDestination ? `${fmt(topDestination.totalDestination)} arrivals` : undefined}
                />
            </div>

            {/* OD Map */}
            <ODFlowMapModule data={data} geocodeCache={geocodeCache} />

            {/* Import Metadata + Quick Links */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <ChartCard title="Import Details" subtitle="Current dataset information">
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-gray-500">File</span>
                            <span className="font-medium text-gray-900">{data.metadata.fileName}</span>
                        </div>
                        {data.metadata.dateRange && (
                            <div className="flex justify-between">
                                <span className="text-gray-500">Date Range</span>
                                <span className="font-medium text-gray-900">{data.metadata.dateRange}</span>
                            </div>
                        )}
                        <div className="flex justify-between">
                            <span className="text-gray-500">Imported</span>
                            <span className="font-medium text-gray-900">
                                {new Date(data.metadata.importedAt).toLocaleDateString()}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-500">OD Pairs</span>
                            <span className="font-medium text-gray-900">{fmt(data.pairs.length)}</span>
                        </div>
                    </div>
                </ChartCard>

                <ChartCard title="Quick Navigation" subtitle="Jump to detailed analysis">
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { id: 'top-pairs', label: 'Top Pairs', desc: 'Busiest OD pairs' },
                            { id: 'rankings', label: 'Rankings', desc: 'Station leaderboard' },
                            { id: 'flow-map', label: 'Flow Map', desc: 'Geographic flows' },
                            { id: 'heatmap', label: 'Heatmap', desc: 'Matrix grid view' },
                        ].map(item => (
                            <button
                                key={item.id}
                                onClick={() => onNavigate(item.id)}
                                className="text-left p-3 rounded-lg border border-gray-100 hover:border-violet-200 hover:bg-violet-50/30 transition-colors"
                            >
                                <p className="text-sm font-medium text-gray-900">{item.label}</p>
                                <p className="text-xs text-gray-400">{item.desc}</p>
                            </button>
                        ))}
                    </div>
                </ChartCard>
            </div>
        </div>
    );
};
