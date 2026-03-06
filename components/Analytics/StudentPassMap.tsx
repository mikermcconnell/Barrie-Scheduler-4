import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Marker, Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps, MapRef } from 'react-map-gl/mapbox';
import { Moon, Globe, Bus, GraduationCap } from 'lucide-react';
import { MapBase } from '../shared/MapBase';
import { MapLabel } from '../shared/MapLabel';
import { DrawControl } from '../shared/DrawControl';
import { toLineGeoJSON, toGeoJSON } from '../shared/mapUtils';
import type { SchoolConfig, StudentPassResult, ZoneStopOption } from '../../utils/transit-app/studentPassUtils';
import { useRouteAnimation } from './useRouteAnimation';
import './studentPass.css';

export interface StudentPassMapProps {
    school: SchoolConfig | null;
    result: StudentPassResult | null;
    journeyMode: 'am' | 'pm';
    zoneStops: ZoneStopOption[];
    selectedZoneStopId: string | null;
    onPolygonComplete: (coords: [number, number][]) => void;
    onPolygonClear: () => void;
    onZoneStopSelect: (stopId: string) => void;
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
    journeyMode,
    zoneStops,
    selectedZoneStopId,
    onPolygonComplete,
    onPolygonClear,
    onZoneStopSelect,
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
        if (zoneStops.length === 0) {
            return { type: 'FeatureCollection', features: [] };
        }
        return {
            type: 'FeatureCollection',
            features: zoneStops.map((stop) => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [stop.lon, stop.lat],
                },
                properties: {
                    stopId: stop.stopId,
                },
            })),
        };
    }, [zoneStops]);

    // ── GeoJSON data derived from result ──────────────────────────────────────

    const walkToStopGeoJSON = useMemo(() => {
        if (!result?.walkToStop) return null;
        const w = result.walkToStop;
        return toLineGeoJSON(w.geometry ?? [[w.fromLat, w.fromLon], [w.toLat, w.toLon]]);
    }, [result?.walkToStop]);

    const walkToSchoolGeoJSON = useMemo(() => {
        if (!result?.walkToSchool) return null;
        const w = result.walkToSchool;
        return toLineGeoJSON(w.geometry ?? [[w.fromLat, w.fromLon], [w.toLat, w.toLon]]);
    }, [result?.walkToSchool]);

    const walkFromSchoolGeoJSON = useMemo(() => {
        if (!result?.walkFromSchool) return null;
        const w = result.walkFromSchool;
        return toLineGeoJSON(w.geometry ?? [[w.fromLat, w.fromLon], [w.toLat, w.toLon]]);
    }, [result?.walkFromSchool]);

    const walkToZoneGeoJSON = useMemo(() => {
        if (!result?.walkToZone) return null;
        const w = result.walkToZone;
        return toLineGeoJSON(w.geometry ?? [[w.fromLat, w.fromLon], [w.toLat, w.toLon]]);
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
            id: `am-route-${i}`,
            geoJSON: toLineGeoJSON(shape.points),
            color: routeColor(shape.routeColor),
            isDashed: shape.isDashed,
        }));
    }, [result?.routeShapes]);

    const pmRouteShapeGeoJSONs = useMemo(() => {
        if (!result?.afternoonRouteShapes) return [];
        return result.afternoonRouteShapes.map((shape, i) => ({
            id: `pm-route-${i}`,
            geoJSON: toLineGeoJSON(shape.points),
            color: routeColor(shape.routeColor),
        }));
    }, [result?.afternoonRouteShapes]);

    // ── Dash layer IDs for animation ──────────────────────────────────────────

    const dashLayerIds = useMemo(() => {
        const ids: string[] = [];
        if (journeyMode === 'am') {
            amRouteShapeGeoJSONs.forEach(({ id }) => ids.push(`${id}-dash`));
        } else {
            pmRouteShapeGeoJSONs.forEach(({ id }) => ids.push(`${id}-dash`));
        }
        return ids;
    }, [amRouteShapeGeoJSONs, pmRouteShapeGeoJSONs, journeyMode]);

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

        // Collect route shape points for the active journey only
        if (journeyMode === 'am') {
            result.routeShapes?.forEach((shape) => allPoints.push(...shape.points));
        } else {
            result.afternoonRouteShapes?.forEach((shape) => allPoints.push(...shape.points));
        }

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
    }, [result, school, journeyMode]);

    const hasResult = Boolean(result?.found);

    const centroidLng = result?.walkToStop?.fromLon;
    const centroidLat = result?.walkToStop?.fromLat;
    const selectedZoneStop = useMemo(
        () => zoneStops.find((stop) => stop.stopId === selectedZoneStopId) ?? null,
        [selectedZoneStopId, zoneStops]
    );

    return (
        <div className="relative w-full h-full student-pass-dark student-pass-map">
            {/* ── Layer style toggle — positioned right of sidebar panel ── */}
            <div
                className="absolute top-4 z-20 flex rounded-lg overflow-hidden"
                style={{ left: 344, background: 'rgba(11, 17, 33, 0.85)', border: '1px solid rgba(99, 126, 184, 0.15)' }}
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

            {zoneStops.length > 0 && (
                <div
                    className="absolute top-16 z-20 rounded-lg px-3 py-2 text-[11px] text-[#CBD5E1]"
                    style={{
                        left: 344,
                        background: 'rgba(11, 17, 33, 0.85)',
                        border: '1px solid rgba(99, 126, 184, 0.15)',
                        fontFamily: "'JetBrains Mono', monospace",
                    }}
                >
                    <div className="flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#3B82F6]" />
                        <span>Zone stop</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#FCD34D]" />
                        <span>Selected stop</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#475569]" />
                        <span>No trip found</span>
                    </div>
                </div>
            )}

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
                {zoneStops.map((stop) => {
                    const isSelected = stop.stopId === selectedZoneStopId;
                    const hasAnyService = stop.morningOptionCount > 0 || stop.afternoonOptionCount > 0;
                    return (
                        <Marker key={stop.stopId} longitude={stop.lon} latitude={stop.lat} anchor="center">
                            <button
                                type="button"
                                onClick={() => onZoneStopSelect(stop.stopId)}
                                className="rounded-full transition-transform hover:scale-110"
                                title={`${stop.stopName} — ${stop.morningOptionCount} AM / ${stop.afternoonOptionCount} PM options`}
                                style={{
                                    width: isSelected ? 18 : 14,
                                    height: isSelected ? 18 : 14,
                                    borderRadius: '50%',
                                    background: isSelected ? '#FCD34D' : hasAnyService ? '#3B82F6' : '#475569',
                                    border: '2px solid #fff',
                                    boxShadow: isSelected
                                        ? '0 0 14px rgba(252, 211, 77, 0.5)'
                                        : '0 0 10px rgba(59, 130, 246, 0.35)',
                                }}
                            />
                        </Marker>
                    );
                })}
                {selectedZoneStop && (
                    <Marker longitude={selectedZoneStop.lon} latitude={selectedZoneStop.lat} anchor="bottom" offset={[0, -12]}>
                        <MapLabel
                            text={selectedZoneStop.stopName}
                            size="sm"
                            bgColor="#0F172A"
                            borderColor="rgba(252,211,77,0.8)"
                            mono
                        />
                    </Marker>
                )}

                {/* ── Result-dependent layers — keyed to force clean remount on selection change ── */}
                <React.Fragment key={resultKey}>

                {/* ── Zone centroid marker — always visible when result exists ── */}
                {hasResult && centroidLng !== undefined && centroidLat !== undefined && (
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

                {/* ═══ MORNING JOURNEY ═══════════════════════════════════════════ */}
                {journeyMode === 'am' && (
                    <>
                        {/* Walk to boarding stop */}
                        {hasResult && walkToStopGeoJSON && result?.walkToStop && (
                            <>
                                <Source id="walk-to-stop" type="geojson" data={walkToStopGeoJSON}>
                                    <Layer {...walkLineLayer('walk-to-stop-line', '#94A3B8', 0.7, [4, 8])} />
                                </Source>
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

                        {/* AM route shapes — 3-layer glow system */}
                        {hasResult && amRouteShapeGeoJSONs.map(({ id, geoJSON, color }) => (
                            <Source key={id} id={id} type="geojson" data={geoJSON}>
                                <Layer {...glowLayerStyle(`${id}-glow`, color, 0.15)} />
                                <Layer {...baseLayerStyle(`${id}-base`, color, 6, 0.9)} />
                                <Layer {...dashOverlayStyle(`${id}-dash`, 0.4)} />
                            </Source>
                        ))}

                        {/* Inline route labels on AM shapes */}
                        {hasResult && result?.routeShapes?.map((shape, i) => {
                            if (shape.points.length < 3) return null;
                            const midIdx = Math.floor(shape.points.length * 0.4);
                            const [lng, lat] = toGeoJSON(shape.points[midIdx]);
                            const leg = result.morningLegs[i];
                            if (!leg) return null;
                            return (
                                <Marker key={`am-label-${i}`} longitude={lng} latitude={lat} anchor="center">
                                    <MapLabel
                                        text={`Rt ${leg.routeShortName}`}
                                        size="sm"
                                        bgColor={routeColor(shape.routeColor)}
                                        borderColor="rgba(255,255,255,0.6)"
                                        mono
                                    />
                                </Marker>
                            );
                        })}

                        {/* Transfer hub (diamond + pulse rings + glass callout) */}
                        {hasResult && transferHub && (() => {
                            const [transferLng, transferLat] = toGeoJSON(transferHub.transferPt);
                            return (
                                <>
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

                        {/* Walk to school */}
                        {hasResult && walkToSchoolGeoJSON && result?.walkToSchool && (
                            <Source id="walk-to-school" type="geojson" data={walkToSchoolGeoJSON}>
                                <Layer {...walkLineLayer('walk-to-school-line', '#94A3B8', 0.7, [4, 8])} />
                            </Source>
                        )}
                    </>
                )}

                {/* ═══ AFTERNOON RETURN TRIP ════════════════════════════════════════ */}
                {journeyMode === 'pm' && (
                    <>
                        {/* Walk from school to afternoon boarding stop */}
                        {hasResult && walkFromSchoolGeoJSON && result?.walkFromSchool && (
                            <Source id="walk-from-school" type="geojson" data={walkFromSchoolGeoJSON}>
                                <Layer {...walkLineLayer('walk-from-school-line', '#94A3B8', 0.7, [4, 8])} />
                            </Source>
                        )}

                        {/* PM route shapes — full glow (same prominence as AM) */}
                        {hasResult && pmRouteShapeGeoJSONs.map(({ id, geoJSON, color }) => (
                            <Source key={id} id={id} type="geojson" data={geoJSON}>
                                <Layer {...glowLayerStyle(`${id}-glow`, color, 0.15)} />
                                <Layer {...baseLayerStyle(`${id}-base`, color, 6, 0.9)} />
                                <Layer {...dashOverlayStyle(`${id}-dash`, 0.4)} />
                            </Source>
                        ))}

                        {/* Inline route labels on PM shapes */}
                        {hasResult && result?.afternoonRouteShapes?.map((shape, i) => {
                            if (shape.points.length < 3) return null;
                            const midIdx = Math.floor(shape.points.length * 0.4);
                            const [lng, lat] = toGeoJSON(shape.points[midIdx]);
                            const leg = result.afternoonLegs?.[i];
                            if (!leg) return null;
                            return (
                                <Marker key={`pm-label-${i}`} longitude={lng} latitude={lat} anchor="center">
                                    <MapLabel
                                        text={`Rt ${leg.routeShortName}`}
                                        size="sm"
                                        bgColor={routeColor(shape.routeColor)}
                                        borderColor="rgba(255,255,255,0.6)"
                                        mono
                                    />
                                </Marker>
                            );
                        })}

                        {/* Walk from alighting stop to zone centroid */}
                        {hasResult && walkToZoneGeoJSON && (
                            <Source id="walk-to-zone" type="geojson" data={walkToZoneGeoJSON}>
                                <Layer {...walkLineLayer('walk-to-zone-line', '#94A3B8', 0.7, [4, 8])} />
                            </Source>
                        )}
                    </>
                )}

                </React.Fragment>

            </MapBase>
        </div>
    );
};
