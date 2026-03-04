import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import type { SchoolConfig, StudentPassResult } from '../../utils/transit-app/studentPassUtils';
import { findStopsInZone } from '../../utils/transit-app/studentPassUtils';

export interface StudentPassMapProps {
    school: SchoolConfig | null;
    result: StudentPassResult | null;
    onPolygonComplete: (coords: [number, number][]) => void;
    onPolygonClear: () => void;
}

const BARRIE_CENTER: [number, number] = [44.38, -79.69];

const MAP_STYLES = `
.school-marker { display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; background:#1F2937; border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.3); font-size:16px; }
.travel-time-label { background:rgba(17,24,39,0.9); color:white; padding:4px 12px; border-radius:999px; font-size:13px; font-weight:700; white-space:nowrap; border:none; box-shadow:0 2px 8px rgba(0,0,0,0.3); }
@keyframes hub-ring { 0%{transform:scale(0.8);opacity:0.6} 100%{transform:scale(2.2);opacity:0} }
.transfer-hub-glow { position:relative; display:flex; align-items:center; justify-content:center; width:28px; height:28px; }
.transfer-hub-glow .core { width:10px; height:10px; border-radius:50%; background:#F59E0B; box-shadow:0 0 10px 4px #F59E0B; z-index:1; }
.transfer-hub-glow .ring { position:absolute; inset:-2px; border-radius:50%; border:2px solid #F59E0B; animation:hub-ring 2.5s ease-out infinite; }
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

        const icon = L.divIcon({
            className: '',
            html: '<div class="school-marker">🏫</div>',
            iconSize: [32, 32],
            iconAnchor: [16, 16],
        });

        L.marker([school.lat, school.lon], { icon })
            .bindTooltip(school.name, { direction: 'top', permanent: false })
            .addTo(layer);
    }, [school]);

    // Update result overlay when result changes
    useEffect(() => {
        const layer = overlayLayerRef.current;
        if (!layer) return;
        layer.clearLayers();

        if (!result?.found) return;

        const morningLeg = result.morningLegs[0];
        if (!morningLeg) return;

        // Find zone stops from draw layer polygon (if any drawn)
        const drawLayer = drawLayerRef.current;
        if (!drawLayer) return;
        const drawnLayers = drawLayer.getLayers();
        if (drawnLayers.length === 0) return;

        const polygon = drawnLayers[0] as L.Polygon;
        const latlngs = polygon.getLatLngs()[0] as L.LatLng[];
        const coords: [number, number][] = latlngs.map(ll => [ll.lat, ll.lng]);
        const zoneStops = findStopsInZone(coords);

        // Zone stop markers (white circles, blue border)
        for (const stop of zoneStops) {
            L.circleMarker([stop.lat, stop.lon], {
                radius: 6,
                fillColor: '#fff',
                color: '#3B82F6',
                weight: 2,
                fillOpacity: 1,
                opacity: 1,
            })
                .bindTooltip(stop.stop_name, { direction: 'top' })
                .addTo(layer);
        }

        // Transfer result: find transfer stop coords and draw Route B
        if (!result.isDirect && result.morningLegs.length >= 2) {
            const legB = result.morningLegs[1];

            // Highlight transfer stop (amber hub glow) — find stop by name
            const { getAllStopsWithCoords } = require('../../utils/gtfs/gtfsStopLookup');
            const allStops: Array<{ stop_id: string; stop_name: string; lat: number; lon: number }> = getAllStopsWithCoords();
            const transferStop = allStops.find(
                (s) => s.stop_name.toLowerCase() === legB.fromStop.toLowerCase()
            );

            if (transferStop) {
                const hubIcon = L.divIcon({
                    className: '',
                    html: '<div class="transfer-hub-glow"><div class="ring"></div><div class="core"></div></div>',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                });
                L.marker([transferStop.lat, transferStop.lon], { icon: hubIcon })
                    .bindTooltip(`Transfer: ${transferStop.stop_name}`, { direction: 'top' })
                    .addTo(layer);

                // Route B polyline (dashed, from transfer stop to school stop)
                if (school) {
                    const routeBColor = `#${legB.routeColor.replace('#', '')}`;
                    L.polyline([[transferStop.lat, transferStop.lon], [school.lat, school.lon]], {
                        color: routeBColor,
                        weight: 5,
                        opacity: 0.9,
                        dashArray: '8, 6',
                    })
                        .bindTooltip(`Route ${legB.routeShortName}`, { direction: 'center', sticky: true })
                        .addTo(layer);
                }
            }

            // Route A boarding stop (green circle)
            const boardingStop = allStops.find(
                (s) => s.stop_name.toLowerCase() === morningLeg.fromStop.toLowerCase()
            );
            if (boardingStop) {
                L.circleMarker([boardingStop.lat, boardingStop.lon], {
                    radius: 8,
                    fillColor: '#10B981',
                    color: '#fff',
                    weight: 3,
                    fillOpacity: 1,
                    opacity: 1,
                })
                    .bindTooltip(`Board: ${boardingStop.stop_name}`, { direction: 'top' })
                    .addTo(layer);
            }

            // Route A polyline (solid)
            const routeAColor = `#${morningLeg.routeColor.replace('#', '')}`;
            if (boardingStop && transferStop) {
                const midLat = (boardingStop.lat + transferStop.lat) / 2;
                const midLon = (boardingStop.lon + transferStop.lon) / 2;
                const travelMin = morningLeg.arrivalMinutes - morningLeg.departureMinutes;

                L.polyline([[boardingStop.lat, boardingStop.lon], [transferStop.lat, transferStop.lon]], {
                    color: routeAColor,
                    weight: 5,
                    opacity: 0.9,
                })
                    .bindTooltip(`Route ${morningLeg.routeShortName}`, { direction: 'center', sticky: true })
                    .addTo(layer);

                // Travel time label at midpoint
                const timeIcon = L.divIcon({
                    className: 'travel-time-label',
                    html: `${travelMin} min`,
                    iconAnchor: undefined,
                });
                L.marker([midLat, midLon], { icon: timeIcon, interactive: false }).addTo(layer);
            }
        } else if (result.isDirect && school) {
            // Direct trip: boarding stop (green) + solid polyline to school
            const { getAllStopsWithCoords: getStops } = require('../../utils/gtfs/gtfsStopLookup');
            const allStops: Array<{ stop_id: string; stop_name: string; lat: number; lon: number }> = getStops();

            const boardingStop = allStops.find(
                (s) => s.stop_name.toLowerCase() === morningLeg.fromStop.toLowerCase()
            );
            if (boardingStop) {
                L.circleMarker([boardingStop.lat, boardingStop.lon], {
                    radius: 8,
                    fillColor: '#10B981',
                    color: '#fff',
                    weight: 3,
                    fillOpacity: 1,
                    opacity: 1,
                })
                    .bindTooltip(`Board: ${boardingStop.stop_name}`, { direction: 'top' })
                    .addTo(layer);

                const routeColor = `#${morningLeg.routeColor.replace('#', '')}`;
                L.polyline([[boardingStop.lat, boardingStop.lon], [school.lat, school.lon]], {
                    color: routeColor,
                    weight: 5,
                    opacity: 0.9,
                })
                    .bindTooltip(`Route ${morningLeg.routeShortName}`, { direction: 'center', sticky: true })
                    .addTo(layer);

                const midLat = (boardingStop.lat + school.lat) / 2;
                const midLon = (boardingStop.lon + school.lon) / 2;
                const travelMin = morningLeg.arrivalMinutes - morningLeg.departureMinutes;

                const timeIcon = L.divIcon({
                    className: 'travel-time-label',
                    html: `${travelMin} min`,
                    iconAnchor: undefined,
                });
                L.marker([midLat, midLon], { icon: timeIcon, interactive: false }).addTo(layer);
            }
        }
    }, [result, school]);

    return (
        <div
            ref={containerRef}
            style={{ width: '100%', height: '100%', minHeight: 300 }}
        />
    );
};
