import React, { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { toGeoJSON } from './mapUtils';

export interface StopPoint {
    id: string;
    lat: number;
    lon: number;
    name?: string;
}

export interface StopDotLayerProps {
    stops: StopPoint[];
    radius?: number;
    color?: string;
    opacity?: number;
    outlineColor?: string;
    outlineWidth?: number;
    minZoom?: number;
    idPrefix?: string;
}

export const StopDotLayer: React.FC<StopDotLayerProps> = ({
    stops,
    radius = 4,
    color = '#6B7280',
    opacity = 0.8,
    outlineColor = '#374151',
    outlineWidth = 1,
    minZoom = 0,
    idPrefix = 'stop-dots',
}) => {
    const geoJSONData = useMemo((): GeoJSON.FeatureCollection => ({
        type: 'FeatureCollection',
        features: stops.map((stop) => ({
            type: 'Feature',
            properties: { id: stop.id, name: stop.name ?? '' },
            geometry: {
                type: 'Point',
                coordinates: toGeoJSON([stop.lat, stop.lon]),
            },
        })),
    }), [stops]);

    const layerStyle: LayerProps = useMemo(() => ({
        id: `${idPrefix}-circles`,
        type: 'circle',
        minzoom: minZoom,
        paint: {
            'circle-radius': radius,
            'circle-color': color,
            'circle-opacity': opacity,
            'circle-stroke-color': outlineColor,
            'circle-stroke-width': outlineWidth,
        },
    }), [idPrefix, radius, color, opacity, outlineColor, outlineWidth, minZoom]);

    if (stops.length === 0) return null;

    return (
        <Source id={`${idPrefix}-src`} type="geojson" data={geoJSONData}>
            <Layer {...layerStyle} />
        </Source>
    );
};
