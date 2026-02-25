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
    onFixCoordinates: () => void;
    onMapElReady?: (el: HTMLDivElement) => void;
    onIsolatedStationChange?: (station: string | null) => void;
    isolatedStation?: string | null;
}

export const ODOverviewPanel: React.FC<ODOverviewPanelProps> = ({ data, geocodeCache, onNavigate, onFixCoordinates, onMapElReady, onIsolatedStationChange, isolatedStation }) => {
    const topOrigin = useMemo(() => {
        const sorted = [...data.stations].sort((a, b) => b.totalOrigin - a.totalOrigin);
        return sorted[0];
    }, [data.stations]);

    const topDestination = useMemo(() => {
        const sorted = [...data.stations].sort((a, b) => b.totalDestination - a.totalDestination);
        return sorted[0];
    }, [data.stations]);

    // Stop-focused metrics when a station is isolated
    const stopMetrics = useMemo(() => {
        if (!isolatedStation) return null;
        const pairs = data.pairs.filter(
            p => p.origin === isolatedStation || p.destination === isolatedStation,
        );
        const totalJourneys = pairs.reduce((sum, p) => sum + p.journeys, 0);
        const connectedStations = new Set(
            pairs.flatMap(p => [p.origin, p.destination].filter(s => s !== isolatedStation)),
        );
        const topOrig = pairs
            .filter(p => p.origin === isolatedStation)
            .sort((a, b) => b.journeys - a.journeys)[0];
        const topDest = pairs
            .filter(p => p.destination === isolatedStation)
            .sort((a, b) => b.journeys - a.journeys)[0];
        return { totalJourneys, connections: connectedStations.size, topOrig, topDest };
    }, [data.pairs, isolatedStation]);

    return (
        <div className="space-y-6">
            {/* Metric Cards */}
            {isolatedStation && (
                <div className="flex items-center gap-2 px-1 text-xs text-violet-600 font-medium">
                    <MapPin size={14} className="text-violet-500" />
                    Showing metrics for <span className="font-bold">{isolatedStation}</span>
                </div>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    icon={<Network size={18} />}
                    label={stopMetrics ? 'Stop Journeys' : 'Total Journeys'}
                    value={fmt(stopMetrics ? stopMetrics.totalJourneys : data.totalJourneys)}
                    color="indigo"
                    subValue={stopMetrics ? `${fmt(data.totalJourneys)} network-wide` : undefined}
                />
                <MetricCard
                    icon={<MapPin size={18} />}
                    label={stopMetrics ? 'Connections' : 'Stations'}
                    value={fmt(stopMetrics ? stopMetrics.connections : data.stationCount)}
                    color="cyan"
                    subValue={stopMetrics ? `of ${fmt(data.stationCount)} stations` : undefined}
                />
                <MetricCard
                    icon={<ArrowUpRight size={18} />}
                    label={stopMetrics ? 'Top Outbound To' : 'Top Origin'}
                    value={stopMetrics
                        ? (stopMetrics.topOrig?.destination || '-')
                        : (topOrigin?.name || '-')}
                    color="emerald"
                    subValue={stopMetrics
                        ? (stopMetrics.topOrig ? `${fmt(stopMetrics.topOrig.journeys)} departures` : undefined)
                        : (topOrigin ? `${fmt(topOrigin.totalOrigin)} departures` : undefined)}
                />
                <MetricCard
                    icon={<ArrowDownLeft size={18} />}
                    label={stopMetrics ? 'Top Inbound From' : 'Top Destination'}
                    value={stopMetrics
                        ? (stopMetrics.topDest?.origin || '-')
                        : (topDestination?.name || '-')}
                    color="amber"
                    subValue={stopMetrics
                        ? (stopMetrics.topDest ? `${fmt(stopMetrics.topDest.journeys)} arrivals` : undefined)
                        : (topDestination ? `${fmt(topDestination.totalDestination)} arrivals` : undefined)}
                />
            </div>

            {/* OD Map */}
            <ODFlowMapModule
                data={data}
                geocodeCache={geocodeCache}
                onFixMissingCoordinates={onFixCoordinates}
                onMapReady={onMapElReady}
                onIsolatedStationChange={onIsolatedStationChange}
            />

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
