import React, { useEffect, useMemo, useRef } from 'react';
import { Marker } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import { ArcLayer, MapBase, RouteOverlay } from '../shared';
import type { RouteShape } from '../shared';
import type {
    NetworkConnectionHub,
    NetworkConnectionHubStop,
    NetworkConnectionOpportunity,
    NetworkConnectionSeverity,
} from '../../utils/network-connections/networkConnectionTypes';

interface NetworkConnectionsMapProps {
    hubs: NetworkConnectionHub[];
    selectedHubId: string | null;
    onSelectHub: (hubId: string) => void;
    backgroundRouteShapes: RouteShape[];
    focusRouteShapes: RouteShape[];
    hubStops: NetworkConnectionHubStop[];
    selectedOpportunity: NetworkConnectionOpportunity | null;
}

function severityClasses(severity: NetworkConnectionSeverity, selected: boolean): string {
    if (selected) return 'bg-brand-blue ring-brand-blue/30 text-white';
    if (severity === 'weak') return 'bg-red-500 ring-red-200 text-white';
    if (severity === 'mixed') return 'bg-amber-400 ring-amber-200 text-amber-950';
    return 'bg-emerald-500 ring-emerald-200 text-white';
}

function markerSize(routeCount: number): number {
    if (routeCount >= 5) return 34;
    if (routeCount >= 3) return 28;
    return 22;
}

function stopTone(stopId: string, selectedOpportunity: NetworkConnectionOpportunity | null): string {
    if (!selectedOpportunity) return 'border-white/90 bg-white text-gray-700 shadow-sm';
    if (stopId === selectedOpportunity.fromStopId) return 'border-cyan-200 bg-cyan-500 text-white shadow-md';
    if (stopId === selectedOpportunity.toStopId) return 'border-violet-200 bg-violet-500 text-white shadow-md';
    return 'border-white/90 bg-white/90 text-gray-600 shadow-sm';
}

export const NetworkConnectionsMap: React.FC<NetworkConnectionsMapProps> = ({
    hubs,
    selectedHubId,
    onSelectHub,
    backgroundRouteShapes,
    focusRouteShapes,
    hubStops,
    selectedOpportunity,
}) => {
    const mapRef = useRef<MapRef | null>(null);

    const selectedHub = useMemo(
        () => hubs.find((hub) => hub.id === selectedHubId) ?? null,
        [hubs, selectedHubId],
    );

    const stopLookup = useMemo(() => new Map(hubStops.map((stop) => [stop.stopId, stop])), [hubStops]);

    const opportunityArc = useMemo(() => {
        if (!selectedOpportunity?.toStopId) return [];
        const fromStop = stopLookup.get(selectedOpportunity.fromStopId);
        const toStop = stopLookup.get(selectedOpportunity.toStopId);
        if (!fromStop || !toStop) return [];
        if (fromStop.stopId === toStop.stopId) return [];

        return [{
            origin: [fromStop.lon, fromStop.lat] as [number, number],
            dest: [toStop.lon, toStop.lat] as [number, number],
            color: '#4f46e5',
            width: 4,
            opacity: 0.85,
            curveDirection: 1 as const,
            showArrowhead: true,
        }];
    }, [selectedOpportunity, stopLookup]);

    useEffect(() => {
        if (!selectedHub || !mapRef.current) return;
        mapRef.current.flyTo({
            center: [selectedHub.lon, selectedHub.lat],
            zoom: 14.6,
            duration: 700,
            essential: true,
        });
    }, [selectedHub]);

    return (
        <div className="h-[560px] overflow-hidden rounded-[28px]">
            <MapBase
                className="h-full w-full"
                showNavigation
                showScale
                mapRef={mapRef}
            >
                <RouteOverlay
                    shapes={backgroundRouteShapes}
                    opacity={focusRouteShapes.length > 0 ? 0.2 : 0.45}
                    weight={4}
                    dashed={false}
                    idPrefix="network-connections-routes-context"
                />
                <RouteOverlay
                    shapes={focusRouteShapes}
                    opacity={0.82}
                    weight={5}
                    dashed={false}
                    idPrefix="network-connections-routes-focus"
                />
                <ArcLayer
                    arcs={opportunityArc}
                    showArrowheads
                    idPrefix="network-connections-opportunity"
                />

                {hubStops.map((stop) => (
                    <Marker key={stop.stopId} longitude={stop.lon} latitude={stop.lat} anchor="center">
                        <div
                            className={`grid h-7 w-7 place-items-center rounded-full border-2 text-[10px] font-extrabold transition-all ${stopTone(stop.stopId, selectedOpportunity)}`}
                            title={`${stop.stopName}: ${stop.routeNumbers.join(', ')}`}
                        >
                            {stop.routeNumbers.length}
                        </div>
                    </Marker>
                ))}

                {hubs.map((hub) => {
                    const selected = hub.id === selectedHubId;
                    const size = markerSize(hub.routeNumbers.length);
                    return (
                        <Marker key={hub.id} longitude={hub.lon} latitude={hub.lat} anchor="center">
                            <button
                                type="button"
                                onClick={() => onSelectHub(hub.id)}
                                className={`relative grid place-items-center rounded-full font-extrabold shadow-sm ring-4 transition-transform hover:scale-105 ${severityClasses(hub.severity, selected)}`}
                                style={{ width: size, height: size }}
                                title={`${hub.name}: ${hub.routeNumbers.join(', ')}`}
                            >
                                <span className="text-[11px] leading-none">{hub.routeNumbers.length}</span>
                                {selected && (
                                    <span className="pointer-events-none absolute inset-[-7px] rounded-full border-2 border-brand-blue/50" />
                                )}
                            </button>
                        </Marker>
                    );
                })}
            </MapBase>
        </div>
    );
};

export default NetworkConnectionsMap;
