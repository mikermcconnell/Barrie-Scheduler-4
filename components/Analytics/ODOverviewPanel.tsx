/**
 * OD Overview Panel
 *
 * Summary dashboard with metric cards, OD map, and import metadata.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
    Network,
    MapPin,
    ArrowUpRight,
    ArrowDownLeft,
} from 'lucide-react';
import { MetricCard, fmt } from './AnalyticsShared';
import type { ODMatrixDataSummary, GeocodeCache } from '../../utils/od-matrix/odMatrixTypes';
import type { ODRouteEstimationResult } from '../../utils/od-matrix/odRouteEstimation';
import { ODFlowMapModule } from './ODFlowMapModule';
import {
    buildScopedGeoLookup,
    buildVisibleStopMetrics,
    filterODPairs,
    getGeocodedPairs,
    type ODDirectionFilter,
} from '../../utils/od-matrix/odFlowMapMetrics';

interface ODOverviewPanelProps {
    data: ODMatrixDataSummary;
    geocodeCache: GeocodeCache | null;
    onNavigate: (tabId: string) => void;
    onFixCoordinates: () => void;
    onMapElReady?: (el: HTMLDivElement) => void;
    onIsolatedStationChange?: (station: string | null) => void;
    isolatedStation?: string | null;
    routeEstimation?: ODRouteEstimationResult | null;
    routeEstimationLoading?: boolean;
}

export const ODOverviewPanel: React.FC<ODOverviewPanelProps> = ({
    data,
    geocodeCache,
    onNavigate,
    onFixCoordinates,
    onMapElReady,
    onIsolatedStationChange,
    isolatedStation,
    routeEstimation,
    routeEstimationLoading,
}) => {
    const [minJourneys, setMinJourneys] = useState(1);
    const [directionFilter, setDirectionFilter] = useState<ODDirectionFilter>('all');

    useEffect(() => {
        if (!isolatedStation) setDirectionFilter('all');
    }, [isolatedStation]);

    const topOrigin = useMemo(() => {
        const sorted = [...data.stations].sort((a, b) => b.totalOrigin - a.totalOrigin);
        return sorted[0];
    }, [data.stations]);

    const topDestination = useMemo(() => {
        const sorted = [...data.stations].sort((a, b) => b.totalDestination - a.totalDestination);
        return sorted[0];
    }, [data.stations]);

    const { geoLookup } = useMemo(
        () => buildScopedGeoLookup(data.stations, geocodeCache),
        [data.stations, geocodeCache],
    );

    const geocodedPairs = useMemo(
        () => getGeocodedPairs(data.pairs, geoLookup),
        [data.pairs, geoLookup],
    );

    const visibleStopPairs = useMemo(() => filterODPairs({
        pairs: geocodedPairs,
        isolatedStation: isolatedStation ?? null,
        directionFilter,
        minJourneys,
    }), [geocodedPairs, isolatedStation, directionFilter, minJourneys]);

    // Stop-focused metrics when a station is isolated
    const stopMetrics = useMemo(() => {
        return buildVisibleStopMetrics(visibleStopPairs, isolatedStation ?? null);
    }, [visibleStopPairs, isolatedStation]);

    const stopMetricSubValue = useMemo(() => {
        if (!isolatedStation) return undefined;
        const directionLabel = directionFilter === 'all'
            ? 'all directions'
            : directionFilter === 'outbound'
                ? 'outbound only'
                : 'inbound only';
        return `${fmt(data.totalJourneys)} network-wide · mapped pairs · ${directionLabel}`;
    }, [data.totalJourneys, directionFilter, isolatedStation]);

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
                    subValue={stopMetrics ? stopMetricSubValue : undefined}
                />
                <MetricCard
                    icon={<MapPin size={18} />}
                    label={stopMetrics ? 'Connections' : 'Stations'}
                    value={fmt(stopMetrics ? stopMetrics.connections : data.stationCount)}
                    color="cyan"
                    subValue={stopMetrics ? `mapped pairs · of ${fmt(data.stationCount)} stations` : undefined}
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
                isolatedStation={isolatedStation ?? null}
                minJourneys={minJourneys}
                onMinJourneysChange={setMinJourneys}
                directionFilter={directionFilter}
                onDirectionFilterChange={setDirectionFilter}
                routeEstimation={routeEstimation}
                routeEstimationLoading={routeEstimationLoading}
            />

        </div>
    );
};
