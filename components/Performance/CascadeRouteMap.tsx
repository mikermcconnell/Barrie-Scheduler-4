import React, { useRef, useEffect, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import { loadGtfsRouteShapes } from '../../utils/gtfs/gtfsShapesLoader';
import {
    buildTimelinePoints,
    buildTripSegments,
    getTripNodeColor,
    TRIP_FILL_COLORS,
} from '../../utils/schedule/cascadeStoryUtils';
import type { StopLoadData } from '../../utils/schedule/cascadeStoryUtils';
import type { DwellCascade } from '../../utils/performanceDataTypes';

interface CascadeRouteMapProps {
    cascade: DwellCascade;
    selectedPointIndex: number | null;
    selectedTripIndex: number | null;
    stopLoadLookup: Map<string, StopLoadData>;
}

function devColor(devSec: number | null): string {
    if (devSec == null) return '#9ca3af';
    if (devSec > 300) return '#ef4444';
    if (devSec > 120) return '#f59e0b';
    return '#10b981';
}

function buildLegendEntry(container: HTMLElement, color: string, label: string): void {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;';
    const swatch = document.createElement('span');
    swatch.style.cssText = `color:${color};font-weight:600;font-size:11px;`;
    swatch.textContent = '\u2501\u2501';
    const text = document.createElement('span');
    text.textContent = label;
    row.appendChild(swatch);
    row.appendChild(text);
    container.appendChild(row);
}

const CascadeRouteMap: React.FC<CascadeRouteMapProps> = ({
    cascade,
    selectedPointIndex,
    selectedTripIndex,
    stopLoadLookup,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markerLayerRef = useRef<L.LayerGroup | null>(null);
    const legendRef = useRef<L.Control | null>(null);

    // Build stop_id → coords map from GTFS stops.txt (cached, bundled at build time)
    const gtfsCoords = useMemo(() => {
        const stops = getAllStopsWithCoords();
        const m = new Map<string, { lat: number; lon: number; name: string }>();
        for (const s of stops) {
            m.set(s.stop_id, { lat: s.lat, lon: s.lon, name: s.stop_name });
        }
        return m;
    }, []);

    // GTFS route shape for base polyline
    const routeShape = useMemo(() => {
        const shapes = loadGtfsRouteShapes();
        return shapes.find(s => s.routeId === cascade.routeId) ?? null;
    }, [cascade.routeId]);

    // Memoize timeline points and trip segments
    const timelinePoints = useMemo(
        () => buildTimelinePoints(cascade.cascadedTrips),
        [cascade.cascadedTrips],
    );

    const tripSegments = useMemo(
        () => buildTripSegments(cascade.cascadedTrips, timelinePoints),
        [cascade.cascadedTrips, timelinePoints],
    );

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

        // Legend control using safe DOM methods
        const legend = new L.Control({ position: 'bottomleft' });
        legend.onAdd = () => {
            const div = L.DomUtil.create('div', 'leaflet-control');
            div.style.cssText = 'background:white;padding:6px 10px;border-radius:6px;font-size:10px;line-height:1.6;box-shadow:0 1px 4px rgba(0,0,0,0.15);';
            buildLegendEntry(div, '#ef4444', 'All late');
            buildLegendEntry(div, '#f59e0b', 'Some late');
            buildLegendEntry(div, '#10b981', 'Recovered');
            const originRow = document.createElement('div');
            originRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
            const bolt = document.createElement('span');
            bolt.style.cssText = 'font-size:11px;color:#dc2626;';
            bolt.textContent = '\u26a1';
            const originLabel = document.createElement('span');
            originLabel.textContent = 'Dwell origin';
            originRow.appendChild(bolt);
            originRow.appendChild(originLabel);
            div.appendChild(originRow);
            return div;
        };
        legend.addTo(map);
        legendRef.current = legend;

        const ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(containerRef.current!);

        return () => {
            ro.disconnect();
            map.remove();
            mapRef.current = null;
            markerLayerRef.current = null;
            legendRef.current = null;
        };
    }, []);

    // ── Layer update ──────────────────────────────────────────────────────────
    useEffect(() => {
        const map = mapRef.current;
        const layer = markerLayerRef.current;
        if (!map || !layer) return;

        layer.clearLayers();

        const boundsPoints: L.LatLng[] = [];

        // ── 3a: GTFS route polyline (gray base layer) ──
        if (routeShape && routeShape.points.length > 1) {
            const basePolyline = L.polyline(
                routeShape.points.map(([lat, lon]) => [lat, lon] as L.LatLngTuple),
                { color: '#9ca3af', weight: 3, opacity: 0.3 },
            );
            basePolyline.addTo(layer);
        }

        // ── 3b: Trip-colored segments between timepoint stops ──
        for (const seg of tripSegments) {
            const segPoints = timelinePoints.filter(
                p => p.tripIndex === seg.tripIndex,
            );
            const latLngs: L.LatLng[] = [];
            for (const pt of segPoints) {
                const coords = gtfsCoords.get(pt.stopId);
                if (coords) latLngs.push(L.latLng(coords.lat, coords.lon));
            }
            if (latLngs.length < 2) continue;

            const isDimmed = selectedTripIndex !== null && seg.tripIndex !== selectedTripIndex;
            const colors = TRIP_FILL_COLORS[seg.color];

            const polyline = L.polyline(latLngs, {
                color: colors.stroke,
                weight: isDimmed ? 1.5 : 4,
                opacity: isDimmed ? 0.3 : 0.85,
            });
            polyline.addTo(layer);
        }

        // ── Build deduplicated stop map for markers ──
        const stopMap = new Map<string, {
            stopId: string;
            stopName: string;
            worstDevSec: number | null;
            tripIndex: number;
            tripColor: string;
            isRecovery: boolean;
        }>();

        for (const pt of timelinePoints) {
            const devSec = pt.deviationMinutes != null ? pt.deviationMinutes * 60 : null;
            const trip = cascade.cascadedTrips[pt.tripIndex];
            const color = trip ? getTripNodeColor(trip) : 'red';
            const existing = stopMap.get(pt.stopId);
            if (!existing) {
                stopMap.set(pt.stopId, {
                    stopId: pt.stopId,
                    stopName: pt.stopName,
                    worstDevSec: devSec,
                    tripIndex: pt.tripIndex,
                    tripColor: TRIP_FILL_COLORS[color].stroke,
                    isRecovery: false,
                });
            } else {
                const prevDev = existing.worstDevSec ?? -Infinity;
                const curDev = devSec ?? -Infinity;
                if (curDev > prevDev) {
                    existing.worstDevSec = devSec;
                    existing.tripIndex = pt.tripIndex;
                    existing.tripColor = TRIP_FILL_COLORS[color].stroke;
                }
            }
        }

        // Mark recovery stop
        if (cascade.recoveredAtStop) {
            const recoveryName = cascade.recoveredAtStop.toLowerCase();
            for (const entry of stopMap.values()) {
                if (entry.stopName.toLowerCase() === recoveryName) {
                    entry.isRecovery = true;
                }
            }
        }

        // ── 3c/3d: Timepoint stop markers with trip-colored borders + load tooltips ──
        // (Origin stop is rendered separately AFTER this loop to stay on top)
        for (const entry of stopMap.values()) {
            // Skip the dwell origin stop — rendered as bolt marker below
            if (entry.stopId === cascade.stopId) continue;

            const coords = gtfsCoords.get(entry.stopId);
            if (!coords) continue;

            const isDimmed = selectedTripIndex !== null && entry.tripIndex !== selectedTripIndex;
            const fillColor = devColor(entry.worstDevSec);

            if (entry.isRecovery) {
                // Recovery stop: green border + checkmark badge via divIcon
                const markerSize = 22;
                const wrapper = document.createElement('div');
                wrapper.style.cssText = `width:${markerSize}px;height:${markerSize}px;border-radius:50%;background:${fillColor};border:2.5px solid #065f46;display:flex;align-items:center;justify-content:center;opacity:${isDimmed ? 0.2 : 1};`;
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '10');
                svg.setAttribute('height', '10');
                svg.setAttribute('viewBox', '0 0 10 10');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M2 5 L4 7 L8 3');
                path.setAttribute('fill', 'none');
                path.setAttribute('stroke', 'white');
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('stroke-linecap', 'round');
                path.setAttribute('stroke-linejoin', 'round');
                svg.appendChild(path);
                wrapper.appendChild(svg);

                const recoveryIcon = L.divIcon({
                    html: wrapper.outerHTML,
                    className: '',
                    iconSize: [markerSize, markerSize],
                    iconAnchor: [markerSize / 2, markerSize / 2],
                });
                const marker = L.marker([coords.lat, coords.lon], { icon: recoveryIcon });

                let tooltip = `${entry.stopName}\nRecovery stop`;
                if (entry.worstDevSec != null) {
                    const sign = entry.worstDevSec >= 0 ? '+' : '';
                    tooltip += `\n${sign}${(entry.worstDevSec / 60).toFixed(1)} min`;
                }
                const loadData = stopLoadLookup.get(`${cascade.routeId}_${entry.stopId}`);
                if (loadData) {
                    tooltip += `\n${loadData.avgBoardings.toFixed(0)} boarding \u00b7 load: ${loadData.avgLoad.toFixed(0)}`;
                }
                marker.bindTooltip(tooltip, { sticky: true });
                marker.addTo(layer);
            } else {
                // Standard timepoint marker with trip-colored border
                const marker = L.circleMarker([coords.lat, coords.lon], {
                    radius: 6,
                    fillColor,
                    color: entry.tripColor,
                    weight: 2,
                    opacity: isDimmed ? 0.3 : 1,
                    fillOpacity: isDimmed ? 0.2 : 0.85,
                });

                let devLabel = 'No data';
                if (entry.worstDevSec != null) {
                    const sign = entry.worstDevSec >= 0 ? '+' : '';
                    devLabel = `${sign}${(entry.worstDevSec / 60).toFixed(1)} min`;
                }
                let tooltip = `${entry.stopName}\n${devLabel}`;
                const loadData = stopLoadLookup.get(`${cascade.routeId}_${entry.stopId}`);
                if (loadData) {
                    tooltip += `\n${loadData.avgBoardings.toFixed(0)} boarding \u00b7 load: ${loadData.avgLoad.toFixed(0)}`;
                }
                marker.bindTooltip(tooltip, { sticky: true });
                marker.addTo(layer);
            }
            boundsPoints.push(L.latLng(coords.lat, coords.lon));
        }

        // ── 3e: Origin stop marker with pulsing ring + bolt icon (rendered last = on top) ──
        const originCoords = gtfsCoords.get(cascade.stopId);
        if (originCoords) {
            const originMin = (cascade.trackedDwellSeconds / 60).toFixed(1);
            const isAlsoRecovery = cascade.recoveredAtStop
                && cascade.recoveredAtStop.toLowerCase() === cascade.stopName.toLowerCase();

            // Outer pulsing ring
            const pulseEl = document.createElement('div');
            pulseEl.style.cssText = 'width:28px;height:28px;border-radius:50%;background:rgba(220,38,38,0.15);border:2px solid rgba(220,38,38,0.5);animation:cascadePulse 2s ease-out infinite;';
            const pulseIcon = L.divIcon({
                html: pulseEl.outerHTML,
                className: '',
                iconSize: [28, 28],
                iconAnchor: [14, 14],
            });
            L.marker([originCoords.lat, originCoords.lon], { icon: pulseIcon, interactive: false }).addTo(layer);

            // Solid center marker with bolt icon
            const originSize = 28;
            const originWrapper = document.createElement('div');
            originWrapper.style.cssText = `width:${originSize}px;height:${originSize}px;border-radius:50%;background:#dc2626;border:3px solid #991b1b;display:flex;align-items:center;justify-content:center;`;
            const boltSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            boltSvg.setAttribute('width', '14');
            boltSvg.setAttribute('height', '14');
            boltSvg.setAttribute('viewBox', '0 0 24 24');
            boltSvg.setAttribute('fill', 'white');
            const boltPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            boltPath.setAttribute('d', 'M13 2L3 14h9l-1 10 10-12h-9l1-10z');
            boltSvg.appendChild(boltPath);
            originWrapper.appendChild(boltSvg);

            const originIcon = L.divIcon({
                html: originWrapper.outerHTML,
                className: '',
                iconSize: [originSize, originSize],
                iconAnchor: [originSize / 2, originSize / 2],
            });
            const originMarker = L.marker([originCoords.lat, originCoords.lon], { icon: originIcon });

            let originTooltip = `\u26a1 ${cascade.stopName}\nDwell event origin\n${originMin} min excess`;
            if (isAlsoRecovery) {
                originTooltip += '\n\u2713 Also recovery stop';
            }
            const originLoad = stopLoadLookup.get(`${cascade.routeId}_${cascade.stopId}`);
            if (originLoad) {
                originTooltip += `\n${originLoad.avgBoardings.toFixed(0)} boarding \u00b7 load: ${originLoad.avgLoad.toFixed(0)}`;
            }
            originMarker.bindTooltip(originTooltip, { sticky: true });
            originMarker.addTo(layer);
            boundsPoints.push(L.latLng(originCoords.lat, originCoords.lon));
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
    }, [cascade, timelinePoints, tripSegments, selectedTripIndex, gtfsCoords, routeShape, stopLoadLookup]);

    // Check if any coords are available for a fallback message
    const hasAnyCoords = useMemo(() => {
        if (gtfsCoords.get(cascade.stopId)) return true;
        return timelinePoints.some(pt => gtfsCoords.has(pt.stopId));
    }, [cascade.stopId, timelinePoints, gtfsCoords]);

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
        <>
            <style>{`
                @keyframes cascadePulse {
                    0% { transform: scale(1); opacity: 1; }
                    100% { transform: scale(2.2); opacity: 0; }
                }
            `}</style>
            <div ref={containerRef} className="w-full rounded-lg" style={{ height: 300 }} />
        </>
    );
};

export default CascadeRouteMap;
