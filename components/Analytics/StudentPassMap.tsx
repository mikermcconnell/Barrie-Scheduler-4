import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Marker, Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps, MapRef, MarkerDragEvent } from 'react-map-gl/mapbox';
import { Moon, Globe, Bus, GraduationCap } from 'lucide-react';
import { MapBase } from '../shared/MapBase';
import { MapLabel } from '../shared/MapLabel';
import { DrawControl } from '../shared/DrawControl';
import { toLineGeoJSON, toGeoJSON } from '../shared/mapUtils';
import type { SchoolConfig, StudentPassResult, ZoneStopOption } from '../../utils/transit-app/studentPassUtils';
import { isPointInPolygon } from '../../utils/transit-app/studentPassUtils';
import { getAllStopsWithCoords } from '../../utils/gtfs/gtfsStopLookup';
import { useRouteAnimation } from './useRouteAnimation';
import './studentPass.css';

export interface StudentPassMapProps {
    school: SchoolConfig | null;
    result: StudentPassResult | null;
    journeyMode: 'am' | 'pm';
    polygon: [number, number][] | null;
    zoneOrigin: [number, number] | null;
    zoneStops: ZoneStopOption[];
    selectedZoneStopId: string | null;
    onPolygonComplete: (coords: [number, number][]) => void;
    onPolygonClear: () => void;
    onZoneStopSelect: (stopId: string) => void;
    onZoneOriginChange: (coords: [number, number]) => void;
}

// ── Layer style constants ─────────────────────────────────────────────────────

const ZONE_STOPS_LAYER: LayerProps = {
    id: 'zone-stops-circles',
    type: 'circle',
    source: 'zone-stops',
    paint: {
        'circle-radius': 5,
        'circle-color': '#003B61',
        'circle-stroke-color': '#56A6D5',
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

function buildZoneStopMarkerStyle(fillColor: string, isSelected: boolean): React.CSSProperties {
    return {
        width: isSelected ? 18 : 14,
        height: isSelected ? 18 : 14,
        borderRadius: '50%',
        border: '2px solid #fff',
        backgroundColor: fillColor,
        boxShadow: isSelected
            ? '0 0 14px rgba(252, 211, 77, 0.5)'
            : `0 0 10px ${fillColor}59`,
        appearance: 'none',
        WebkitAppearance: 'none',
        padding: 0,
        margin: 0,
        display: 'block',
        cursor: 'pointer',
    };
}

const LegendDot: React.FC<{
    fill: string;
    size?: number;
    border?: string;
    shadow?: string;
}> = ({ fill, size = 12, border = '#fff', shadow }) => (
    <span
        aria-hidden="true"
        style={{
            width: size,
            height: size,
            borderRadius: '50%',
            display: 'inline-block',
            background: fill,
            border: `2px solid ${border}`,
            boxShadow: shadow,
            flexShrink: 0,
        }}
    />
);

interface StopMarkerPoint {
    lon: number;
    lat: number;
    stopName?: string;
}

function BoardStopMarker({ selectedZoneStop }: { selectedZoneStop: ZoneStopOption | null }) {
    return (
        <div className="relative">
            {selectedZoneStop && (
                <div
                    className="absolute inset-0 -m-1 rounded-full"
                    style={{
                        width: 26,
                        height: 26,
                        border: '2px solid rgba(252, 211, 77, 0.9)',
                        boxShadow: '0 0 12px rgba(252, 211, 77, 0.35)',
                    }}
                />
            )}
            <div
                style={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    background: '#0E5E90',
                    border: '3px solid #fff',
                    boxShadow: '0 0 12px rgba(86, 166, 213, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <Bus size={10} color="#fff" />
            </div>
        </div>
    );
}

function AlightStopMarker() {
    return (
        <div
            style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: '#F8FAFC',
                border: '3px solid #56A6D5',
                boxShadow: '0 0 12px rgba(86, 166, 213, 0.35)',
            }}
        />
    );
}

function getJourneyTransfers(result: StudentPassResult | null, journeyMode: 'am' | 'pm') {
    if (!result?.found) return [];
    if (journeyMode === 'am') {
        if (result.morningTransfers?.length) return result.morningTransfers;
        if (result.morningTransfer) return [result.morningTransfer];
        if (result.transfers?.length) return result.transfers;
        if (result.transfer) return [result.transfer];
        return [];
    }
    if (result.afternoonTransfers?.length) return result.afternoonTransfers;
    if (result.afternoonTransfer) return [result.afternoonTransfer];
    return [];
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
    polygon,
    zoneOrigin,
    zoneStops,
    selectedZoneStopId,
    onPolygonComplete,
    onPolygonClear,
    onZoneStopSelect,
    onZoneOriginChange,
}) => {
    const mapRef = useRef<MapRef>(null);
    const [mapStyle, setMapStyle] = useState('mapbox://styles/mapbox/dark-v11');
    const [dragOrigin, setDragOrigin] = useState<[number, number] | null>(null);
    const isDark = mapStyle.includes('dark');
    const stopLookup = useMemo(
        () => new Map(getAllStopsWithCoords().map((stop) => [stop.stop_id, stop])),
        []
    );

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

    useEffect(() => {
        setDragOrigin(null);
    }, [zoneOrigin]);

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
        if (!result?.found) return null;
        const routeShapes = journeyMode === 'am' ? result.routeShapes : result.afternoonRouteShapes;
        const journeyLegs = journeyMode === 'am' ? result.morningLegs : result.afternoonLegs;
        const journeyTransfers = getJourneyTransfers(result, journeyMode);
        if (journeyLegs.length < 2) return null;
        const shapeA = routeShapes?.[0];
        if (!shapeA || shapeA.points.length === 0) return null;
        const transferPt = shapeA.points[shapeA.points.length - 1];
        const legA = journeyLegs[0];
        const legB = journeyLegs[1];
        const primaryTransfer = journeyTransfers[0];
        const waitMin = primaryTransfer?.waitMinutes ?? '?';
        const quality = primaryTransfer?.label ?? '';
        const transferQualityColor = primaryTransfer?.color ?? '#F59E0B';
        return { transferPt, legA, legB, waitMin, quality, transferQualityColor };
    }, [journeyMode, result]);

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

        // Add the active home start point within the zone
        if (zoneOrigin) allPoints.push(zoneOrigin);
        else if (result.zoneCentroid) allPoints.push(result.zoneCentroid);

        const bounds = computeBounds(allPoints);
        if (!bounds) return;

        // Delay slightly to let layers mount
        const timer = setTimeout(() => {
            mapRef.current?.fitBounds(bounds, {
                padding: { left: 360, top: 60, right: 60, bottom: 100 },
            });
        }, 150);

        return () => clearTimeout(timer);
    }, [journeyMode, result, school, zoneOrigin]);

    const hasResult = Boolean(result?.found);
    const selectedZoneStop = useMemo(
        () => zoneStops.find((stop) => stop.stopId === selectedZoneStopId) ?? null,
        [selectedZoneStopId, zoneStops]
    );
    const homeStartPoint = dragOrigin ?? zoneOrigin ?? result?.zoneCentroid ?? null;
    const canDragHomePoint = Boolean(zoneOrigin && polygon);
    const handleHomePointDrag = useMemo(
        () => (event: MarkerDragEvent) => {
            const { lat, lng } = event.lngLat;
            setDragOrigin([lat, lng]);
        },
        []
    );
    const handleHomePointDragEnd = useMemo(
        () => (event: MarkerDragEvent) => {
            const { lat, lng } = event.lngLat;
            const nextOrigin: [number, number] = [lat, lng];
            setDragOrigin(null);
            if (polygon && !isPointInPolygon(nextOrigin, polygon)) {
                return;
            }
            onZoneOriginChange(nextOrigin);
        },
        [onZoneOriginChange, polygon]
    );
    const boardStop = useMemo<StopMarkerPoint | null>(() => {
        if (!result?.found) return null;
        if (journeyMode === 'am' && result.walkToStop) {
            return {
                lon: result.walkToStop.toLon,
                lat: result.walkToStop.toLat,
                stopName: result.morningLegs[0]?.fromStop,
            };
        }
        if (journeyMode === 'pm') {
            const stopId = result.afternoonLegs[0]?.fromStopId;
            const stop = stopId ? stopLookup.get(stopId) : null;
            if (stop) {
                return {
                    lon: stop.lon,
                    lat: stop.lat,
                    stopName: result.afternoonLegs[0]?.fromStop,
                };
            }
            if (result.walkFromSchool) {
                return {
                    lon: result.walkFromSchool.toLon,
                    lat: result.walkFromSchool.toLat,
                    stopName: result.afternoonLegs[0]?.fromStop,
                };
            }
        }
        return null;
    }, [journeyMode, result, stopLookup]);
    const alightStop = useMemo<StopMarkerPoint | null>(() => {
        if (!result?.found) return null;
        if (journeyMode === 'am') {
            const stopId = result.morningLegs[result.morningLegs.length - 1]?.toStopId;
            const stop = stopId ? stopLookup.get(stopId) : null;
            if (stop) {
                return {
                    lon: stop.lon,
                    lat: stop.lat,
                    stopName: result.morningLegs[result.morningLegs.length - 1]?.toStop,
                };
            }
            if (result.walkToSchool) {
                return {
                    lon: result.walkToSchool.fromLon,
                    lat: result.walkToSchool.fromLat,
                    stopName: result.morningLegs[result.morningLegs.length - 1]?.toStop,
                };
            }
        }
        if (journeyMode === 'pm' && result.walkToZone) {
            return {
                lon: result.walkToZone.fromLon,
                lat: result.walkToZone.fromLat,
                stopName: result.afternoonLegs[result.afternoonLegs.length - 1]?.toStop,
            };
        }
        return null;
    }, [journeyMode, result, stopLookup]);
    const showSelectedZoneStop = journeyMode === 'am';

    return (
        <div className="relative w-full h-full student-pass-dark student-pass-map">
            {/* ── Layer style toggle — positioned right of sidebar panel ── */}
            <div
                className="student-pass-export-hidden absolute top-4 z-20 flex rounded-lg overflow-hidden"
                style={{ left: 344, background: 'var(--student-pass-panel)', border: '1px solid var(--student-pass-border)' }}
            >
                <button
                    onClick={() => setMapStyle('mapbox://styles/mapbox/dark-v11')}
                    className={`px-3 py-2 text-xs transition-colors ${isDark ? 'text-sky-200' : 'text-slate-400 hover:text-slate-200'}`}
                    style={{ background: isDark ? 'var(--student-pass-accent-soft)' : 'transparent' }}
                >
                    <Moon size={14} />
                </button>
                <button
                    onClick={() => setMapStyle('mapbox://styles/mapbox/satellite-streets-v12')}
                    className={`px-3 py-2 text-xs transition-colors ${!isDark ? 'text-sky-200' : 'text-slate-400 hover:text-slate-200'}`}
                    style={{ background: !isDark ? 'var(--student-pass-accent-soft)' : 'transparent' }}
                >
                    <Globe size={14} />
                </button>
            </div>

            {zoneStops.length > 0 && (
                <div
                    className="absolute top-16 z-20 rounded-lg px-2.5 py-1.5 flex items-center gap-3 text-[10px] text-[#CBD5E1]"
                    style={{
                        left: 344,
                        background: 'var(--student-pass-panel)',
                        border: '1px solid var(--student-pass-border)',
                        fontFamily: "'JetBrains Mono', monospace",
                    }}
                >
                    <span className="flex items-center gap-1.5">
                        <LegendDot fill="#56A6D5" size={8} />
                        Has trips
                    </span>
                    {showSelectedZoneStop && (
                        <span className="flex items-center gap-1.5">
                            <LegendDot fill="#8FD0F6" size={8} />
                            Selected
                        </span>
                    )}
                    <span className="flex items-center gap-1.5">
                        <LegendDot fill="#475569" size={8} />
                        No trips
                    </span>
                </div>
            )}

            <MapBase
                mapStyle={mapStyle}
                preserveDrawingBuffer={true}
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
                                    style={{ width: 28, height: 28, background: 'rgba(86, 166, 213, 0.16)' }}
                                />
                                <div
                                    style={{
                                        width: 22,
                                        height: 22,
                                        borderRadius: '50%',
                                        background: '#F9FAFB',
                                        border: '3px solid #005D95',
                                        boxShadow: '0 0 12px rgba(86, 166, 213, 0.4)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <GraduationCap size={12} color="#005D95" />
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
                    const isSelected = showSelectedZoneStop && stop.stopId === selectedZoneStopId;
                    const hasAnyService = stop.morningOptionCount > 0 || stop.afternoonOptionCount > 0;
                    const fillColor = isSelected ? '#8FD0F6' : hasAnyService ? '#56A6D5' : '#4E6B82';
                    return (
                        <Marker key={stop.stopId} longitude={stop.lon} latitude={stop.lat} anchor="center">
                            <button
                                type="button"
                                onClick={() => onZoneStopSelect(stop.stopId)}
                                className="rounded-full transition-transform hover:scale-110"
                                title={`${stop.stopName} — ${stop.morningOptionCount} AM / ${stop.afternoonOptionCount} PM options`}
                                style={buildZoneStopMarkerStyle(fillColor, isSelected)}
                            />
                        </Marker>
                    );
                })}
                {showSelectedZoneStop && selectedZoneStop && (
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
                {!showSelectedZoneStop && alightStop?.stopName && (
                    <Marker longitude={alightStop.lon} latitude={alightStop.lat} anchor="bottom" offset={[0, -12]}>
                        <MapLabel
                            text={alightStop.stopName}
                            size="sm"
                            bgColor="#0F172A"
                            borderColor="rgba(56,189,248,0.8)"
                            mono
                        />
                    </Marker>
                )}

                {/* ── Result-dependent layers — keyed to force clean remount on selection change ── */}
                <React.Fragment key={resultKey}>

                {/* ── Home start point marker — draggable inside the drawn zone ── */}
                {homeStartPoint && (
                    <Marker
                        longitude={homeStartPoint[1]}
                        latitude={homeStartPoint[0]}
                        anchor="center"
                        draggable={canDragHomePoint}
                        onDrag={handleHomePointDrag}
                        onDragEnd={handleHomePointDragEnd}
                    >
                        <div className="relative">
                            <div
                                className="absolute inset-0 -m-2 rounded-full animate-pulse"
                                style={{ width: 32, height: 32, background: 'rgba(86, 166, 213, 0.2)' }}
                            />
                            <div
                                style={{
                                    width: 16,
                                    height: 16,
                                    borderRadius: '50%',
                                    background: '#005D95',
                                    border: '2px solid #fff',
                                    boxShadow: '0 0 12px rgba(86, 166, 213, 0.5)',
                                    cursor: canDragHomePoint ? 'grab' : 'default',
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
                                    <BoardStopMarker selectedZoneStop={showSelectedZoneStop ? selectedZoneStop : null} />
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

                        {/* Walk to school */}
                        {hasResult && walkToSchoolGeoJSON && result?.walkToSchool && (
                            <>
                                <Source id="walk-to-school" type="geojson" data={walkToSchoolGeoJSON}>
                                    <Layer {...walkLineLayer('walk-to-school-line', '#94A3B8', 0.7, [4, 8])} />
                                </Source>
                                {alightStop && (
                                    <Marker longitude={alightStop.lon} latitude={alightStop.lat} anchor="center">
                                        <AlightStopMarker />
                                    </Marker>
                                )}
                            </>
                        )}
                    </>
                )}

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
                                        background: 'var(--student-pass-panel-strong)',
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

                {/* ═══ AFTERNOON RETURN TRIP ════════════════════════════════════════ */}
                {journeyMode === 'pm' && (
                    <>
                        {/* Walk from school to afternoon boarding stop */}
                        {hasResult && walkFromSchoolGeoJSON && result?.walkFromSchool && (
                            <>
                                <Source id="walk-from-school" type="geojson" data={walkFromSchoolGeoJSON}>
                                    <Layer {...walkLineLayer('walk-from-school-line', '#94A3B8', 0.7, [4, 8])} />
                                </Source>
                                {boardStop && (
                                    <Marker longitude={boardStop.lon} latitude={boardStop.lat} anchor="center">
                                        <BoardStopMarker selectedZoneStop={null} />
                                    </Marker>
                                )}
                            </>
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
                            <>
                                <Source id="walk-to-zone" type="geojson" data={walkToZoneGeoJSON}>
                                    <Layer {...walkLineLayer('walk-to-zone-line', '#94A3B8', 0.7, [4, 8])} />
                                </Source>
                                {alightStop && (
                                    <Marker longitude={alightStop.lon} latitude={alightStop.lat} anchor="center">
                                        <AlightStopMarker />
                                    </Marker>
                                )}
                            </>
                        )}
                    </>
                )}

                </React.Fragment>

            </MapBase>
        </div>
    );
};
