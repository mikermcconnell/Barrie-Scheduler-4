import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Source, Layer, Marker, Popup } from 'react-map-gl/mapbox';
import type { LayerProps, MapRef } from 'react-map-gl/mapbox';
import { MapBase, toGeoJSON } from '../shared';
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

interface StopEntry {
    stopId: string;
    stopName: string;
    worstDevSec: number | null;
    tripIndex: number;
    tripColor: string;
    isBackUnderThreshold: boolean;
    isRecovery: boolean;
    lat: number;
    lon: number;
}

interface PopupInfo {
    lat: number;
    lon: number;
    content: string;
}

const CascadeRouteMap: React.FC<CascadeRouteMapProps> = ({
    cascade,
    selectedPointIndex,
    selectedTripIndex,
    stopLoadLookup,
}) => {
    const mapRef = useRef<MapRef | null>(null);
    const [popup, setPopup] = useState<PopupInfo | null>(null);

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
    const selectedPoint = selectedPointIndex !== null ? timelinePoints[selectedPointIndex] ?? null : null;
    const thresholdStopName = (cascade.backUnderThresholdAtStop ?? cascade.recoveredAtStop ?? '').toLowerCase();

    // Check if any coords are available for a fallback message
    const hasAnyCoords = useMemo(() => {
        if (gtfsCoords.get(cascade.stopId)) return true;
        return timelinePoints.some(pt => gtfsCoords.has(pt.stopId));
    }, [cascade.stopId, timelinePoints, gtfsCoords]);

    // ── GeoJSON: gray base route polyline ────────────────────────────────────
    const routeShapeGeoJSON = useMemo((): GeoJSON.FeatureCollection | null => {
        if (!routeShape || routeShape.points.length < 2) return null;
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'LineString',
                    coordinates: routeShape.points.map(([lat, lon]) => toGeoJSON([lat, lon])),
                },
            }],
        };
    }, [routeShape]);

    const routeBaseLayerStyle: LayerProps = {
        id: 'cascade-route-base',
        type: 'line',
        paint: {
            'line-color': '#9ca3af',
            'line-width': 3,
            'line-opacity': 0.3,
        },
    };

    // ── GeoJSON: trip-colored segments ───────────────────────────────────────
    const tripSegmentsGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
        const features: GeoJSON.Feature[] = [];

        for (const seg of tripSegments) {
            const segPoints = timelinePoints.filter(p => p.tripIndex === seg.tripIndex);
            const coords: [number, number][] = [];
            for (const pt of segPoints) {
                const c = gtfsCoords.get(pt.stopId);
                if (c) coords.push(toGeoJSON([c.lat, c.lon]));
            }
            if (coords.length < 2) continue;

            const isDimmed = selectedTripIndex !== null && seg.tripIndex !== selectedTripIndex;
            const colors = TRIP_FILL_COLORS[seg.color];

            features.push({
                type: 'Feature',
                properties: {
                    tripColor: colors.stroke,
                    lineWidth: isDimmed ? 1.5 : 4,
                    lineOpacity: isDimmed ? 0.3 : 0.85,
                },
                geometry: {
                    type: 'LineString',
                    coordinates: coords,
                },
            });
        }

        return { type: 'FeatureCollection', features };
    }, [tripSegments, timelinePoints, gtfsCoords, selectedTripIndex]);

    const tripSegmentsLayerStyle: LayerProps = {
        id: 'cascade-trip-segments',
        type: 'line',
        paint: {
            'line-color': ['get', 'tripColor'],
            'line-width': ['get', 'lineWidth'],
            'line-opacity': ['get', 'lineOpacity'],
        },
    };

    // ── Build deduplicated stop entries for markers ───────────────────────────
    const stopEntries = useMemo((): StopEntry[] => {
        const stopMap = new Map<string, StopEntry>();

        for (const pt of timelinePoints) {
            const devSec = pt.deviationMinutes != null ? pt.deviationMinutes * 60 : null;
            const trip = cascade.cascadedTrips[pt.tripIndex];
            const color = trip ? getTripNodeColor(trip) : 'red';
            const coords = gtfsCoords.get(pt.stopId);
            if (!coords) continue;

            const existing = stopMap.get(pt.stopId);
            if (!existing) {
                stopMap.set(pt.stopId, {
                    stopId: pt.stopId,
                    stopName: pt.stopName,
                    worstDevSec: devSec,
                    tripIndex: pt.tripIndex,
                    tripColor: TRIP_FILL_COLORS[color].stroke,
                    isBackUnderThreshold: false,
                    isRecovery: false,
                    lat: coords.lat,
                    lon: coords.lon,
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

        if (thresholdStopName) {
            for (const entry of stopMap.values()) {
                if (entry.stopName.toLowerCase() === thresholdStopName) {
                    entry.isBackUnderThreshold = true;
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

        return Array.from(stopMap.values());
    }, [timelinePoints, cascade, gtfsCoords, thresholdStopName]);

    // ── Fit bounds after map loads ────────────────────────────────────────────
    const handleMapLoad = useCallback(() => {
        const map = mapRef.current?.getMap();
        if (!map) return;

        const lats: number[] = [];
        const lons: number[] = [];

        for (const entry of stopEntries) {
            lats.push(entry.lat);
            lons.push(entry.lon);
        }
        const originCoords = gtfsCoords.get(cascade.stopId);
        if (originCoords) {
            lats.push(originCoords.lat);
            lons.push(originCoords.lon);
        }

        if (lats.length > 1) {
            const minLat = Math.min(...lats);
            const maxLat = Math.max(...lats);
            const minLon = Math.min(...lons);
            const maxLon = Math.max(...lons);
            map.fitBounds(
                [[minLon, minLat], [maxLon, maxLat]],
                { padding: 40, maxZoom: 15, duration: 0 },
            );
        } else if (lats.length === 1) {
            map.setCenter([lons[0], lats[0]]);
            map.setZoom(14);
        }
    }, [stopEntries, gtfsCoords, cascade.stopId]);

    // ── Tooltip builders ─────────────────────────────────────────────────────
    function buildStopTooltip(entry: StopEntry): string {
        let devLabel = 'No data';
        if (entry.worstDevSec != null) {
            const sign = entry.worstDevSec >= 0 ? '+' : '';
            devLabel = `${sign}${(entry.worstDevSec / 60).toFixed(1)} min`;
        }
        let text = entry.isRecovery
            ? `${entry.stopName}\nRecovery stop\n${devLabel}`
            : entry.isBackUnderThreshold
                ? `${entry.stopName}\nBack under 5 min\n${devLabel}`
                : `${entry.stopName}\n${devLabel}`;
        const loadData = stopLoadLookup.get(`${cascade.routeId}_${entry.stopId}`);
        if (loadData) {
            text += `\n${loadData.avgBoardings.toFixed(0)} boarding · load: ${loadData.avgLoad.toFixed(0)}`;
        }
        return text;
    }

    function buildOriginTooltip(originCoords: { lat: number; lon: number }): string {
        const originMin = (cascade.trackedDwellSeconds / 60).toFixed(1);
        const isAlsoRecovery = cascade.recoveredAtStop
            && cascade.recoveredAtStop.toLowerCase() === cascade.stopName.toLowerCase();
        let text = `⚡ ${cascade.stopName}\nDwell event origin\n${originMin} min excess`;
        if (isAlsoRecovery) text += '\n✓ Also recovery stop';
        const originLoad = stopLoadLookup.get(`${cascade.routeId}_${cascade.stopId}`);
        if (originLoad) {
            text += `\n${originLoad.avgBoardings.toFixed(0)} boarding · load: ${originLoad.avgLoad.toFixed(0)}`;
        }
        // suppress unused warning — originCoords is passed to keep the call site symmetric
        void originCoords;
        return text;
    }

    if (!hasAnyCoords) {
        return (
            <div
                className="flex w-full items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 text-sm font-semibold text-gray-400"
                style={{ height: 300 }}
            >
                No stop coordinates available for this cascade
            </div>
        );
    }

    const originCoords = gtfsCoords.get(cascade.stopId);

    return (
        <>
            <style>{`
                @keyframes cascadePulse {
                    0% { transform: scale(1); opacity: 1; }
                    100% { transform: scale(2.2); opacity: 0; }
                }
                .cascade-pulse-ring {
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    background: rgba(220,38,38,0.15);
                    border: 2px solid rgba(220,38,38,0.5);
                    animation: cascadePulse 2s ease-out infinite;
                }
            `}</style>

            <div className="w-full rounded-lg" style={{ height: 300, position: 'relative' }}>
                <MapBase
                    mapRef={mapRef}
                    mapStyle="mapbox://styles/mapbox/light-v11"
                    showNavigation
                    onLoad={handleMapLoad}
                    style={{ borderRadius: '0.5rem' }}
                >
                    {/* Gray base route polyline */}
                    {routeShapeGeoJSON && (
                        <Source id="cascade-route-base" type="geojson" data={routeShapeGeoJSON}>
                            <Layer {...routeBaseLayerStyle} />
                        </Source>
                    )}

                    {/* Trip-colored segments */}
                    <Source id="cascade-trip-segments" type="geojson" data={tripSegmentsGeoJSON}>
                        <Layer {...tripSegmentsLayerStyle} />
                    </Source>

                    {/* Timepoint stop markers (non-origin) */}
                    {stopEntries
                        .filter(entry => entry.stopId !== cascade.stopId)
                        .map(entry => {
                            const isDimmed = selectedTripIndex !== null && entry.tripIndex !== selectedTripIndex;
                            const isSelectedPoint = selectedPoint?.stopId === entry.stopId;
                            const fillColor = devColor(entry.worstDevSec);
                            const tooltipText = buildStopTooltip(entry);

                            return (
                                <Marker
                                    key={entry.stopId}
                                    longitude={entry.lon}
                                    latitude={entry.lat}
                                    anchor="center"
                                >
                                    {entry.isRecovery ? (
                                        // Recovery stop: green border + checkmark
                                        <div
                                            style={{
                                                width: 22,
                                                height: 22,
                                                borderRadius: '50%',
                                                background: fillColor,
                                                border: '2.5px solid #065f46',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                boxShadow: isSelectedPoint ? '0 0 0 4px rgba(16,185,129,0.22)' : undefined,
                                                opacity: isDimmed ? 0.2 : 1,
                                                cursor: 'pointer',
                                            }}
                                            title={tooltipText}
                                            onClick={() => setPopup({ lat: entry.lat, lon: entry.lon, content: tooltipText })}
                                        >
                                            <svg width="10" height="10" viewBox="0 0 10 10">
                                                <path
                                                    d="M2 5 L4 7 L8 3"
                                                    fill="none"
                                                    stroke="white"
                                                    strokeWidth="1.5"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        </div>
                                    ) : entry.isBackUnderThreshold ? (
                                        <div
                                            style={{
                                                width: 18,
                                                height: 18,
                                                borderRadius: '50%',
                                                background: '#ffffff',
                                                border: '2.5px solid #2563eb',
                                                boxShadow: isSelectedPoint ? '0 0 0 4px rgba(37,99,235,0.18)' : undefined,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                opacity: isDimmed ? 0.25 : 1,
                                                cursor: 'pointer',
                                            }}
                                            title={tooltipText}
                                            onClick={() => setPopup({ lat: entry.lat, lon: entry.lon, content: tooltipText })}
                                        >
                                            <div
                                                style={{
                                                    width: 8,
                                                    height: 8,
                                                    borderRadius: '50%',
                                                    background: fillColor,
                                                }}
                                            />
                                        </div>
                                    ) : (
                                        // Standard timepoint marker with trip-colored border
                                        <div
                                            style={{
                                                width: 12,
                                                height: 12,
                                                borderRadius: '50%',
                                                background: fillColor,
                                                border: `2px solid ${entry.tripColor}`,
                                                boxShadow: isSelectedPoint ? '0 0 0 4px rgba(15,23,42,0.12)' : undefined,
                                                opacity: isDimmed ? 0.3 : 0.85,
                                                cursor: 'pointer',
                                            }}
                                            title={tooltipText}
                                            onClick={() => setPopup({ lat: entry.lat, lon: entry.lon, content: tooltipText })}
                                        />
                                    )}
                                </Marker>
                            );
                        })}

                    {/* Origin stop marker — rendered last to stay on top */}
                    {originCoords && (() => {
                        const tooltipText = buildOriginTooltip(originCoords);
                        return (
                            <>
                                {/* Pulsing ring (non-interactive, behind bolt) */}
                                <Marker
                                    longitude={originCoords.lon}
                                    latitude={originCoords.lat}
                                    anchor="center"
                                >
                                    <div className="cascade-pulse-ring" style={{ pointerEvents: 'none' }} />
                                </Marker>

                                {/* Solid center with bolt icon */}
                                <Marker
                                    longitude={originCoords.lon}
                                    latitude={originCoords.lat}
                                    anchor="center"
                                >
                                    <div
                                        style={{
                                            width: 28,
                                            height: 28,
                                            borderRadius: '50%',
                                            background: '#dc2626',
                                            border: '3px solid #991b1b',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                        }}
                                        title={tooltipText}
                                        onClick={() => setPopup({ lat: originCoords.lat, lon: originCoords.lon, content: tooltipText })}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                                            <path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z" />
                                        </svg>
                                    </div>
                                </Marker>
                            </>
                        );
                    })()}

                    {/* Click popup */}
                    {popup && (
                        <Popup
                            longitude={popup.lon}
                            latitude={popup.lat}
                            anchor="top"
                            onClose={() => setPopup(null)}
                            closeButton
                            closeOnClick={false}
                        >
                            <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-line', maxWidth: 200 }}>
                                {popup.content}
                            </div>
                        </Popup>
                    )}
                </MapBase>

                {/* Legend — absolutely positioned bottom-left inside the map container */}
                <div
                    style={{
                        position: 'absolute',
                        bottom: 28,
                        left: 10,
                        background: 'white',
                        padding: '6px 10px',
                        borderRadius: 6,
                        fontSize: 10,
                        lineHeight: 1.6,
                        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                        pointerEvents: 'none',
                        zIndex: 10,
                    }}
                >
                    {([
                        { color: '#ef4444', label: 'All late' },
                        { color: '#f59e0b', label: 'Some late' },
                        { color: '#10b981', label: 'Recovered to zero' },
                    ] as const).map(({ color, label }) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ color, fontWeight: 600, fontSize: 11 }}>━━</span>
                            <span>{label}</span>
                        </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, color: '#2563eb' }}>◉</span>
                        <span>Back under 5 min</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ fontSize: 11, color: '#dc2626' }}>⚡</span>
                        <span>Dwell origin</span>
                    </div>
                </div>
            </div>
        </>
    );
};

export default CascadeRouteMap;
