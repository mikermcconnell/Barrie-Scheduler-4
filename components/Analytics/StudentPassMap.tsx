import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import type { SchoolConfig, StudentPassResult } from '../../utils/transit-app/studentPassUtils';
import { findStopsInZone, minutesToDisplayTime } from '../../utils/transit-app/studentPassUtils';

export interface StudentPassMapProps {
    school: SchoolConfig | null;
    result: StudentPassResult | null;
    onPolygonComplete: (coords: [number, number][]) => void;
    onPolygonClear: () => void;
}

const BARRIE_CENTER: [number, number] = [44.38, -79.69];

const MAP_STYLES = `
/* All map labels use this base — centered on the marker point, never clipped */
.spm-label-wrap { position:relative; display:flex; justify-content:center; left:50%; transform:translateX(-50%); }
.spm-label { background:#111827; color:white; padding:4px 10px; border-radius:4px; font-size:12px; font-weight:700; white-space:nowrap; border:1.5px solid rgba(255,255,255,0.85); box-shadow:0 2px 8px rgba(0,0,0,0.6); font-family:system-ui,-apple-system,sans-serif; line-height:1.3; }
.spm-label-lg { font-size:13px; padding:12px 16px; font-weight:800; }
.spm-transfer { background:#111827; color:white; padding:8px 12px; border-radius:6px; font-size:12px; white-space:nowrap; border:2px solid #F59E0B; box-shadow:0 4px 16px rgba(0,0,0,0.6); line-height:1.6; font-family:system-ui,-apple-system,sans-serif; }
.spm-transfer .t-title { font-weight:800; font-size:13px; color:#FCD34D; }
.spm-transfer .t-detail { color:#E5E7EB; font-weight:500; }
@keyframes hub-ring { 0%{transform:scale(0.8);opacity:0.6} 100%{transform:scale(2.2);opacity:0} }
.transfer-hub-glow { position:relative; display:flex; align-items:center; justify-content:center; width:28px; height:28px; }
.transfer-hub-glow .core { width:10px; height:10px; border-radius:50%; background:#F59E0B; box-shadow:0 0 10px 4px #F59E0B; z-index:1; }
.transfer-hub-glow .ring { position:absolute; inset:-2px; border-radius:50%; border:2px solid #F59E0B; animation:hub-ring 2.5s ease-out infinite; }

/* Leaflet-draw control overrides */
.student-pass-map .leaflet-draw-toolbar a { width:32px; height:32px; line-height:32px; background-color:#1F2937; border:none; border-radius:6px; margin:2px; }
.student-pass-map .leaflet-draw-toolbar a:hover { background-color:#374151; }
.student-pass-map .leaflet-draw-toolbar { border:none; background:transparent; padding:2px; }
.student-pass-map .leaflet-draw-actions { background:#1F2937; border:none; border-radius:6px; overflow:hidden; }
.student-pass-map .leaflet-draw-actions a { background:#1F2937; color:#E5E7EB; border:none; font-size:11px; }
.student-pass-map .leaflet-draw-actions a:hover { background:#374151; }
.student-pass-map .leaflet-draw-actions li:first-child a { border-radius:6px 0 0 6px; }
.student-pass-map .leaflet-draw-actions li:last-child a { border-radius:0 6px 6px 0; }
.student-pass-map .leaflet-control-zoom a { background-color:#1F2937; color:#E5E7EB; border:none; width:30px; height:30px; line-height:30px; font-size:14px; }
.student-pass-map .leaflet-control-zoom a:hover { background-color:#374151; }
.student-pass-map .leaflet-control-zoom { border:none; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.3); }
`;

export const StudentPassMap: React.FC<StudentPassMapProps> = ({
    school,
    result,
    onPolygonComplete,
    onPolygonClear,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const drawLayerRef = useRef<L.FeatureGroup | null>(null);
    const drawControlRef = useRef<L.Control | null>(null);
    const overlayLayerRef = useRef<L.LayerGroup | null>(null);
    const schoolLayerRef = useRef<L.LayerGroup | null>(null);
    // Keep stable refs for callbacks so map event handlers don't go stale
    const onPolygonCompleteRef = useRef(onPolygonComplete);
    const onPolygonClearRef = useRef(onPolygonClear);

    useEffect(() => { onPolygonCompleteRef.current = onPolygonComplete; }, [onPolygonComplete]);
    useEffect(() => { onPolygonClearRef.current = onPolygonClear; }, [onPolygonClear]);

    // Inject CSS once
    useEffect(() => {
        const id = 'student-pass-map-styles';
        if (document.getElementById(id)) return;
        const el = document.createElement('style');
        el.id = id;
        el.textContent = MAP_STYLES;
        document.head.appendChild(el);
        return () => { document.getElementById(id)?.remove(); };
    }, []);

    // Initialize map
    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = L.map(containerRef.current, {
            center: BARRIE_CENTER,
            zoom: 13,
            zoomSnap: 0.25,
            zoomDelta: 0.25,
            scrollWheelZoom: 'center',
            wheelPxPerZoomLevel: 120,
        });

        // Satellite base layer
        L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            {
                attribution: 'Tiles &copy; Esri',
                maxZoom: 20,
            }
        ).addTo(map);

        // Road labels overlay
        L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
            {
                attribution: '',
                maxZoom: 20,
                opacity: 0.8,
            }
        ).addTo(map);

        // Draw layer
        const drawLayer = new L.FeatureGroup();
        map.addLayer(drawLayer);
        drawLayerRef.current = drawLayer;

        // Overlay layer for result markers
        const overlayLayer = L.layerGroup().addTo(map);
        overlayLayerRef.current = overlayLayer;

        // School marker layer
        const schoolLayer = L.layerGroup().addTo(map);
        schoolLayerRef.current = schoolLayer;

        // Draw control
        const drawControl = new (L.Control as unknown as {
            Draw: new (opts: unknown) => L.Control;
        }).Draw({
            position: 'topright',
            draw: {
                polygon: {
                    allowIntersection: false,
                    shapeOptions: {
                        color: '#1D4ED8',
                        fillColor: '#3B82F6',
                        fillOpacity: 0.25,
                        weight: 2,
                    },
                },
                polyline: false,
                rectangle: false,
                circle: false,
                circlemarker: false,
                marker: false,
            },
            edit: { featureGroup: drawLayer, remove: true },
        });
        map.addControl(drawControl);
        drawControlRef.current = drawControl;

        // Draw event handlers
        map.on((L as unknown as { Draw: { Event: { CREATED: string } } }).Draw.Event.CREATED, (e: unknown) => {
            const event = e as { layer: L.Layer };
            drawLayer.clearLayers();
            drawLayer.addLayer(event.layer);
            const latlngs = (event.layer as L.Polygon).getLatLngs()[0] as L.LatLng[];
            onPolygonCompleteRef.current(latlngs.map(ll => [ll.lat, ll.lng]));
        });

        map.on((L as unknown as { Draw: { Event: { EDITED: string } } }).Draw.Event.EDITED, () => {
            const layers = drawLayer.getLayers();
            if (layers.length > 0) {
                const polygon = layers[0] as L.Polygon;
                const latlngs = polygon.getLatLngs()[0] as L.LatLng[];
                onPolygonCompleteRef.current(latlngs.map(ll => [ll.lat, ll.lng]));
            }
        });

        map.on((L as unknown as { Draw: { Event: { DELETED: string } } }).Draw.Event.DELETED, () => {
            onPolygonClearRef.current();
        });

        // ResizeObserver for proper map invalidation
        const ro = new ResizeObserver(() => {
            map.invalidateSize();
        });
        ro.observe(containerRef.current);

        mapRef.current = map;

        return () => {
            ro.disconnect();
            map.remove();
            mapRef.current = null;
            drawLayerRef.current = null;
            drawControlRef.current = null;
            overlayLayerRef.current = null;
            schoolLayerRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Update school marker when school changes
    useEffect(() => {
        const layer = schoolLayerRef.current;
        if (!layer) return;
        layer.clearLayers();

        if (!school) return;

        // Pin circle at exact school location
        L.circleMarker([school.lat, school.lon], {
            radius: 7,
            fillColor: '#111827',
            color: '#fff',
            weight: 3,
            fillOpacity: 1,
            opacity: 1,
        }).addTo(layer);

        // Label above the pin
        const labelIcon = L.divIcon({
            className: 'spm-label-wrap',
            iconSize: [0, 0],
            html: `<div class="spm-label spm-label-lg" style="transform:translateY(-36px)">${school.name}</div>`,
        });
        L.marker([school.lat, school.lon], { icon: labelIcon, interactive: false }).addTo(layer);
    }, [school]);

    // Update result overlay when result changes
    useEffect(() => {
        const layer = overlayLayerRef.current;
        if (!layer) return;
        layer.clearLayers();

        if (!result?.found) return;

        // ── Zone stop markers (white circles, blue border) ──
        const drawLayer = drawLayerRef.current;
        if (drawLayer) {
            const drawnLayers = drawLayer.getLayers();
            if (drawnLayers.length > 0) {
                const polygon = drawnLayers[0] as L.Polygon;
                const latlngs = polygon.getLatLngs()[0] as L.LatLng[];
                const coords: [number, number][] = latlngs.map(ll => [ll.lat, ll.lng]);
                const zoneStops = findStopsInZone(coords);
                for (const stop of zoneStops) {
                    L.circleMarker([stop.lat, stop.lon], {
                        radius: 5,
                        fillColor: '#fff',
                        color: '#3B82F6',
                        weight: 2,
                        fillOpacity: 0.9,
                        opacity: 0.8,
                    })
                        .bindTooltip(stop.stop_name, { direction: 'top' })
                        .addTo(layer);
                }
            }
        }

        // ── Walking leg: centroid → boarding stop ──
        if (result.walkToStop) {
            const w = result.walkToStop;
            L.polyline([[w.fromLat, w.fromLon], [w.toLat, w.toLon]], {
                color: '#6B7280',
                weight: 3,
                opacity: 0.7,
                dashArray: '4, 8',
            })
                .bindTooltip(`Walk ${w.walkMinutes} min (${(w.distanceKm * 1000).toFixed(0)}m)`, { direction: 'center', sticky: true })
                .addTo(layer);

            // Walk time label at midpoint
            const walkIcon = L.divIcon({
                className: 'spm-label-wrap',
                iconSize: [0, 0],
                html: `<div class="spm-label" style="transform:translateY(-12px)">🚶 ${w.walkMinutes} min</div>`,
            });
            const midLat = (w.fromLat + w.toLat) / 2;
            const midLon = (w.fromLon + w.toLon) / 2;
            L.marker([midLat, midLon], { icon: walkIcon, interactive: false }).addTo(layer);

            // Zone centroid marker
            L.circleMarker([w.fromLat, w.fromLon], {
                radius: 6, fillColor: '#111827', color: '#fff', weight: 2, fillOpacity: 1, opacity: 1,
            }).addTo(layer);
            const centroidIcon = L.divIcon({
                className: 'spm-label-wrap',
                iconSize: [0, 0],
                html: '<div class="spm-label" style="transform:translateY(-32px)">📍 Start</div>',
            });
            L.marker([w.fromLat, w.fromLon], { icon: centroidIcon })
                .bindTooltip('Your starting point (zone center)', { direction: 'top' })
                .addTo(layer);
        }

        // ── Boarding stop marker (green, prominent) ──
        if (result.walkToStop) {
            const w = result.walkToStop;
            L.circleMarker([w.toLat, w.toLon], {
                radius: 8,
                fillColor: '#10B981',
                color: '#fff',
                weight: 3,
                fillOpacity: 1,
                opacity: 1,
            })
                .bindTooltip(`Board: ${result.morningLegs[0]?.fromStop ?? 'Boarding stop'}`, { direction: 'top' })
                .addTo(layer);
        }

        // ── GTFS route shape segments ──
        if (result.routeShapes) {
            for (const shape of result.routeShapes) {
                if (shape.points.length < 2) continue;
                const color = shape.routeColor.startsWith('#') ? shape.routeColor : `#${shape.routeColor}`;
                L.polyline(shape.points, {
                    color,
                    weight: 5,
                    opacity: 0.9,
                    dashArray: shape.isDashed ? '8, 6' : undefined,
                })
                    .bindTooltip(`Route ${shape.routeShortName}`, { direction: 'center', sticky: true })
                    .addTo(layer);
            }
        }

        // ── Transfer hub + detailed callout ──
        if (!result.isDirect && result.morningLegs.length >= 2) {
            const legA = result.morningLegs[0];
            const legB = result.morningLegs[1];
            const shapeA = result.routeShapes?.[0];
            if (shapeA && shapeA.points.length > 0) {
                const transferPt = shapeA.points[shapeA.points.length - 1];

                // Animated glow ring
                const hubIcon = L.divIcon({
                    className: '',
                    html: '<div class="transfer-hub-glow"><div class="ring"></div><div class="core"></div></div>',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                });
                L.marker(transferPt, { icon: hubIcon, interactive: false }).addTo(layer);

                // Detailed transfer callout
                const waitMin = result.transfer?.waitMinutes ?? '?';
                const quality = result.transfer?.label ?? '';
                const arriveTime = legA.arrivalMinutes;
                const departTime = legB.departureMinutes;
                const calloutHtml = `<div class="spm-transfer" style="transform:translateY(-50px)">` +
                    `<div class="t-title">Transfer at ${legA.toStop}</div>` +
                    `<div class="t-detail">Arrive ${minutesToDisplayTime(arriveTime)} → Depart ${minutesToDisplayTime(departTime)}</div>` +
                    `<div class="t-detail">Wait ${waitMin} min · ${quality} · Rt ${legA.routeShortName} → Rt ${legB.routeShortName}</div>` +
                    `</div>`;
                const calloutIcon = L.divIcon({
                    className: 'spm-label-wrap',
                    iconSize: [0, 0],
                    html: calloutHtml,
                });
                L.marker(transferPt, { icon: calloutIcon, interactive: false }).addTo(layer);
            }

            // Travel time label for leg A
            if (shapeA && shapeA.points.length > 1) {
                const midIdx = Math.floor(shapeA.points.length / 2);
                const midPt = shapeA.points[midIdx];
                const travelMin = legA.arrivalMinutes - legA.departureMinutes;
                const timeIcon = L.divIcon({
                    className: 'spm-label-wrap',
                    iconSize: [0, 0],
                    html: `<div class="spm-label spm-label-lg" style="transform:translateY(-12px)">Rt ${legA.routeShortName} · ${travelMin} min</div>`,
                });
                L.marker(midPt, { icon: timeIcon, interactive: false }).addTo(layer);
            }

            // Travel time label for leg B
            const shapeB = result.routeShapes?.[1];
            if (shapeB && shapeB.points.length > 1) {
                const midIdx = Math.floor(shapeB.points.length / 2);
                const midPt = shapeB.points[midIdx];
                const travelMin = legB.arrivalMinutes - legB.departureMinutes;
                const timeIcon = L.divIcon({
                    className: 'spm-label-wrap',
                    iconSize: [0, 0],
                    html: `<div class="spm-label spm-label-lg" style="transform:translateY(-12px)">Rt ${legB.routeShortName} · ${travelMin} min</div>`,
                });
                L.marker(midPt, { icon: timeIcon, interactive: false }).addTo(layer);
            }
        } else {
            // Direct trip: single travel time label at midpoint of shape
            const shape = result.routeShapes?.[0];
            if (shape && shape.points.length > 1) {
                const midIdx = Math.floor(shape.points.length / 2);
                const midPt = shape.points[midIdx];
                const leg = result.morningLegs[0];
                const travelMin = leg.arrivalMinutes - leg.departureMinutes;
                const depTime = minutesToDisplayTime(leg.departureMinutes);
                const arrTime = minutesToDisplayTime(leg.arrivalMinutes);
                const timeIcon = L.divIcon({
                    className: 'spm-label-wrap',
                    iconSize: [0, 0],
                    html: `<div class="spm-label spm-label-lg" style="transform:translateY(-12px)">Rt ${leg.routeShortName} · ${travelMin} min (${depTime}→${arrTime})</div>`,
                });
                L.marker(midPt, { icon: timeIcon, interactive: false }).addTo(layer);
            }
        }

        // ── Walking leg: alighting stop → school ──
        if (result.walkToSchool && school) {
            const w = result.walkToSchool;
            L.polyline([[w.fromLat, w.fromLon], [w.toLat, w.toLon]], {
                color: '#6B7280',
                weight: 3,
                opacity: 0.7,
                dashArray: '4, 8',
            })
                .bindTooltip(`Walk ${w.walkMinutes} min (${(w.distanceKm * 1000).toFixed(0)}m)`, { direction: 'center', sticky: true })
                .addTo(layer);

            // Walk label near school
            const walkSchoolIcon = L.divIcon({
                className: 'spm-label-wrap',
                iconSize: [0, 0],
                html: `<div class="spm-label" style="transform:translateY(-12px)">🚶 ${w.walkMinutes} min to school</div>`,
            });
            const midLat = (w.fromLat + w.toLat) / 2;
            const midLon = (w.fromLon + w.toLon) / 2;
            L.marker([midLat, midLon], { icon: walkSchoolIcon, interactive: false }).addTo(layer);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // AFTERNOON RETURN TRIP
        // ═══════════════════════════════════════════════════════════════════════

        // ── Walk from school to afternoon boarding stop ──
        if (result.walkFromSchool) {
            const w = result.walkFromSchool;
            L.polyline([[w.fromLat, w.fromLon], [w.toLat, w.toLon]], {
                color: '#B45309', // amber-700
                weight: 3,
                opacity: 0.6,
                dashArray: '4, 8',
            })
                .bindTooltip(`Walk ${w.walkMinutes} min (${(w.distanceKm * 1000).toFixed(0)}m)`, { direction: 'center', sticky: true })
                .addTo(layer);
        }

        // ── Afternoon route shapes (amber-tinted) ──
        if (result.afternoonRouteShapes) {
            for (const shape of result.afternoonRouteShapes) {
                if (shape.points.length < 2) continue;
                const color = shape.routeColor.startsWith('#') ? shape.routeColor : `#${shape.routeColor}`;
                L.polyline(shape.points, {
                    color,
                    weight: 4,
                    opacity: 0.6,
                    dashArray: '10, 6',
                })
                    .bindTooltip(`PM: Route ${shape.routeShortName}`, { direction: 'center', sticky: true })
                    .addTo(layer);
            }

            // Afternoon travel time labels
            for (let i = 0; i < result.afternoonLegs.length && i < result.afternoonRouteShapes.length; i++) {
                const shape = result.afternoonRouteShapes[i];
                const leg = result.afternoonLegs[i];
                if (shape.points.length > 1) {
                    const midIdx = Math.floor(shape.points.length / 2);
                    const midPt = shape.points[midIdx];
                    const travelMin = leg.arrivalMinutes - leg.departureMinutes;
                    const depTime = minutesToDisplayTime(leg.departureMinutes);
                    const timeIcon = L.divIcon({
                        className: 'spm-label-wrap',
                        iconSize: [0, 0],
                        html: `<div class="spm-label spm-label-lg" style="transform:translateY(6px)">PM Rt ${leg.routeShortName} · ${travelMin} min (${depTime})</div>`,
                    });
                    L.marker(midPt, { icon: timeIcon, interactive: false }).addTo(layer);
                }
            }
        }

        // ── Walk from afternoon alighting stop to zone centroid ──
        if (result.walkToZone) {
            const w = result.walkToZone;
            L.polyline([[w.fromLat, w.fromLon], [w.toLat, w.toLon]], {
                color: '#B45309',
                weight: 3,
                opacity: 0.6,
                dashArray: '4, 8',
            })
                .bindTooltip(`Walk home ${w.walkMinutes} min (${(w.distanceKm * 1000).toFixed(0)}m)`, { direction: 'center', sticky: true })
                .addTo(layer);
        }
    }, [result, school]);

    return (
        <div
            ref={containerRef}
            className="student-pass-map"
            style={{ width: '100%', height: '100%', minHeight: 300 }}
        />
    );
};
