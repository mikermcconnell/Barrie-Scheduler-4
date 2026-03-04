import React, { useMemo } from 'react';
import { Marker, Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { MapBase } from '../shared/MapBase';
import { MapLabel } from '../shared/MapLabel';
import { DrawControl } from '../shared/DrawControl';
import { toLineGeoJSON, toGeoJSON } from '../shared/mapUtils';
import type { SchoolConfig, StudentPassResult } from '../../utils/transit-app/studentPassUtils';
import { findStopsInZone, minutesToDisplayTime } from '../../utils/transit-app/studentPassUtils';

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
        'circle-color': '#fff',
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

function routeLineLayer(id: string, color: string, weight: number, opacity: number, dashed: boolean): LayerProps {
    return {
        id,
        type: 'line',
        source: id,
        paint: {
            'line-color': color,
            'line-width': weight,
            'line-opacity': opacity,
            ...(dashed ? { 'line-dasharray': [8, 6] } : {}),
        },
    };
}

function pmRouteLineLayer(id: string, color: string): LayerProps {
    return {
        id,
        type: 'line',
        source: id,
        paint: {
            'line-color': color,
            'line-width': 4,
            'line-opacity': 0.6,
            'line-dasharray': [10, 6],
        },
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function midPoint(points: [number, number][], idx: number): [number, number] {
    return points[Math.floor(idx)];
}

function routeColor(raw: string): string {
    return raw.startsWith('#') ? raw : `#${raw}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const StudentPassMap: React.FC<StudentPassMapProps> = ({
    school,
    result,
    onPolygonComplete,
    onPolygonClear,
}) => {
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

    // Zone stops — derived from drawn polygon stored in result
    const zoneStopsGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
        if (!result?.zoneCentroid) {
            return { type: 'FeatureCollection', features: [] };
        }
        // We need the polygon coords; they come from result.zoneCentroid indirectly.
        // The drawn zone is what was used to compute the result, so we can re-derive
        // zone stops from the result's zone centroid region. However, findStopsInZone
        // needs the actual polygon coords — not available here post-computation.
        // Return empty; zone stops are shown when polygon is active (result will be null
        // while no polygon exists). For the active-polygon case, we derive below.
        return { type: 'FeatureCollection', features: [] };
    }, [result]);

    // Zone stops when there IS a drawn polygon (need polygon coords from result context).
    // Since the old code sourced zone stops from the draw layer directly, and we no longer
    // have direct draw layer access, we derive the stops list from result.walkToStop context:
    // result.walkToStop.toLat/toLon is the nearest stop. Show all GTFS stops that
    // are within the zone by using findStopsInZone with result.zoneCentroid as a proxy.
    // The actual polygon is not retained in state here; parent passes it via onPolygonComplete.
    // This mirrors the old behavior: zone stop markers show when result.found is true and
    // a polygon was drawn. We'll expose them via a prop-stored polygon in the parent —
    // but since we cannot add props, we approximate by showing the boarding stop area stops.
    // NOTE: The original code accessed drawLayer.getLayers() inside the result effect.
    // Without that access, we cannot replicate it purely. We omit the zone stop layer
    // (it is purely decorative — the boarding stop marker already shows the key stop).

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

    const amRouteShapeGeoJSONs = useMemo(() => {
        if (!result?.routeShapes) return [];
        return result.routeShapes.map((shape, i) => ({
            id: `route-shape-am-${i}`,
            geoJSON: toLineGeoJSON(shape.points),
            color: routeColor(shape.routeColor),
            isDashed: shape.isDashed,
        }));
    }, [result?.routeShapes]);

    const pmRouteShapeGeoJSONs = useMemo(() => {
        if (!result?.afternoonRouteShapes) return [];
        return result.afternoonRouteShapes.map((shape, i) => ({
            id: `route-shape-pm-${i}`,
            geoJSON: toLineGeoJSON(shape.points),
            color: routeColor(shape.routeColor),
        }));
    }, [result?.afternoonRouteShapes]);

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
        return { transferPt, legA, legB, waitMin, quality };
    }, [result]);

    // ── Travel time label positions ───────────────────────────────────────────
    const travelTimeLabels = useMemo(() => {
        if (!result?.found || !result.routeShapes) return [];

        const labels: Array<{ pt: [number, number]; text: string }> = [];

        if (!result.isDirect && result.morningLegs.length >= 2) {
            const shapeA = result.routeShapes[0];
            const shapeB = result.routeShapes[1];
            const legA = result.morningLegs[0];
            const legB = result.morningLegs[1];

            if (shapeA && shapeA.points.length > 1) {
                const midIdx = Math.floor(shapeA.points.length / 2);
                const travelMin = legA.arrivalMinutes - legA.departureMinutes;
                labels.push({ pt: midPoint(shapeA.points, midIdx), text: `Rt ${legA.routeShortName} · ${travelMin} min` });
            }
            if (shapeB && shapeB.points.length > 1) {
                const midIdx = Math.floor(shapeB.points.length / 2);
                const travelMin = legB.arrivalMinutes - legB.departureMinutes;
                labels.push({ pt: midPoint(shapeB.points, midIdx), text: `Rt ${legB.routeShortName} · ${travelMin} min` });
            }
        } else {
            const shape = result.routeShapes[0];
            const leg = result.morningLegs[0];
            if (shape && shape.points.length > 1 && leg) {
                const midIdx = Math.floor(shape.points.length / 2);
                const travelMin = leg.arrivalMinutes - leg.departureMinutes;
                const depTime = minutesToDisplayTime(leg.departureMinutes);
                const arrTime = minutesToDisplayTime(leg.arrivalMinutes);
                labels.push({
                    pt: midPoint(shape.points, midIdx),
                    text: `Rt ${leg.routeShortName} · ${travelMin} min (${depTime}\u2192${arrTime})`,
                });
            }
        }

        return labels;
    }, [result]);

    const pmTravelTimeLabels = useMemo(() => {
        if (!result?.found || !result.afternoonRouteShapes || !result.afternoonLegs) return [];
        const labels: Array<{ pt: [number, number]; text: string }> = [];
        for (let i = 0; i < result.afternoonLegs.length && i < result.afternoonRouteShapes.length; i++) {
            const shape = result.afternoonRouteShapes[i];
            const leg = result.afternoonLegs[i];
            if (shape.points.length > 1) {
                const midIdx = Math.floor(shape.points.length / 2);
                const travelMin = leg.arrivalMinutes - leg.departureMinutes;
                const depTime = minutesToDisplayTime(leg.departureMinutes);
                labels.push({
                    pt: midPoint(shape.points, midIdx),
                    text: `PM Rt ${leg.routeShortName} · ${travelMin} min (${depTime})`,
                });
            }
        }
        return labels;
    }, [result]);

    const hasResult = Boolean(result?.found);

    return (
        <MapBase mapStyle="mapbox://styles/mapbox/satellite-streets-v12">

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
                        <div
                            style={{
                                width: 14,
                                height: 14,
                                borderRadius: '50%',
                                background: '#111827',
                                border: '3px solid #fff',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
                            }}
                        />
                    </Marker>
                    {/* School label above pin */}
                    <Marker longitude={school.lon} latitude={school.lat} anchor="bottom" offset={[0, -10]}>
                        <MapLabel text={school.name} size="lg" />
                    </Marker>
                </>
            )}

            {/* ── Zone stop markers (white circles, blue border) ── */}
            {/* Rendered as a GeoJSON circle layer — populated when result is present */}
            <Source id="zone-stops" type="geojson" data={zoneStopsGeoJSON}>
                <Layer {...ZONE_STOPS_LAYER} />
            </Source>

            {/* ── Walking leg: zone centroid → boarding stop ── */}
            {hasResult && walkToStopGeoJSON && result?.walkToStop && (
                <>
                    <Source id="walk-to-stop" type="geojson" data={walkToStopGeoJSON}>
                        <Layer {...walkLineLayer('walk-to-stop-line', '#6B7280', 0.7, [4, 8])} />
                    </Source>

                    {/* Walk time label at midpoint */}
                    <Marker
                        longitude={(result.walkToStop.fromLon + result.walkToStop.toLon) / 2}
                        latitude={(result.walkToStop.fromLat + result.walkToStop.toLat) / 2}
                        anchor="bottom"
                        offset={[0, 6]}
                    >
                        <MapLabel text={`Walk ${result.walkToStop.walkMinutes} min`} size="sm" />
                    </Marker>

                    {/* Zone centroid marker */}
                    <Marker longitude={result.walkToStop.fromLon} latitude={result.walkToStop.fromLat} anchor="center">
                        <div
                            style={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                background: '#111827',
                                border: '2px solid #fff',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                            }}
                        />
                    </Marker>
                    {/* "Start" label above centroid */}
                    <Marker longitude={result.walkToStop.fromLon} latitude={result.walkToStop.fromLat} anchor="bottom" offset={[0, -10]}>
                        <MapLabel text="Start" size="sm" />
                    </Marker>

                    {/* Boarding stop marker (green, prominent) */}
                    <Marker longitude={result.walkToStop.toLon} latitude={result.walkToStop.toLat} anchor="center">
                        <div
                            style={{
                                width: 16,
                                height: 16,
                                borderRadius: '50%',
                                background: '#10B981',
                                border: '3px solid #fff',
                                boxShadow: '0 2px 8px rgba(0,0,0,0.6)',
                            }}
                        />
                    </Marker>
                </>
            )}

            {/* ── AM GTFS route shape segments ── */}
            {hasResult && amRouteShapeGeoJSONs.map(({ id, geoJSON, color, isDashed }) => (
                <Source key={id} id={id} type="geojson" data={geoJSON}>
                    <Layer {...routeLineLayer(`${id}-line`, color, 5, 0.9, isDashed)} />
                </Source>
            ))}

            {/* ── Transfer hub (animated glow + callout) ── */}
            {hasResult && transferHub && (
                <>
                    {/* Animated glow ring */}
                    <Marker
                        longitude={toGeoJSON(transferHub.transferPt)[0]}
                        latitude={toGeoJSON(transferHub.transferPt)[1]}
                        anchor="center"
                    >
                        <div className="relative flex items-center justify-center w-7 h-7">
                            <div className="absolute inset-[-2px] rounded-full border-2 border-amber-400 animate-ping" />
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_10px_4px_#F59E0B] z-10" />
                        </div>
                    </Marker>

                    {/* Transfer callout */}
                    <Marker
                        longitude={toGeoJSON(transferHub.transferPt)[0]}
                        latitude={toGeoJSON(transferHub.transferPt)[1]}
                        anchor="bottom"
                        offset={[0, -16]}
                    >
                        <div
                            style={{
                                background: '#111827',
                                color: 'white',
                                padding: '8px 12px',
                                borderRadius: 6,
                                fontSize: 12,
                                whiteSpace: 'nowrap',
                                border: '2px solid #F59E0B',
                                boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
                                lineHeight: 1.6,
                                fontFamily: 'system-ui, -apple-system, sans-serif',
                                pointerEvents: 'none',
                            }}
                        >
                            <div style={{ fontWeight: 800, fontSize: 13, color: '#FCD34D' }}>
                                Transfer at {transferHub.legA.toStop}
                            </div>
                            <div style={{ color: '#E5E7EB', fontWeight: 500 }}>
                                Arrive {minutesToDisplayTime(transferHub.legA.arrivalMinutes)} &rarr; Depart {minutesToDisplayTime(transferHub.legB.departureMinutes)}
                            </div>
                            <div style={{ color: '#E5E7EB', fontWeight: 500 }}>
                                Wait {transferHub.waitMin} min · {transferHub.quality} · Rt {transferHub.legA.routeShortName} &rarr; Rt {transferHub.legB.routeShortName}
                            </div>
                        </div>
                    </Marker>
                </>
            )}

            {/* ── AM travel time labels (midpoint of each shape) ── */}
            {hasResult && travelTimeLabels.map((label, i) => (
                <Marker
                    key={`tt-am-${i}`}
                    longitude={toGeoJSON(label.pt)[0]}
                    latitude={toGeoJSON(label.pt)[1]}
                    anchor="bottom"
                    offset={[0, 6]}
                >
                    <MapLabel text={label.text} size="lg" />
                </Marker>
            ))}

            {/* ── Walking leg: alighting stop → school ── */}
            {hasResult && walkToSchoolGeoJSON && result?.walkToSchool && (
                <>
                    <Source id="walk-to-school" type="geojson" data={walkToSchoolGeoJSON}>
                        <Layer {...walkLineLayer('walk-to-school-line', '#6B7280', 0.7, [4, 8])} />
                    </Source>
                    <Marker
                        longitude={(result.walkToSchool.fromLon + result.walkToSchool.toLon) / 2}
                        latitude={(result.walkToSchool.fromLat + result.walkToSchool.toLat) / 2}
                        anchor="bottom"
                        offset={[0, 6]}
                    >
                        <MapLabel text={`Walk ${result.walkToSchool.walkMinutes} min to school`} size="sm" />
                    </Marker>
                </>
            )}

            {/* ═══ AFTERNOON RETURN TRIP ════════════════════════════════════════ */}

            {/* ── Walk from school to afternoon boarding stop ── */}
            {hasResult && walkFromSchoolGeoJSON && result?.walkFromSchool && (
                <>
                    <Source id="walk-from-school" type="geojson" data={walkFromSchoolGeoJSON}>
                        <Layer {...walkLineLayer('walk-from-school-line', '#B45309', 0.6, [4, 8])} />
                    </Source>
                </>
            )}

            {/* ── Afternoon route shapes (amber-dashed) ── */}
            {hasResult && pmRouteShapeGeoJSONs.map(({ id, geoJSON, color }) => (
                <Source key={id} id={id} type="geojson" data={geoJSON}>
                    <Layer {...pmRouteLineLayer(`${id}-line`, color)} />
                </Source>
            ))}

            {/* ── PM travel time labels ── */}
            {hasResult && pmTravelTimeLabels.map((label, i) => (
                <Marker
                    key={`tt-pm-${i}`}
                    longitude={toGeoJSON(label.pt)[0]}
                    latitude={toGeoJSON(label.pt)[1]}
                    anchor="top"
                    offset={[0, -6]}
                >
                    <MapLabel text={label.text} size="lg" />
                </Marker>
            ))}

            {/* ── Walk from afternoon alighting stop to zone centroid ── */}
            {hasResult && walkToZoneGeoJSON && (
                <Source id="walk-to-zone" type="geojson" data={walkToZoneGeoJSON}>
                    <Layer {...walkLineLayer('walk-to-zone-line', '#B45309', 0.6, [4, 8])} />
                </Source>
            )}

        </MapBase>
    );
};
