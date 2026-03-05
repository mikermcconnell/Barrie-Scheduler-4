import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Marker, Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps, MapRef } from 'react-map-gl/mapbox';
import { Moon, Globe, Bus, GraduationCap } from 'lucide-react';
import { MapBase } from '../shared/MapBase';
import { MapLabel } from '../shared/MapLabel';
import { DrawControl } from '../shared/DrawControl';
import { toLineGeoJSON, toGeoJSON } from '../shared/mapUtils';
import type { SchoolConfig, StudentPassResult } from '../../utils/transit-app/studentPassUtils';
import { useRouteAnimation } from './useRouteAnimation';
import './studentPass.css';

export interface StudentPassMapProps {
    school: SchoolConfig | null;
    result: StudentPassResult | null;
    onPolygonComplete: (coords: [number, number][]) => void;
    onPolygonClear: () => void;
}

// ── Layer style constants ─────────────────────────────────────────────────────

const ZONE_STOPS_LAYER: LayerProps = {
    id: 'zone-stops-circles',
    type: 'circle',
    source: 'zone-stops',
    paint: {
        'circle-radius': 5,
        'circle-color': '#1E293B',
        'circle-stroke-color': '#3B82F6',
        'circle-stroke-width': 2,
        'circle-opacity': 0.9,
        'circle-stroke-opacity': 0.8,
    },
};

function walkLineLayer(id: string, color: string, opacity: number, dasharray: number[]): LayerProps {
    return {
        id,
        type: 'line',
        source: id,
        paint: {
            'line-color': color,
            'line-width': 3,
            'line-opacity': opacity,
            'line-dasharray': dasharray,
        },
    };
}

// ── 3-layer glow system ───────────────────────────────────────────────────────

function glowLayerStyle(id: string, color: string, opacity = 0.15): LayerProps {
    return {
        id,
        type: 'line',
        paint: {
            'line-color': color,
            'line-width': 12,
            'line-opacity': opacity,
            'line-blur': 4,
        },
    };
}

function baseLayerStyle(id: string, color: string, width = 6, opacity = 0.9): LayerProps {
    return {
        id,
        type: 'line',
        paint: {
            'line-color': color,
            'line-width': width,
            'line-opacity': opacity,
        },
    };
}

function dashOverlayStyle(id: string, opacity = 0.4): LayerProps {
    return {
        id,
        type: 'line',
        paint: {
            'line-color': '#ffffff',
            'line-width': 2,
            'line-opacity': opacity,
            'line-dasharray': [4, 16],
        },
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function routeColor(raw: string): string {
    return raw.startsWith('#') ? raw : `#${raw}`;
}

/** Compute a bounding box over a set of [lat, lng] points */
function computeBounds(
    points: [number, number][],
): [[number, number], [number, number]] | null {
    if (points.length === 0) return null;
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lat, lng] of points) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }
    return [
        [minLng, minLat],
        [maxLng, maxLat],
    ];
}

// ── Component ─────────────────────────────────────────────────────────────────

export const StudentPassMap: React.FC<StudentPassMapProps> = ({
    school,
    result,
    onPolygonComplete,
    onPolygonClear,
}) => {
    const mapRef = useRef<MapRef>(null);
    const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/dark-v11');
    const isDark = mapStyle.includes('dark');

    // DrawControl returns [lng, lat][]; flip to [lat, lng][] for the callback
    const handleCreate = useMemo(
        () => (coords: [number, number][]) => {
            onPolygonComplete(coords.map(([lng, lat]) => [lat, lng] as [number, number]));
        },
        [onPolygonComplete],
    );

    const handleUpdate = useMemo(
        () => (coords: [number, number][]) => {
            onPolygonComplete(coords.map(([lng, lat]) => [lat, lng] as [number, number]));
        },
        [onPolygonComplete],
    );

    // Zone stops layer — empty until result is present (see comment in original)
    const zoneStopsGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
        if (!result?.zoneCentroid) {
            return { type: 'FeatureCollection', features: [] };
        }
        return { type: 'FeatureCollection', features: [] };
    }, [result]);

    // ── GeoJSON data derived from result ──────────────────────────────────────

    const walkToStopGeoJSON = useMemo(() => {
        if (!result?.walkToStop) return null;
        const w = result.walkToStop;
        return toLineGeoJSON([[w.fromLat, w.fromLon], [w.toLat, w.toLon]]);
    }, [result?.walkToStop]);

    const walkToSchoolGeoJSON = useMemo(() => {
        if (!result?.walkToSchool) return null;
        const w = result.walkToSchool;
        return toLineGeoJSON([[w.fromLat, w.fromLon], [w.toLat, w.toLon]]);
    }, [result?.walkToSchool]);

    const walkFromSchoolGeoJSON = useMemo(() => {
        if (!result?.walkFromSchool) return null;
        const w = result.walkFromSchool;
        return toLineGeoJSON([[w.fromLat, w.fromLon], [w.toLat, w.toLon]]);
    }, [result?.walkFromSchool]);

    const walkToZoneGeoJSON = useMemo(() => {
        if (!result?.walkToZone) return null;
        const w = result.walkToZone;
        return toLineGeoJSON([[w.fromLat, w.fromLon], [w.toLat, w.toLon]]);
    }, [result?.walkToZone]);

    // Unique key per result so Mapbox fully removes stale layers on selection change
    const resultKey = useMemo(() => {
        if (!result?.found) return '';
        const am = result.morningLegs.map(l => l.tripId).join('-');
        const pm = (result.afternoonLegs ?? []).map(l => l.tripId).join('-');
        return `${am}_${pm}`;
    }, [result]);

    const amRouteShapeGeoJSONs = useMemo(() => {
        if (!result?.routeShapes) return [];
        return result.routeShapes.map((shape, i) => ({
            id: `am-${resultKey}-${i}`,
            geoJSON: toLineGeoJSON(shape.points),
            color: routeColor(shape.routeColor),
            isDashed: shape.isDashed,
        }));
    }, [result?.routeShapes, resultKey]);

    const pmRouteShapeGeoJSONs = useMemo(() => {
        if (!result?.afternoonRouteShapes) return [];
        return result.afternoonRouteShapes.map((shape, i) => ({
            id: `pm-${resultKey}-${i}`,
            geoJSON: toLineGeoJSON(shape.points),
            color: routeColor(shape.routeColor),
        }));
    }, [result?.afternoonRouteShapes, resultKey]);

    // ── Dash layer IDs for animation ──────────────────────────────────────────

    const dashLayerIds = useMemo(() => {
        const ids: string[] = [];
        amRouteShapeGeoJSONs.forEach(({ id }) => ids.push(`${id}-dash`));
        pmRouteShapeGeoJSONs.forEach(({ id }) => ids.push(`${id}-dash`));
        return ids;
    }, [amRouteShapeGeoJSONs, pmRouteShapeGeoJSONs]);

    useRouteAnimation(mapRef, { layerIds: dashLayerIds, speed: 30, enabled: true });

    // ── Transfer hub data ─────────────────────────────────────────────────────

    const transferHub = useMemo(() => {
        if (!result?.found || result.isDirect || result.morningLegs.length < 2) return null;
        const shapeA = result.routeShapes?.[0];
        if (!shapeA || shapeA.points.length === 0) return null;
        const transferPt = shapeA.points[shapeA.points.length - 1];
        const legA = result.morningLegs[0];
        const legB = result.morningLegs[1];
        const waitMin = result.transfer?.waitMinutes ?? '?';
        const quality = result.transfer?.label ?? '';
        const transferQualityColor = result.transfer?.color ?? '#F59E0B';
        return { transferPt, legA, legB, waitMin, quality, transferQualityColor };
    }, [result]);

    // Travel time labels removed — timeline bar shows all durations

    // ── fitBounds when result changes ─────────────────────────────────────────

    useEffect(() => {
        if (!result?.found) return;

        const allPoints: [number, number][] = [];

        // Collect all route shape points
        result.routeShapes?.forEach((shape) => allPoints.push(...shape.points));
        result.afternoonRouteShapes?.forEach((shape) => allPoints.push(...shape.points));

        // Add school
        if (school) allPoints.push([school.lat, school.lon]);

        // Add zone centroid
        if (result.zoneCentroid) allPoints.push(result.zoneCentroid);

        const bounds = computeBounds(allPoints);
        if (!bounds) return;

        // Delay slightly to let layers mount
        const timer = setTimeout(() => {
            mapRef.current?.fitBounds(bounds, {
                padding: { left: 360, top: 60, right: 60, bottom: 100 },
            });
        }, 150);

        return () => clearTimeout(timer);
    }, [result, school]);

    const hasResult = Boolean(result?.found);

    const centroidLng = result?.walkToStop?.fromLon;
    const centroidLat = result?.walkToStop?.fromLat;

    return (
        <div className="relative w-full h-full student-pass-dark">
            {/* ── Layer style toggle ── */}
            <div
                className="absolute top-4 left-4 z-20 flex rounded-lg overflow-hidden"
                style={{ background: 'rgba(11, 17, 33, 0.85)', border: '1px solid rgba(99, 126, 184, 0.15)' }}
            >
                <button
                    onClick={() => setMapStyle('mapbox://styles/mapbox/dark-v11')}
                    className={`px-3 py-2 text-xs transition-colors ${isDark ? 'bg-blue-500/20 text-blue-400' : 'text-gray-400 hover:text-gray-300'}`}
                >
                    <Moon size={14} />
                </button>
                <button
                    onClick={() => setMapStyle('mapbox://styles/mapbox/satellite-streets-v12')}
                    className={`px-3 py-2 text-xs transition-colors ${!isDark ? 'bg-blue-500/20 text-blue-400' : 'text-gray-400 hover:text-gray-300'}`}
                >
                    <Globe size={14} />
                </button>
            </div>

            <MapBase
                mapStyle={mapStyle}
                showNavigation={true}
                showScale={true}
                mapRef={mapRef}
            >
                {/* ── Draw control for polygon ── */}
                <DrawControl
                    onCreate={handleCreate}
                    onUpdate={handleUpdate}
                    onDelete={onPolygonClear}
                    position="top-right"
                />

                {/* ── School pin marker ── */}
                {school && (
                    <>
                        <Marker longitude={school.lon} latitude={school.lat} anchor="center">
                            <div className="relative">
                                <div
                                    className="absolute inset-0 -m-1 rounded-full"
                                    style={{ width: 28, height: 28, background: 'rgba(16, 185, 129, 0.15)' }}
                                />
                                <div
                                    style={{
                                        width: 22,
                                        height: 22,
                                        borderRadius: '50%',
                                        background: '#F9FAFB',
                                        border: '3px solid #10B981',
                                        boxShadow: '0 0 12px rgba(16, 185, 129, 0.4)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <GraduationCap size={12} color="#10B981" />
                                </div>
                            </div>
                        </Marker>
                        {/* School label above pin */}
                        <Marker longitude={school.lon} latitude={school.lat} anchor="bottom" offset={[0, -10]}>
                            <MapLabel text={school.name} size="lg" />
                        </Marker>
                    </>
                )}

                {/* ── Zone stop markers (dark theme circle layer) ── */}
                <Source id="zone-stops" type="geojson" data={zoneStopsGeoJSON}>
                    <Layer {...ZONE_STOPS_LAYER} />
                </Source>

                {/* ── Walking leg: zone centroid → boarding stop ── */}
                {hasResult && walkToStopGeoJSON && result?.walkToStop && (
                    <>
                        <Source id={`walk-to-stop-${resultKey}`} type="geojson" data={walkToStopGeoJSON}>
                            <Layer {...walkLineLayer(`walk-to-stop-line-${resultKey}`, '#94A3B8', 0.7, [4, 8])} />
                        </Source>

                        {/* Zone centroid marker — pulsing blue dot */}
                        {centroidLng !== undefined && centroidLat !== undefined && (
                            <Marker longitude={centroidLng} latitude={centroidLat} anchor="center">
                                <div className="relative">
                                    <div
                                        className="absolute inset-0 -m-2 rounded-full animate-pulse"
                                        style={{ width: 32, height: 32, background: 'rgba(59, 130, 246, 0.2)' }}
                                    />
                                    <div
                                        style={{
                                            width: 16,
                                            height: 16,
                                            borderRadius: '50%',
                                            background: '#3B82F6',
                                            border: '2px solid #fff',
                                            boxShadow: '0 0 12px rgba(59, 130, 246, 0.5)',
                                        }}
                                    />
                                </div>
                            </Marker>
                        )}

                        {/* Boarding stop marker — green with bus icon */}
                        <Marker longitude={result.walkToStop.toLon} latitude={result.walkToStop.toLat} anchor="center">
                            <div
                                style={{
                                    width: 18,
                                    height: 18,
                                    borderRadius: '50%',
                                    background: '#10B981',
                                    border: '3px solid #fff',
                                    boxShadow: '0 0 12px rgba(16, 185, 129, 0.5)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <Bus size={10} color="#fff" />
                            </div>
                        </Marker>
                    </>
                )}

                {/* ── AM GTFS route shapes — 3-layer glow system ── */}
                {hasResult && amRouteShapeGeoJSONs.map(({ id, geoJSON, color }) => (
                    <Source key={id} id={id} type="geojson" data={geoJSON}>
                        <Layer {...glowLayerStyle(`${id}-glow`, color, 0.15)} />
                        <Layer {...baseLayerStyle(`${id}-base`, color, 6, 0.9)} />
                        <Layer {...dashOverlayStyle(`${id}-dash`, 0.4)} />
                    </Source>
                ))}

                {/* ── Transfer hub (diamond + pulse rings + glass callout) ── */}
                {hasResult && transferHub && (() => {
                    const [transferLng, transferLat] = toGeoJSON(transferHub.transferPt);
                    return (
                        <>
                            {/* Animated pulse rings + diamond */}
                            <Marker longitude={transferLng} latitude={transferLat} anchor="center">
                                <div className="relative flex items-center justify-center" style={{ width: 48, height: 48 }}>
                                    <div
                                        className="absolute rounded-full transfer-ring"
                                        style={{ width: 40, height: 40, border: '2px solid #F59E0B' }}
                                    />
                                    <div
                                        className="absolute rounded-full transfer-ring-delayed"
                                        style={{ width: 40, height: 40, border: '2px solid #F59E0B' }}
                                    />
                                    <div
                                        className="absolute rounded-full transfer-ring-delayed-2"
                                        style={{ width: 40, height: 40, border: '2px solid #F59E0B' }}
                                    />
                                    <div
                                        style={{
                                            width: 20,
                                            height: 20,
                                            transform: 'rotate(45deg)',
                                            borderRadius: 4,
                                            background: '#F59E0B',
                                            border: '2px solid #fff',
                                            boxShadow: '0 0 16px rgba(245, 158, 11, 0.6)',
                                        }}
                                    />
                                </div>
                            </Marker>

                            {/* Compact transfer label */}
                            <Marker longitude={transferLng} latitude={transferLat} anchor="bottom" offset={[0, -28]}>
                                <div
                                    className="rounded-md px-2.5 py-1.5 flex items-center gap-2"
                                    style={{
                                        background: 'rgba(11, 17, 33, 0.9)',
                                        backdropFilter: 'blur(12px)',
                                        border: `1px solid ${transferHub.transferQualityColor}44`,
                                        fontFamily: "'JetBrains Mono', monospace",
                                        boxShadow: `0 0 12px ${transferHub.transferQualityColor}33`,
                                        pointerEvents: 'none',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    <span className="text-[11px] font-semibold" style={{ color: transferHub.transferQualityColor }}>
                                        {transferHub.waitMin}m
                                    </span>
                                    <span className="text-[11px] text-[#94A3B8]">
                                        transfer
                                    </span>
                                </div>
                            </Marker>
                        </>
                    );
                })()}

                {/* ── Walking leg: alighting stop → school ── */}
                {hasResult && walkToSchoolGeoJSON && result?.walkToSchool && (
                    <>
                        <Source id={`walk-to-school-${resultKey}`} type="geojson" data={walkToSchoolGeoJSON}>
                            <Layer {...walkLineLayer(`walk-to-school-line-${resultKey}`, '#94A3B8', 0.7, [4, 8])} />
                        </Source>
                    </>
                )}

                {/* ═══ AFTERNOON RETURN TRIP ════════════════════════════════════════ */}

                {/* ── Walk from school to afternoon boarding stop ── */}
                {hasResult && walkFromSchoolGeoJSON && result?.walkFromSchool && (
                    <Source id={`walk-from-school-${resultKey}`} type="geojson" data={walkFromSchoolGeoJSON}>
                        <Layer {...walkLineLayer(`walk-from-school-line-${resultKey}`, '#94A3B8', 0.6, [4, 8])} />
                    </Source>
                )}

                {/* ── Afternoon route shapes — 3-layer glow (lower opacity) ── */}
                {hasResult && pmRouteShapeGeoJSONs.map(({ id, geoJSON, color }) => (
                    <Source key={id} id={id} type="geojson" data={geoJSON}>
                        <Layer {...glowLayerStyle(`${id}-glow`, color, 0.08)} />
                        <Layer {...baseLayerStyle(`${id}-base`, color, 4, 0.6)} />
                        <Layer {...dashOverlayStyle(`${id}-dash`, 0.25)} />
                    </Source>
                ))}

                {/* ── Walk from afternoon alighting stop to zone centroid ── */}
                {hasResult && walkToZoneGeoJSON && (
                    <Source id={`walk-to-zone-${resultKey}`} type="geojson" data={walkToZoneGeoJSON}>
                        <Layer {...walkLineLayer(`walk-to-zone-line-${resultKey}`, '#94A3B8', 0.6, [4, 8])} />
                    </Source>
                )}

            </MapBase>
        </div>
    );
};
