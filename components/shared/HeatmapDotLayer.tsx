import React, { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { toGeoJSON } from './mapUtils';

export interface HeatmapBin {
    fill: string;
    fillOpacity: number;
    radius: number;
    label: string;
}

export interface HeatmapPoint {
    lat: number;
    lon: number;
    value: number;
    id: string;
    color?: string;
    outlineColor?: string;
    [key: string]: unknown;
}

export interface HeatmapDotLayerProps {
    points: HeatmapPoint[];
    bins: readonly HeatmapBin[];
    assignBin?: (value: number, allValues: number[]) => number;
    outlineColor?: string;
    outlineWidth?: number;
    idPrefix?: string;
}

function defaultAssignBin(value: number, allValues: number[], binCount: number): number {
    if (value === 0) return 0;
    const nonZero = allValues.filter(a => a > 0);
    if (nonZero.length === 0) return 0;
    const logMax = Math.log(Math.max(...nonZero) + 1);
    if (logMax === 0) return value > 0 ? 1 : 0;
    const t = Math.log(value + 1) / logMax;
    const bin = Math.ceil(t * (binCount - 1));
    return Math.max(1, Math.min(binCount - 1, bin));
}

export const HeatmapDotLayer: React.FC<HeatmapDotLayerProps> = ({
    points,
    bins,
    assignBin,
    outlineColor = '#374151',
    outlineWidth = 1,
    idPrefix = 'heatmap-dots',
}) => {
    const geoJSONData = useMemo((): GeoJSON.FeatureCollection => {
        const allValues = points.map(p => p.value);
        return {
            type: 'FeatureCollection',
            features: points.map((pt) => {
                const bin = assignBin
                    ? assignBin(pt.value, allValues)
                    : defaultAssignBin(pt.value, allValues, bins.length);
                return {
                    type: 'Feature',
                    properties: {
                        id: pt.id,
                        value: pt.value,
                        bin,
                        ...(pt.color ? { color: pt.color } : {}),
                        ...(pt.outlineColor ? { outlineColor: pt.outlineColor } : {}),
                    },
                    geometry: {
                        type: 'Point',
                        coordinates: toGeoJSON([pt.lat, pt.lon]),
                    },
                };
            }),
        };
    }, [points, bins.length, assignBin]);

    const radiusExpr = useMemo(() => {
        const stops: (string | number)[] = [];
        bins.forEach((b, i) => { stops.push(i, b.radius); });
        return ['interpolate', ['linear'], ['get', 'bin'], ...stops] as mapboxgl.Expression;
    }, [bins]);

    const colorExpr = useMemo(() => {
        const cases: unknown[] = [];
        bins.forEach((b, i) => {
            cases.push(['==', ['get', 'bin'], i], b.fill === 'transparent' ? 'rgba(0,0,0,0)' : b.fill);
        });
        return ['case', ...cases, bins[bins.length - 1].fill] as mapboxgl.Expression;
    }, [bins]);

    const pointColorExpr = useMemo(() => (
        ['case', ['has', 'color'], ['get', 'color'], colorExpr] as mapboxgl.Expression
    ), [colorExpr]);

    const opacityExpr = useMemo(() => {
        const stops: (string | number)[] = [];
        bins.forEach((b, i) => { stops.push(i, b.fillOpacity); });
        return ['interpolate', ['linear'], ['get', 'bin'], ...stops] as mapboxgl.Expression;
    }, [bins]);

    const layerStyle: LayerProps = useMemo(() => ({
        id: `${idPrefix}-circles`,
        type: 'circle',
        paint: {
            'circle-radius': radiusExpr,
            'circle-color': pointColorExpr,
            'circle-opacity': opacityExpr,
            'circle-stroke-color': ['case', ['has', 'outlineColor'], ['get', 'outlineColor'], outlineColor] as mapboxgl.Expression,
            'circle-stroke-width': ['case', ['==', ['get', 'bin'], 0], outlineWidth + 0.5, outlineWidth] as mapboxgl.Expression,
            'circle-stroke-opacity': ['case', ['==', ['get', 'bin'], 0], 0.4, 0.8] as mapboxgl.Expression,
        },
    }), [idPrefix, radiusExpr, pointColorExpr, opacityExpr, outlineColor, outlineWidth]);

    if (points.length === 0) return null;

    return (
        <Source id={`${idPrefix}-src`} type="geojson" data={geoJSONData}>
            <Layer {...layerStyle} />
        </Source>
    );
};
