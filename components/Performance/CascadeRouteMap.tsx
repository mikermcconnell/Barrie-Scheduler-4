import React, { useRef, useEffect, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import { buildTimelinePoints } from '../../utils/schedule/cascadeStoryUtils';
import type { DwellCascade } from '../../utils/performanceDataTypes';

interface CascadeRouteMapProps {
    cascade: DwellCascade;
    selectedPointIndex: number | null;
    selectedTripIndex: number | null;
}

function devColor(devSec: number | null): string {
    if (devSec == null) return '#9ca3af';
    if (devSec > 300) return '#ef4444';
    if (devSec > 120) return '#f59e0b';
    return '#10b981';
}

const CascadeRouteMap: React.FC<CascadeRouteMapProps> = ({
    cascade,
    selectedPointIndex,
    selectedTripIndex,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markerLayerRef = useRef<L.LayerGroup | null>(null);

    // Build stop_id → coords map from GTFS stops.txt (cached, bundled at build time)
    const gtfsCoords = useMemo(() => {
        const stops = getAllStopsWithCoords();
        const m = new Map<string, { lat: number; lon: number; name: string }>();
        for (const s of stops) {
            m.set(s.stop_id, { lat: s.lat, lon: s.lon, name: s.stop_name });
        }
        return m;
    }, []);

    // ── Map initialization ───────────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = L.map(containerRef.current, {
            center: [44.38, -79.69],
            zoom: 13,
            zoomControl: true,
            zoomSnap: 0.25,
            scrollWheelZoom: 'center',
            preferCanvas: true,
        });

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19,
        }).addTo(map);

        markerLayerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;

        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(containerRef.current!);

        return () => {
            ro.disconnect();
            map.remove();
            mapRef.current = null;
            markerLayerRef.current = null;
        };
    }, []);

    // ── Marker update ────────────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        const layer = markerLayerRef.current;
        if (!map || !layer) return;

        layer.clearLayers();

        const points = buildTimelinePoints(cascade.cascadedTrips);

        // Deduplicate stops by stopId, keeping worst (highest) deviationSeconds per stop
        const stopMap = new Map<string, {
            stopId: string;
            stopName: string;
            worstDevSec: number | null;
            tripIndex: number;
            isRecovery: boolean;
        }>();

        for (const pt of points) {
            const existing = stopMap.get(pt.stopId);
            const devSec = pt.deviationMinutes != null ? pt.deviationMinutes * 60 : null;
            if (!existing) {
                stopMap.set(pt.stopId, {
                    stopId: pt.stopId,
                    stopName: pt.stopName,
                    worstDevSec: devSec,
                    tripIndex: pt.tripIndex,
                    isRecovery: false,
                });
            } else {
                const prevDev = existing.worstDevSec ?? -Infinity;
                const curDev = devSec ?? -Infinity;
                if (curDev > prevDev) {
                    existing.worstDevSec = devSec;
                    existing.tripIndex = pt.tripIndex;
                }
            }
        }

        // Mark recovery stop by name match against cascade.recoveredAtStop
        if (cascade.recoveredAtStop) {
            const recoveryName = cascade.recoveredAtStop.toLowerCase();
            for (const entry of stopMap.values()) {
                if (entry.stopName.toLowerCase() === recoveryName) {
                    entry.isRecovery = true;
                }
            }
        }

        const boundsPoints: L.LatLng[] = [];

        // Origin stop marker
        const originCoords = gtfsCoords.get(cascade.stopId);
        if (originCoords) {
            const originMin = (cascade.trackedDwellSeconds / 60).toFixed(1);
            const originMarker = L.circleMarker([originCoords.lat, originCoords.lon], {
                radius: 12,
                fillColor: '#dc2626',
                color: '#991b1b',
                weight: 3,
                opacity: 1,
                fillOpacity: 0.9,
            });
            originMarker.bindTooltip(
                `\u26a1 ${cascade.stopName}\nDwell event origin\n${originMin} min excess`,
                { sticky: true }
            );
            originMarker.addTo(layer);
            boundsPoints.push(L.latLng(originCoords.lat, originCoords.lon));
        }

        // Timepoint stop markers
        for (const entry of stopMap.values()) {
            const coords = gtfsCoords.get(entry.stopId);
            if (!coords) continue;

            const isDimmed = selectedTripIndex !== null && entry.tripIndex !== selectedTripIndex;
            const fillColor = devColor(entry.worstDevSec);
            const radius = entry.isRecovery ? 9 : 6;
            const fillOpacity = isDimmed ? 0.2 : 0.85;
            const borderColor = entry.isRecovery ? '#065f46' : '#374151';
            const weight = entry.isRecovery ? 2.5 : 1.5;

            const marker = L.circleMarker([coords.lat, coords.lon], {
                radius,
                fillColor,
                color: borderColor,
                weight,
                opacity: isDimmed ? 0.3 : 1,
                fillOpacity,
            });

            let devLabel = 'No data';
            if (entry.worstDevSec != null) {
                const sign = entry.worstDevSec >= 0 ? '+' : '';
                devLabel = `${sign}${(entry.worstDevSec / 60).toFixed(1)} min`;
            }
            const recoveryNote = entry.isRecovery ? '\nRecovery stop' : '';
            marker.bindTooltip(
                `${entry.stopName}\n${devLabel}${recoveryNote}`,
                { sticky: true }
            );
            marker.addTo(layer);
            boundsPoints.push(L.latLng(coords.lat, coords.lon));
        }

        // Fit bounds
        if (boundsPoints.length > 1) {
            map.fitBounds(L.latLngBounds(boundsPoints), {
                padding: L.point(40, 40),
                maxZoom: 15,
            });
        } else if (boundsPoints.length === 1) {
            map.setView(boundsPoints[0], 14);
        }
    }, [cascade, selectedTripIndex, selectedPointIndex, gtfsCoords]);

    // Check if any coords are available for a fallback message
    const hasAnyCoords = useMemo(() => {
        if (gtfsCoords.get(cascade.stopId)) return true;
        const points = buildTimelinePoints(cascade.cascadedTrips);
        return points.some(pt => gtfsCoords.has(pt.stopId));
    }, [cascade, gtfsCoords]);

    if (!hasAnyCoords) {
        return (
            <div
                className="w-full rounded-lg flex items-center justify-center text-gray-400 text-sm bg-gray-50"
                style={{ height: 300 }}
            >
                No stop coordinates available for this cascade
            </div>
        );
    }

    return (
        <div ref={containerRef} className="w-full rounded-lg" style={{ height: 300 }} />
    );
};

export default CascadeRouteMap;
