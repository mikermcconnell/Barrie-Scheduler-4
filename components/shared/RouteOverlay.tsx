import React, { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { toGeoJSON } from './mapUtils';

export interface RouteShape {
    routeShortName: string;
    routeColor: string;
    points: [number, number][];
}

export interface RouteOverlayProps {
    shapes: RouteShape[];
    opacity?: number;
    weight?: number;
    dashed?: boolean;
    idPrefix?: string;
}

export const RouteOverlay: React.FC<RouteOverlayProps> = ({
    shapes,
    opacity = 0.5,
    weight = 3,
    dashed = true,
    idPrefix = 'route-overlay',
}) => {
    const geoJSONData = useMemo(() => {
        const features: GeoJSON.Feature[] = shapes.map((shape, i) => ({
            type: 'Feature',
            properties: {
                color: shape.routeColor.startsWith('#') ? shape.routeColor : `#${shape.routeColor}`,
                name: shape.routeShortName,
                index: i,
            },
            geometry: {
                type: 'LineString',
                coordinates: shape.points.map(toGeoJSON),
            },
        }));
        return { type: 'FeatureCollection' as const, features };
    }, [shapes]);

    const layerStyle: LayerProps = useMemo(() => ({
        id: `${idPrefix}-lines`,
        type: 'line',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': weight,
            'line-opacity': opacity,
            ...(dashed ? { 'line-dasharray': [6, 4] } : {}),
        },
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
    }), [idPrefix, weight, opacity, dashed]);

    if (shapes.length === 0) return null;

    return (
        <Source id={`${idPrefix}-src`} type="geojson" data={geoJSONData}>
            <Layer {...layerStyle} />
        </Source>
    );
};
