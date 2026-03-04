import React, { useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/mapbox';
import type { LayerProps } from 'react-map-gl/mapbox';
import { quadraticBezierArc, arrowheadPoints, toArcGeoJSON, toArrowheadGeoJSON } from './mapUtils';

export interface ArcData {
    origin: [number, number];
    dest: [number, number];
    color: string;
    width?: number;
    opacity?: number;
    curveDirection?: 1 | -1;
    segments?: number;
    properties?: Record<string, unknown>;
}

export interface ArcLayerProps {
    arcs: ArcData[];
    showArrowheads?: boolean;
    arrowheadSize?: number;
    defaultWidth?: number;
    defaultOpacity?: number;
    idPrefix?: string;
}

export const ArcLayer: React.FC<ArcLayerProps> = ({
    arcs,
    showArrowheads = false,
    arrowheadSize = 0.004,
    defaultWidth = 2,
    defaultOpacity = 0.7,
    idPrefix = 'arcs',
}) => {
    const { arcGeoJSON, arrowGeoJSON } = useMemo(() => {
        const arcFeatures = arcs.map((arc) => ({
            points: quadraticBezierArc(
                arc.origin,
                arc.dest,
                arc.curveDirection ?? 1,
                arc.segments ?? 16
            ),
            properties: {
                color: arc.color,
                width: arc.width ?? defaultWidth,
                opacity: arc.opacity ?? defaultOpacity,
                ...arc.properties,
            },
        }));

        const arcGJ = toArcGeoJSON(arcFeatures);

        let arrowGJ: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
        if (showArrowheads) {
            const allBarbs = arcFeatures.flatMap((f) =>
                arrowheadPoints(f.points, arrowheadSize)
            );
            arrowGJ = toArrowheadGeoJSON(allBarbs);
            arrowGJ.features.forEach((f, i) => {
                if (i < arcs.length) {
                    f.properties = { color: arcs[i].color, width: (arcs[i].width ?? defaultWidth) + 1 };
                }
            });
        }

        return { arcGeoJSON: arcGJ, arrowGeoJSON: arrowGJ };
    }, [arcs, showArrowheads, arrowheadSize, defaultWidth, defaultOpacity]);

    const arcLayerStyle: LayerProps = useMemo(() => ({
        id: `${idPrefix}-lines`,
        type: 'line',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'width'],
            'line-opacity': ['get', 'opacity'],
        },
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
    }), [idPrefix]);

    const arrowLayerStyle: LayerProps = useMemo(() => ({
        id: `${idPrefix}-arrows`,
        type: 'line',
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'width'],
        },
        layout: {
            'line-cap': 'round',
        },
    }), [idPrefix]);

    if (arcs.length === 0) return null;

    return (
        <>
            <Source id={`${idPrefix}-src`} type="geojson" data={arcGeoJSON}>
                <Layer {...arcLayerStyle} />
            </Source>
            {showArrowheads && arrowGeoJSON.features.length > 0 && (
                <Source id={`${idPrefix}-arrows-src`} type="geojson" data={arrowGeoJSON}>
                    <Layer {...arrowLayerStyle} />
                </Source>
            )}
        </>
    );
};
