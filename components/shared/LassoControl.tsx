import React, { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { useMap, Source, Layer } from 'react-map-gl/mapbox';
import { toGeoJSON } from './mapUtils';

export interface LassoControlProps {
    active: boolean;
    onComplete: (polygon: [number, number][]) => void;
    onClear?: () => void;
    color?: string;
}

export const LassoControl: React.FC<LassoControlProps> = ({
    active,
    onComplete,
    onClear,
    color = '#f59e0b',
}) => {
    const { current: map } = useMap();
    const drawingRef = useRef<[number, number][] | null>(null);
    const [polygon, setPolygon] = useState<[number, number][] | null>(null);

    useEffect(() => {
        if (!map) return;
        if (active) {
            map.getMap().dragPan.disable();
        } else {
            map.getMap().dragPan.enable();
            setPolygon(null);
            drawingRef.current = null;
            onClear?.();
        }
        return () => { map.getMap().dragPan.enable(); };
    }, [active, map, onClear]);

    const onMouseDown = useCallback((e: mapboxgl.MapMouseEvent) => {
        if (!active) return;
        e.preventDefault();
        drawingRef.current = [[e.lngLat.lat, e.lngLat.lng]];
        setPolygon(null);
    }, [active]);

    const onMouseMove = useCallback((e: mapboxgl.MapMouseEvent) => {
        if (!drawingRef.current) return;
        drawingRef.current.push([e.lngLat.lat, e.lngLat.lng]);
        setPolygon([...drawingRef.current]);
    }, []);

    const onMouseUp = useCallback(() => {
        const points = drawingRef.current;
        drawingRef.current = null;
        if (!points || points.length < 3) {
            setPolygon(null);
            return;
        }
        setPolygon(points);
        onComplete(points);
    }, [onComplete]);

    useEffect(() => {
        if (!map) return;
        const m = map.getMap();
        m.on('mousedown', onMouseDown);
        m.on('mousemove', onMouseMove);
        m.on('mouseup', onMouseUp);
        return () => {
            m.off('mousedown', onMouseDown);
            m.off('mousemove', onMouseMove);
            m.off('mouseup', onMouseUp);
        };
    }, [map, onMouseDown, onMouseMove, onMouseUp]);

    const geoJSON = useMemo((): GeoJSON.FeatureCollection | null => {
        if (!polygon || polygon.length < 2) return null;
        const ring = [...polygon, polygon[0]];
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {},
                geometry: {
                    type: 'Polygon',
                    coordinates: [ring.map(p => toGeoJSON(p))],
                },
            }],
        };
    }, [polygon]);

    if (!geoJSON) return null;

    return (
        <Source id="lasso-polygon" type="geojson" data={geoJSON}>
            <Layer
                id="lasso-fill"
                type="fill"
                paint={{ 'fill-color': color, 'fill-opacity': 0.1 }}
            />
            <Layer
                id="lasso-line"
                type="line"
                paint={{
                    'line-color': color,
                    'line-width': 2,
                    'line-dasharray': [6, 4],
                }}
            />
        </Source>
    );
};
